import { Router } from 'express';
import { codedError } from '../lib/errorCodes.js';
import { logger } from '../lib/logger.js';
import { NUTRITION_DETAIL_LEVELS } from '../lib/nutritionDetail.js';

export const preferencesRouter = Router();

/*
 * Interface preferences. Deliberately its own route and its own table.
 *
 * The theme is read on every page load, because it decides what the page looks
 * like. Serving it from /api/profile would mean every page load also pulls the
 * athlete's injuries - the one field the README promises never leaves its row
 * unnecessarily. Two endpoints, one of which is boring, is the cheap way to
 * keep that promise true rather than merely intended.
 *
 * Nothing here is validated against the theme catalog. That is on purpose: the
 * catalog lives in the web bundle, the server has no opinion about which
 * palettes exist, and a server-side allowlist would need a deploy in lockstep
 * with the client for every holiday theme. The client falls back to the default
 * for any id it does not recognize, which is the behavior that actually
 * matters - a retired theme shows the default, not a blank page.
 *
 * What IS enforced is length, because that is a storage question and an
 * unbounded string in a database column is not a preference, it is a place to
 * put things.
 */
const MAX_THEME_ID = 64;

/** GET /api/preferences */
preferencesRouter.get('/', async (req, res, next) => {
  try {
    // RLS restricts this to the caller's row; no .eq() needed and none wanted,
    // because a filter somebody can forget is a filter somebody will forget.
    const { data, error } = await req.supabase
      .from('user_preferences')
      .select('theme')
      .maybeSingle();
    if (error) throw codedError('storage_unavailable', 'Could not load your settings.');

    // No row yet is not an error. It is a person who has never opened the
    // picker, and they get the default like everybody else.
    res.json({ preferences: data ?? null });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/preferences */
preferencesRouter.put('/', async (req, res, next) => {
  try {
    const theme = req.body?.theme;
    if (typeof theme !== 'string' || theme.length === 0 || theme.length > MAX_THEME_ID) {
      /*
       * invalid_request rather than a new code. The distinction the code
       * vocabulary draws is between "what you sent is malformed" and "you
       * have to go and do something first", and this is squarely the former.
       * A per-route error code that means exactly what an existing one means
       * is vocabulary somebody has to learn for no new information.
       */
      throw codedError('invalid_request', 'That is not a theme this app can store.');
    }

    const { error } = await req.supabase
      .from('user_preferences')
      .upsert({ user_id: req.user.id, theme }, { onConflict: 'user_id' });
    if (error) throw codedError('storage_unavailable', 'Could not save your settings.');

    res.json({ preferences: { theme } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/preferences/nutrition-detail
 * PUT /api/preferences/nutrition-detail
 *
 * How much of the food conversation the athlete wants. The VALUE lives on
 * user_profile - it is a fact about this athlete rather than an interface
 * preference like the theme - and the ROUTE lives here, which needs its
 * reasons stated because the mismatch is deliberate.
 *
 * ── WHY NOT PUT /api/profile ──────────────────────────────────────────────
 *
 * Two reasons, and the second is the one that decided it.
 *
 * That route is the intake form's endpoint. It runs the age gate whenever
 * health or lifestyle fields are present, parses against the whole-profile
 * schema, and stamps intake_completed_at - none of which has anything to do
 * with turning food talk off, and all of which is machinery a request would
 * be dragged through for no reason.
 *
 * And it writes with `.upsert(..., { onConflict: 'user_id' })`. Every caller
 * today sends the WHOLE form, so what PostgREST does with a payload naming
 * two columns out of thirty has never been exercised in this product. The
 * documented behavior and its own example both say unsupplied columns are
 * left alone. "Both say" is not the standard for a write whose failure mode
 * is blanking somebody's injuries, lifts and goal - so this does not rely on
 * it.
 *
 * ── UPDATE FIRST, INSERT ONLY IF THERE IS NO ROW ──────────────────────────
 *
 * `.update()` touches exactly the column named; there is no question to be
 * right about. It matches nothing when the row does not exist - an account
 * created before the signup trigger - and that case is an INSERT, whose
 * semantics are equally unambiguous. Neither path can reach a column this
 * request did not name.
 */
const NutritionDetail = new Set(NUTRITION_DETAIL_LEVELS);

preferencesRouter.get('/nutrition-detail', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('user_profile')
      .select('nutrition_detail')
      .maybeSingle();
    if (error) throw codedError('storage_unavailable', 'Could not load your settings.');
    // Null rather than a guessed default: the client decides what to render
    // for "no answer", and a server inventing one is how a screen tells
    // somebody their setting is on when nobody has read it.
    res.json({ nutrition_detail: data?.nutrition_detail ?? null });
  } catch (err) {
    next(err);
  }
});

preferencesRouter.put('/nutrition-detail', async (req, res, next) => {
  try {
    const value = req.body?.nutrition_detail;
    if (!NutritionDetail.has(value)) {
      // The message names the levels rather than echoing what they sent. The
      // value is one of three known strings today, but an error that quotes
      // the request body is a habit that eventually quotes something else.
      throw codedError('invalid_request', `That is not a food setting. Choose one of: ${NUTRITION_DETAIL_LEVELS.join(', ')}.`);
    }

    const { data, error } = await req.supabase
      .from('user_profile')
      .update({ nutrition_detail: value })
      .eq('user_id', req.user.id)
      .select('user_id');
    if (error) throw codedError('storage_unavailable', 'Could not save your settings.');

    if (!data?.length) {
      // No row to update. An INSERT of exactly two columns, which cannot
      // disturb one that is not there.
      const { error: insertError } = await req.supabase
        .from('user_profile')
        .insert({ user_id: req.user.id, nutrition_detail: value });
      if (insertError) throw codedError('storage_unavailable', 'Could not save your settings.');
    }

    // Logged as an event, never with its value. "Somebody set food talk to
    // off" is an inference about a person that a log line has no reason to
    // hold; that it changed is enough to debug a save that did not stick.
    logger.info('preferences.nutrition_detail_saved', { userId: req.user.id });

    res.json({ nutrition_detail: value });
  } catch (err) {
    next(err);
  }
});
