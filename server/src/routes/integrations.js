import { Router } from 'express';
import { z } from 'zod';

import { codedError } from '../lib/errorCodes.js';
import { logger } from '../lib/logger.js';
import { looksLikeApiKey, verifyKey, fetchEventPage } from '../lib/hevyClient.js';
import { clientKeyForHevy, toSession } from '../lib/hevyImport.js';
import {
  MAX_PAGES_PER_RUN,
  backfillFloor,
  markToStore,
  nextStep,
  pageProgress,
  partitionEvents,
  withinWindow,
} from '../lib/hevySync.js';
import { writeSessionWithLogs } from '../lib/sessionWrite.js';

/**
 * Connecting an outside tracker, and reading from it.
 *
 * ── READ ONLY, ON PURPOSE, FOR NOW ─────────────────────────────────────────
 *
 * Nothing here writes to Hevy. Their API has `POST /workouts` and
 * `POST /routines`, and pushing a coach-built block into somebody's routine
 * folder is the obvious next feature - but it is the one that can damage
 * something the athlete owns somewhere else. Reading is recoverable by
 * disconnecting; writing into another product's data is not.
 *
 * So: read first, ship it, and find out whether anybody connects at all before
 * building the half that can break someone else's training log.
 *
 * ── WHERE THE CREDENTIAL IS, AT EVERY MOMENT ───────────────────────────────
 *
 * Pasted into a POST body, verified against their API, handed to Postgres by
 * `connect_hevy()`, and stored in `private.hevy_connections` - a schema
 * `authenticated` holds no USAGE on. It comes back out through exactly one
 * function, `hevy_key_for_sync()`, called with the athlete's OWN RLS-scoped
 * client rather than a service role, so ADR-12 still counts one service-role
 * client in this codebase and it is still the Stripe webhook.
 *
 * It is never logged, never returned by any GET, never put in a URL, and never
 * held in a variable that outlives the request.
 */
export const integrationsRouter = Router();

const ConnectBody = z.object({
  api_key: z.string().trim().min(1).max(200),
});

/** The state, shaped for the settings page. Never the key. */
async function readStatus(supabase) {
  const { data, error } = await supabase.rpc('hevy_connection_status');
  if (error) throw codedError('storage_unavailable', 'Could not read your connections.');
  const row = (data ?? [])[0] ?? null;
  return {
    connected: Boolean(row?.connected),
    connected_at: row?.connected_at ?? null,
    synced_through: row?.synced_through ?? null,
    backfill_done: Boolean(row?.backfill_done),
    last_error: row?.last_error ?? null,
  };
}

/** GET /api/integrations/hevy */
integrationsRouter.get('/hevy', async (req, res, next) => {
  try {
    res.json({ connection: await readStatus(req.supabase) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/integrations/hevy - connect.
 *
 * The key is proved against their API BEFORE it is stored. A key that does not
 * work is a paste error nine times out of ten, and catching it while the
 * athlete is still looking at the field costs one cheap request; catching it
 * later means a settings page that says "connected" above a sync that has
 * never once succeeded.
 */
integrationsRouter.post('/hevy', async (req, res, next) => {
  try {
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) {
      throw codedError('invalid_request', 'Paste the API key from your tracker.');
    }
    const apiKey = parsed.data.api_key.trim();
    if (!looksLikeApiKey(apiKey)) {
      // Shape first, so an obvious typo never reaches a third party at all.
      throw codedError('invalid_request', 'That does not look like a Hevy API key.');
    }

    const { workoutCount } = await verifyKey(apiKey);

    const { error } = await req.supabase.rpc('connect_hevy', { p_api_key: apiKey });
    if (error) throw codedError('storage_unavailable', 'Could not save that connection.');

    const { error: auditError } = await req.supabase.rpc('record_audit_event', {
      p_action: 'tracker_connected',
    });
    // The connection is real whether or not the audit row landed. Warn and
    // carry on rather than telling somebody their connection failed when it
    // did not.
    if (auditError) logger.warn('integrations.audit_write_failed', { userId: req.user.id, action: 'tracker_connected' });

    /*
     * `workoutCount` is logged and the key is not. The count is the one piece
     * of evidence that says whether the verification actually talked to an
     * account with history in it - which is the difference between "connected"
     * and "connected to an empty account", and the first thing worth knowing
     * when somebody says the import brought nothing in.
     */
    logger.info('integrations.connected', { userId: req.user.id, provider: 'hevy', workoutCount });

    res.status(201).json({ connection: await readStatus(req.supabase), workout_count: workoutCount });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/integrations/hevy - the row goes, not just the key. */
integrationsRouter.delete('/hevy', async (req, res, next) => {
  try {
    const { error } = await req.supabase.rpc('disconnect_hevy');
    if (error) throw codedError('storage_unavailable', 'Could not disconnect that tracker.');

    const { error: auditError } = await req.supabase.rpc('record_audit_event', {
      p_action: 'tracker_disconnected',
    });
    if (auditError) {
      logger.warn('integrations.audit_write_failed', { userId: req.user.id, action: 'tracker_disconnected' });
    }

    logger.info('integrations.disconnected', { userId: req.user.id, provider: 'hevy' });
    res.json({ connection: await readStatus(req.supabase) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/integrations/hevy/sync - one bounded pass.
 *
 * Bounded, resumable, and terminating; `lib/hevySync.js` owns all three
 * properties and is tested without a network. This function is the part that
 * cannot be pure: fetch a page, write what is in it, ask where to go next.
 */
integrationsRouter.post('/hevy/sync', async (req, res, next) => {
  try {
    /*
     * ── THE ONE CALL THAT RETURNS THE CREDENTIAL ──────────────────────────
     *
     * Held in a local for the length of this request and passed only to the
     * client. Nothing below logs `state`, and `state` is never put in a
     * response - which is why the pieces the rest of this function needs are
     * pulled out by name rather than spread.
     */
    const { data: keyRows, error: keyError } = await req.supabase.rpc('hevy_key_for_sync');
    if (keyError) throw codedError('storage_unavailable', 'Could not read your connection.');
    const state = (keyRows ?? [])[0] ?? null;
    if (!state?.api_key) throw codedError('tracker_not_connected', 'No tracker is connected to this account.');

    const apiKey = state.api_key;
    const cursor = {
      synced_through: state.synced_through,
      sync_page: state.sync_page,
      backfill_done: state.backfill_done,
    };

    /*
     * The unit comes from the profile and is NOT defaulted here.
     *
     * `user_profile.units` is NOT NULL with a default of 'lb', so the only way
     * to arrive with no unit is to have no profile row at all. Importing then
     * would write every weight as null - a hundred and twenty sessions of reps
     * with no load, which looks like data and teaches the progression rules
     * nothing. Refusing is the honest answer, and it is a state the athlete
     * can fix in one screen.
     */
    const { data: profile } = await req.supabase.from('user_profile').select('units').maybeSingle();
    const units = profile?.units;
    if (units !== 'lb' && units !== 'kg') {
      throw codedError('precondition_missing', 'Set your units before importing a history.');
    }

    const now = Date.now();
    const floor = backfillFloor(now);
    const step = nextStep(cursor, now);

    let page = step.page;
    let pagesFetched = 0;
    let done = false;
    let reason = 'nothing_fetched';
    let nextPage = null;
    /*
     * Every event this pass saw, kept so the mark is decided ONCE, at the end,
     * by a pure function that also knows whether the pass finished. Bounded by
     * MAX_PAGES_PER_RUN * PAGE_SIZE, so a hundred and twenty objects at worst.
     */
    const eventsSeen = [];
    const seen = { imported: 0, duplicates: 0, deleted: 0, skipped: 0 };

    try {
      while (pagesFetched < MAX_PAGES_PER_RUN) {
        const { events, pageCount } = await fetchEventPage({
          apiKey,
          since: step.since,
          page,
          pageSize: step.pageSize,
        });
        pagesFetched += 1;

        eventsSeen.push(...events);
        const { updated, deleted } = partitionEvents(events);

        for (const workout of withinWindow(updated, floor)) {
          const session = toSession(workout, { units });
          // Null means the workout cannot be represented honestly - no id, no
          // date, or nothing but warm-ups. Counted, not written.
          if (!session) {
            seen.skipped += 1;
            continue;
          }
          const written = await writeSessionWithLogs({
            supabase: req.supabase,
            userId: req.user.id,
            date: session.date,
            exercises: session.exercises,
            clientKey: session.clientKey,
          });
          if (written.duplicate) seen.duplicates += 1;
          else seen.imported += 1;
        }

        /*
         * A workout deleted in their app is deleted here.
         *
         * This is the reason the integration reads the event stream rather
         * than a list: a phantom session that the athlete has already thrown
         * away still drives a deload, still lowers a chart, and still gets
         * cited back to them by the coach. `progress_logs` goes with it by
         * cascade, and the key namespace means this can only ever match a row
         * this import wrote.
         */
        for (const id of deleted) {
          // The same derivation the import used to write the row. Anything
          // that is not one of their ids produces null and is skipped, so a
          // malformed delete event can never widen into a broader DELETE.
          const clientKey = clientKeyForHevy(id);
          if (!clientKey) continue;
          const { error: deleteError, count } = await req.supabase
            .from('workout_sessions')
            .delete({ count: 'exact' })
            .eq('user_id', req.user.id)
            .eq('client_key', clientKey);
          if (!deleteError && count) seen.deleted += count;
        }

        const progress = pageProgress({ page, pagesFetched, events, pageCount });
        done = progress.done;
        reason = progress.reason;
        nextPage = progress.nextPage;
        if (done) break;
        page = progress.nextPage;
      }
    } catch (err) {
      /*
       * A failure part way through keeps what it has already written and
       * records where to resume. The alternative - throwing away the cursor
       * because the eighth page timed out - makes every retry start from page
       * one, which against an undocumented rate limit is how a sync that is
       * merely slow becomes a sync that never completes.
       *
       * `err.details.code` is this product's own code. Their body is not
       * stored; `last_error` is read back by the settings page and by us.
       */
      const code = err?.details?.code ?? 'tracker_unavailable';
      await req.supabase.rpc('record_hevy_sync', {
        p_synced_through: null,
        p_sync_page: page,
        p_backfill_done: cursor.backfill_done ?? false,
        p_last_error: code,
      });
      logger.warn('integrations.sync_failed', {
        userId: req.user.id, provider: 'hevy', mode: step.mode, page, code,
      });
      throw err;
    }

    /*
     * ── WHAT GETS STORED, AND WHY IT IS NOT SIMPLY `mark` ─────────────────
     *
     * The high-water mark only moves when the pass reached the end of the
     * stream. Events come back newest first, so the pages an interrupted run
     * did not reach are the OLDEST ones - and storing the newest mark would
     * put the cursor past them, where `?since=` will never look again.
     */
    const storedMark = markToStore({ done, events: eventsSeen, previous: cursor.synced_through ?? null });

    const { error: recordError } = await req.supabase.rpc('record_hevy_sync', {
      p_synced_through: storedMark,
      // Null clears it: a finished pass has no page to resume at.
      p_sync_page: done ? null : nextPage,
      p_backfill_done: step.mode === 'backfill' ? done : true,
      p_last_error: null,
    });
    if (recordError) throw codedError('storage_unavailable', 'The import ran but its progress was not saved.');

    logger.info('integrations.synced', {
      userId: req.user.id,
      provider: 'hevy',
      mode: step.mode,
      pagesFetched,
      reason,
      ...seen,
    });

    res.json({
      connection: await readStatus(req.supabase),
      run: { mode: step.mode, pages: pagesFetched, finished: done, reason, ...seen },
    });
  } catch (err) {
    next(err);
  }
});
