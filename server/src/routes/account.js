import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

export const accountRouter = Router();

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
    const [profile, programs, sessions, logs, conversations, consents, usage] = await Promise.all([
      req.supabase.from('user_profile').select('*').maybeSingle(),
      req.supabase.from('workout_programs').select('*').order('created_at'),
      req.supabase.from('workout_sessions').select('*').order('date'),
      req.supabase.from('progress_logs').select('*').order('date'),
      req.supabase.from('conversations').select('*').order('created_at'),
      req.supabase.from('consent_records').select('*').order('seq'),
      req.supabase.from('usage_events').select('*').order('created_at'),
    ]);

    for (const result of [profile, programs, sessions, logs, conversations, consents, usage]) {
      if (result.error) throw new HttpError(502, 'Could not assemble your data export.');
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
      },
      not_included: [
        'Authentication records held by Supabase Auth (email, password hash, sign-in timestamps) — request these from the auth provider.',
        'Rate limiting counters, which hold only a request count and a timestamp.',
      ],
    };

    // Logged as a count, never as content.
    logger.info('account.exported', {
      userId: req.user.id,
      programs: programs.data?.length ?? 0,
      sessions: sessions.data?.length ?? 0,
      logs: logs.data?.length ?? 0,
      consents: consents.data?.length ?? 0,
      usage: usage.data?.length ?? 0,
    });

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
      throw new HttpError(
        400,
        'Account deletion requires an explicit confirmation. Send { "confirm": "DELETE MY ACCOUNT" }.'
      );
    }

    const { error } = await req.supabase.rpc('delete_my_account');
    if (error) throw new HttpError(502, 'Could not delete the account.', { code: error.code });

    logger.info('account.deleted', { userId: req.user.id });

    res.status(200).json({
      deleted: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (err) {
    next(err);
  }
});
