import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';

export const libraryRouter = Router();

/**
 * GET /api/library
 *
 * Shared reference data: cues, common faults, and an outbound link to a
 * third-party demonstration video. No video is hosted, embedded, mirrored or
 * otherwise reproduced by this application - video_url points at the rights
 * holder's own channel and the UI opens it in a new tab.
 */
libraryRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('exercise_library')
      .select('slug, name, category, cues, common_faults, video_url, video_source')
      .order('category')
      .order('name');
    if (error) throw new HttpError(502, 'Could not load the exercise library.');
    res.json({ exercises: data ?? [] });
  } catch (err) {
    next(err);
  }
});
