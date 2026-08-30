import { Router } from 'express';
import { z } from 'zod';
import { codedError } from '../lib/errorCodes.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

export const accountRouter = Router();

/**
 * GET /api/account/activity
 *
 * The audit trail, for the person it is about. A record the subject cannot see
 * is a record they cannot check, and an audit trail nobody can check is
 * decoration.
 *
 * Read with the caller's JWT: the policy on audit_events scopes SELECT to
 * `user_id = auth.uid()`, so there is nothing here that could return somebody
 * else's row even if this query were wrong.
 */
accountRouter.get('/activity', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('audit_events')
      .select('action, actor, detail, created_at')
      .order('seq', { ascending: false })
      .limit(100);
    if (error) throw codedError('storage_unavailable', 'Could not load your activity.', { cause: error.code });
    res.json({ events: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * Data subject rights: access (GDPR Art. 15 / CCPA) and erasure (Art. 17).
 *
 * Both are built on the same primitive as everything else - the user-scoped
 * Supabase client - which is what makes them cheap to provide honestly. The
 * export cannot accidentally include another user's rows, because RLS filters
 * every query, and the deletion cannot target another account, because the
 * database function takes no argument at all.
 */

/**
 * GET /api/account/export
 *
 * Everything held about the caller, in one machine-readable document.
 *
 * Note that this deliberately exports health data in the clear. That is the
 * point of a subject-access request: the person is entitled to see exactly
 * what is stored about them. This is the one code path where the redaction
 * rules that govern logging do not apply - and the distinction matters. The
 * data goes to the data subject over an authenticated TLS connection, not to
 * an operator's log drain.
 *
 * ── WHAT THIS MISSED, AND HOW ─────────────────────────────────────────────
 *
 * Until 2026-08-27 this exported five tables while the schema had seven that
 * hold user rows. Missing were the consent ledger - the record of what
 * somebody agreed to and when, which is exactly the thing a person exercising
 * a data right wants to see - and usage_events, added later by migration 0020.
 * The `not_included` note even said token counts were not held, which had been
 * true when it was written and stopped being true the moment 0020 landed.
 *
 * So the rule for anyone adding a table: a new user-scoped table is not
 * finished until it appears here. server/test/policyDisclosure.test.js reads
 * the migrations and fails when a table with a user_id is absent from this
 * list, because the note above is the kind of thing nobody re-reads.
 */
accountRouter.get('/export', rateLimit('export'), async (req, res, next) => {
  try {
    const [profile, programs, sessions, logs, conversations, consents, usage, errors, subscription, activity, board] = await Promise.all([
      req.supabase.from('user_profile').select('*').maybeSingle(),
      req.supabase.from('workout_programs').select('*').order('created_at'),
      req.supabase.from('workout_sessions').select('*').order('date'),
      req.supabase.from('progress_logs').select('*').order('date'),
      req.supabase.from('conversations').select('*').order('created_at'),
      req.supabase.from('consent_records').select('*').order('seq'),
      req.supabase.from('usage_events').select('*').order('created_at'),
      // Failures this account hit. No message content - a code, a route and a
      // status - but it is a record about them, so it belongs in a subject
      // access request like everything else here (migration 0034).
      req.supabase.from('error_events').select('*').order('seq'),
      // Billing state is the person's own data and belongs in a subject access
      // request. It is a mirror of what Stripe holds; Stripe's own copy is
      // requestable from Stripe, and `not_included` says so.
      req.supabase.from('subscriptions').select('*').maybeSingle(),
      /**
       * The audit trail. It was browsable at GET /api/account/activity and
       * absent from here, which is the wrong way round: the endpoint shows the
       * most recent hundred rows in a page, and an access request is for
       * everything, in a file the subject keeps.
       *
       * It matters more since migration 0041, which records every assertion
       * that a professional cleared the athlete to train. That is the trail
       * answering "I never told it a doctor had cleared me", and a record used
       * to answer somebody must be a record that somebody can read.
       */
      req.supabase.from('audit_events').select('*').order('seq'),
      /**
       * The published leaderboard row, through a definer function rather than a
       * select, because 0039 revoked user_id from `authenticated` so this query
       * can no longer filter on it. See migration 0042.
       */
      req.supabase.rpc('my_leaderboard_entry'),
    ]);

    /**
     * ── WHY ONE UNREACHABLE SOURCE NO LONGER DESTROYS THE WHOLE EXPORT ──
     *
     * This used to throw on the first error, so any single failing source
     * returned 500 and the person got nothing.
     *
     * That went from theoretical to live on 2026-08-30. The export gained a
     * call to my_leaderboard_entry() (migration 0042); the code was merged and
     * deployed; the migration was not applied to production. A function that
     * does not exist is an error like any other, so the entire subject access
     * request - profile, programs, sessions, every logged lift - failed because
     * one optional row could not be read.
     *
     * The deploy order was the mistake and is fixed separately. This is the
     * fragility that turned it into an outage: an export is the one endpoint
     * where "most of your data plus an honest note" beats "nothing".
     *
     * ── AND WHY IT IS NOT SILENT ────────────────────────────────────────
     *
     * A subject access request that quietly omits a table is worse than one
     * that fails, because the person cannot tell. So anything unreadable is
     * NAMED in the document itself, under `could_not_be_included`, and logged
     * as an error on our side. They get what we could assemble, they are told
     * exactly what is missing, and we find out.
     *
     * The profile is the exception: an export with no profile is not a partial
     * export, it is a different document, and returning one would misrepresent
     * what we hold.
     */
    if (profile.error) {
      logger.error('account.export_failed', { userId: req.user.id, code: profile.error.code });
      throw codedError('storage_unavailable', 'Could not assemble your data export.');
    }

    const sources = {
      workout_programs: programs,
      workout_sessions: sessions,
      progress_logs: logs,
      conversations,
      consent_records: consents,
      usage_events: usage,
      error_events: errors,
      subscription,
      audit_events: activity,
      leaderboard_entry: board,
    };

    const couldNotInclude = Object.entries(sources)
      .filter(([, result]) => result.error)
      .map(([name]) => name);

    if (couldNotInclude.length > 0) {
      logger.error('account.export_incomplete', {
        userId: req.user.id,
        missing: couldNotInclude,
      });
    }

    const exportDocument = {
      export_format_version: 1,
      generated_at: new Date().toISOString(),
      subject: { user_id: req.user.id, email: req.user.email },
      notice:
        'This document contains everything this application stores about you, including ' +
        'health information you provided. Store it somewhere you consider private.',
      data: {
        profile: profile.data,
        workout_programs: programs.data ?? [],
        workout_sessions: sessions.data ?? [],
        progress_logs: logs.data ?? [],
        conversations: conversations.data ?? [],
        consent_records: consents.data ?? [],
        usage_events: usage.data ?? [],
        error_events: errors.data ?? [],
        subscription: subscription.data ?? null,
        audit_events: activity.data ?? [],
        // Zero rows when they never joined; one row when they did.
        leaderboard_entry: (board.data ?? [])[0] ?? null,
      },
      /**
       * Empty on a healthy export. Named rather than omitted, because a
       * subject access request the person cannot tell is incomplete is worse
       * than one that failed outright.
       */
      could_not_be_included: couldNotInclude.length === 0 ? [] : couldNotInclude.map((name) => ({
        source: name,
        note:
          'This could not be read when your export was assembled, so it is not included above. ' +
          'Nothing has been deleted. Please request your export again, and contact us if it keeps happening.',
      })),
      not_included: [
        'Authentication records held by Supabase Auth (email, password hash, sign-in timestamps) — request these from the auth provider.',
        'Rate limiting counters, which hold only a request count and a timestamp.',
        'Payment card details and billing history, which are held by Stripe and never by us. Request them from Stripe directly; we hold only the subscription status shown above.',
      ],
    };

    const totalRows =
      (programs.data?.length ?? 0) + (sessions.data?.length ?? 0) + (logs.data?.length ?? 0) +
      (consents.data?.length ?? 0) + (usage.data?.length ?? 0) + (errors.data?.length ?? 0) +
      (activity.data?.length ?? 0);

    // Logged as a count, never as content.
    logger.info('account.exported', {
      userId: req.user.id,
      programs: programs.data?.length ?? 0,
      sessions: sessions.data?.length ?? 0,
      logs: logs.data?.length ?? 0,
      consents: consents.data?.length ?? 0,
      usage: usage.data?.length ?? 0,
    });

    /**
     * The durable half of the record. The log line above is the operational
     * one - useful while somebody is watching a deploy - and it is gone in
     * days. This row is what answers "did you actually give me my data" in
     * three months, and the person it is about can read it.
     *
     * Awaited inside its own try/catch: an audit write failing must not deny
     * somebody their export, but it must also not vanish silently, which is
     * what a floating promise on a serverless runtime does when the function
     * freezes on response.
     */
    try {
      const { error: auditError } = await req.supabase.rpc('record_audit_event', {
        p_action: 'data_exported',
        p_detail: { tables: Object.keys(exportDocument.data ?? {}).length, rows: totalRows },
      });
      if (auditError) logger.error('audit.write_failed', { action: 'data_exported', code: auditError.code });
    } catch (auditErr) {
      logger.error('audit.write_failed', { action: 'data_exported', message: auditErr.message });
    }

    res.set('Content-Disposition', `attachment; filename="coach-data-export-${Date.now()}.json"`);
    res.json(exportDocument);
  } catch (err) {
    next(err);
  }
});

const DeleteRequest = z.object({
  // A typed confirmation rather than a boolean. Erasure is irreversible and a
  // stray `{"confirm": true}` from a mis-wired client should not be able to
  // destroy an account.
  confirm: z.literal('DELETE MY ACCOUNT'),
});

/**
 * DELETE /api/account
 *
 * Irreversible. Removes the auth user; ON DELETE CASCADE removes the profile,
 * programs, sessions, progress logs, conversations and rate limit counters.
 * Verified to leave zero residual rows — see supabase/tests/rls_isolation_test.sql.
 */
accountRouter.delete('/', async (req, res, next) => {
  try {
    const parsed = DeleteRequest.safeParse(req.body);
    if (!parsed.success) {
      throw codedError(
        'precondition_missing',
        'Account deletion requires an explicit confirmation. Send { "confirm": "DELETE MY ACCOUNT" }.',
        { needs: 'typed_confirmation' }
      );
    }

    /**
     * BEFORE the deletion, not after - after, there is no caller left to
     * record it with. auth.uid() is gone the moment the user row goes, so a
     * record written afterwards could not be attributed and, more simply,
     * could not be written at all.
     *
     * The row survives the deletion with user_id SET NULL (migration 0030),
     * which is the whole reason that column is not ON DELETE CASCADE. What is
     * left is "an account was deleted at this time" and nothing that points
     * back at a person - enough to demonstrate the deletion happened, and not
     * personal data that erasure was owed.
     */
    try {
      const { error: auditError } = await req.supabase.rpc('record_audit_event', {
        p_action: 'account_deleted',
        p_detail: {},
      });
      if (auditError) logger.error('audit.write_failed', { action: 'account_deleted', code: auditError.code });
    } catch (auditErr) {
      logger.error('audit.write_failed', { action: 'account_deleted', message: auditErr.message });
    }

    const { error } = await req.supabase.rpc('delete_my_account');
    if (error) throw codedError('storage_unavailable', 'Could not delete the account.', { cause: error.code });

    logger.info('account.deleted', { userId: req.user.id });

    res.status(200).json({
      deleted: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (err) {
    next(err);
  }
});
