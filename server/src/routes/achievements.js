import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { computeAchievements } from '../lib/achievements.js';

export const achievementsRouter = Router();

/**
 * GET /api/achievements
 *
 * Computed from the caller's own logs on every read (ADR-2). Nothing is
 * stored, so changing the list is a code change rather than a migration plus
 * a backfill, and there is no table that can disagree with the training record
 * it describes.
 *
 * Private by design. Achievements are not on the leaderboard and are not part
 * of the published projection - somebody who opted into having their squat
 * ranked did not opt into strangers knowing they missed a rep in March.
 */
achievementsRouter.get('/', async (req, res, next) => {
  try {
    const [{ data: logs, error }, { data: profile }] = await Promise.all([
      req.supabase.from('progress_logs').select('date, lift, weight, reps, completed'),
      req.supabase.from('user_profile').select('units').maybeSingle(),
    ]);
    if (error) throw new HttpError(502, 'Could not load your training history.', { code: error.code });

    res.json({ achievements: computeAchievements({ logs: logs ?? [], profile }) });
  } catch (err) {
    next(err);
  }
});
