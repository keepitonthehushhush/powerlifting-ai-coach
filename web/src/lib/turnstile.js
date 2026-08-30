/**
 * Cloudflare Turnstile, loaded on demand and inert when unconfigured.
 *
 * ── THE TOKEN IS SINGLE-USE, AND THAT IS THE WHOLE PROBLEM ────────────────
 *
 * A Turnstile token can be redeemed once and expires after a few minutes.
 * Every naive integration has the same bug: somebody mistypes their password,
 * gets "Invalid login credentials", corrects it, presses sign in again - and
 * the second attempt fails with a CAPTCHA error, because the token was spent
 * on the first one.
 *
 * From the person's side the app has decided their correct password is wrong,
 * and the only thing that fixes it is a page reload they have no reason to
 * try. So the widget is reset after EVERY submission, successful or not, and
 * a fresh token is obtained for the next one.
 *
 * ── AND IT IS OFF UNLESS CONFIGURED ───────────────────────────────────────
 *
 * `enabled()` is false when no site key was built in. Nothing loads, no widget
 * renders, and the auth calls send no token - byte-for-byte the behavior
 * before this existed. That is what makes it safe to deploy this code before
 * turning CAPTCHA on in Supabase, which is the only ordering that never breaks
 * sign-in.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

/** Is CAPTCHA configured for this build? */
export function enabled() {
  return typeof SITE_KEY === 'string' && SITE_KEY.trim() !== '' && SITE_KEY !== 'undefined';
}

export function siteKey() {
  return enabled() ? SITE_KEY.trim() : null;
}

let scriptPromise = null;

/**
 * Load the widget script once.
 *
 * Rejects rather than hanging if it never arrives - an ad blocker or a
 * corporate proxy blocking challenges.cloudflare.com is a real and common
 * case, and the sign-in form has to be able to say so rather than spin.
 */
export function loadTurnstile({ timeoutMs = 10000 } = {}) {
  if (!enabled()) return Promise.resolve(null);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('turnstile_no_document'));
      return;
    }
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }

    const timer = setTimeout(() => reject(new Error('turnstile_load_timeout')), timeoutMs);

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile_load_failed'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      // Reset so a later attempt can retry rather than being stuck with a
      // permanently rejected promise.
      scriptPromise = null;
      reject(new Error('turnstile_load_failed'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}
