import { Router } from 'express';
import { codedError } from '../lib/errorCodes.js';
import { rankEntries } from '../lib/leaderboard.js';

export const leaderboardRouter = Router();

/**
 * GET /api/leaderboard
 *
 * Everybody who opted in, ranked. The cross-user read is the feature, and it
 * is safe because of what the table does not contain (migration 0026): a
 * handle, three lifted numbers and units. No health data, no bodyweight, no
 * age, no identifier that points back at a person.
 *
 * Read with the CALLER'S JWT like everything else (ADR-1). The policy on
 * leaderboard_entries permits selecting every row, so this needs no elevated
 * client - which matters, because the day somebody reaches for the service
 * role to build a feature is the day the exception stops being one.
 */
leaderboardRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('leaderboard_entries')
      .select('display_name, best_squat, best_bench, best_deadlift, units, updated_at');
    if (error) throw codedError('storage_unavailable', 'Could not load the leaderboard.', { cause: error.code });

    const { data: profile } = await req.supabase
      .from('user_profile')
      .select('display_name, units')
      .maybeSingle();

    res.json({
      units: profile?.units ?? 'lb',
      // So the client can highlight the viewer's own row without us sending
      // any identifier for anybody else.
      you: profile?.display_name ?? null,
      onLeaderboard: (data ?? []).some((row) => row.display_name === profile?.display_name),
      boards: rankEntries(data ?? [], profile?.units ?? 'lb'),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/leaderboard/opt-in  { optIn: boolean }
 *
 * Joining and leaving. One endpoint, because withdrawal must be no harder
 * than consent, and a separate DELETE route somebody has to find is harder.
 *
 * Delegates to set_leaderboard_opt_in(), which is where the rules live: it
 * refuses without a display name, deletes rather than hides on the way out,
 * and populates the numbers from the athlete's own logs on the way in.
 */
leaderboardRouter.put('/opt-in', async (req, res, next) => {
  try {
    const optIn = req.body?.optIn;
    if (typeof optIn !== 'boolean') throw codedError('invalid_request', 'Invalid request.', { field: 'opt_in' });

    const { error } = await req.supabase.rpc('set_leaderboard_opt_in', { opt_in: optIn });
    if (error) {
      // The one failure a person can act on, so it gets its own answer rather
      // than a 502 that reads as the app being broken.
      if (/display_name_required/.test(error.message ?? '')) {
        throw codedError('precondition_missing', 'Choose a display name before joining the leaderboard.', {
          needs: 'display_name',
        });
      }
      // The database refuses to publish without an active, current consent
      // (migration 0028). The UI asks for it first, so reaching this means
      // either a direct RPC call or a consent that went stale between the page
      // loading and the button being pressed - both of which deserve a
      // sentence rather than a 502.
      if (/leaderboard_consent_required/.test(error.message ?? '')) {
        throw codedError('precondition_missing', 'Agree to the leaderboard terms before joining.', {
          needs: 'leaderboard_consent',
        });
      }
      throw codedError('storage_unavailable', 'Could not update your leaderboard setting.', { cause: error.code });
    }

    res.json({ optIn });
  } catch (err) {
    next(err);
  }
});
