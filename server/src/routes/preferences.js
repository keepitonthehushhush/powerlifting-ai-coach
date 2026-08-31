import { Router } from 'express';
import { codedError } from '../lib/errorCodes.js';

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
