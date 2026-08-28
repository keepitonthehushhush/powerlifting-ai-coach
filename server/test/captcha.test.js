import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * ── THE TWO WAYS A CAPTCHA INTEGRATION GOES WRONG ──────────────────────────
 *
 * 1. THE ORDERING. Enabling CAPTCHA in Supabase makes a token REQUIRED on
 *    sign-in, sign-up and password reset immediately. Ship the toggle before
 *    the code and every account, including yours, is locked out with no error
 *    that says why. So the code must be inert without a site key - that is
 *    what makes it safe to deploy first.
 *
 * 2. THE SPENT TOKEN. A Turnstile token is single-use. Somebody mistypes a
 *    password, is told so, corrects it, presses sign in again - and fails a
 *    CAPTCHA they visibly passed, because the token went with the first
 *    attempt. From their side the app is rejecting a password they know is
 *    right, and only a page reload fixes it.
 *
 * Neither produces an exception anywhere.
 */

const lib = readSource(new URL('../../web/src/lib/turnstile.js', import.meta.url));
const libRaw = readRaw(new URL('../../web/src/lib/turnstile.js', import.meta.url));
const widget = readSource(new URL('../../web/src/components/Turnstile.jsx', import.meta.url));
const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
const loginRaw = readRaw(new URL('../../web/src/pages/Login.jsx', import.meta.url));
const auth = readSource(new URL('../../web/src/context/AuthContext.jsx', import.meta.url));
const authRaw = readRaw(new URL('../../web/src/context/AuthContext.jsx', import.meta.url));
const envExample = readRaw(new URL('../../.env.example', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

describe('it is inert until a site key exists', () => {
  test('NO SITE KEY MEANS NO WIDGET AND NO TOKEN', () => {
    // Byte-for-byte the behaviour before this existed, which is the only
    // reason it is safe to deploy this before flipping the Supabase toggle.
    assert.match(lib, /export function enabled\(\)/);
    assert.match(lib, /SITE_KEY !== 'undefined'/);
    assert.match(widget, /if \(!enabled\(\)\) return null/);
    assert.match(widget, /if \(!enabled\(\)\) return undefined/);
  });

  test('and the script is not even fetched', () => {
    assert.match(lib, /if \(!enabled\(\)\) return Promise\.resolve\(null\)/);
  });

  test('the ordering is written down where somebody deploying would read it', () => {
    assert.match(envExample, phrase('the other order locks everybody out with no error that says why'));
    assert.match(envExample, /^VITE_TURNSTILE_SITE_KEY=$/m);
  });

  test('and .env.example says the secret key never comes near the repository', () => {
    assert.match(envExample, phrase('It must never appear in this file or in the repository'));
    // The secret key must not BE here, in any form.
    assert.ok(!/0x4[A-Za-z0-9_-]{20,}/.test(envExample), '.env.example contains something shaped like a key');
  });
});

describe('THE TOKEN IS RESET AFTER EVERY ATTEMPT', () => {
  test('after sign-in and sign-up, including failures', () => {
    // The reset must not sit inside an `if (!error)`. A failed attempt spends
    // the token exactly as a successful one does.
    const submit = login.slice(login.indexOf('async function handleSubmit'));
    assert.match(submit, /resetTurnstile\(\)/);
    assert.match(submit, /setCaptchaToken\(null\)/);
    const resetAt = submit.indexOf('resetTurnstile()');
    const errorBranch = submit.indexOf('if (error)');
    assert.ok(resetAt !== -1 && errorBranch !== -1);
    assert.ok(resetAt < errorBranch, 'the widget is reset only on the success path');
  });

  test('and after a password-reset request', () => {
    const handler = login.slice(login.indexOf('async function handleReset'));
    const body = handler.slice(0, handler.indexOf('async function handleSubmit'));
    assert.match(body, /resetTurnstile\(\)/);
  });

  test('the reason is recorded, because a later refactor would drop it', () => {
    assert.match(loginRaw, phrase('reads as the app rejecting a password they know is right'));
    assert.match(libRaw, phrase('the token was spent on the first one'));
  });
});

describe('all three endpoints are covered', () => {
  test('SIGN-IN, SIGN-UP AND PASSWORD RESET', () => {
    // Reset is the one people forget: unauthenticated, sends mail, costs an
    // attacker nothing. Guarding sign-in alone protects the expensive door and
    // leaves the cheap one open.
    assert.match(auth, /signUp: \(email, password, captchaToken\)/);
    assert.match(auth, /signIn: \(email, password, captchaToken\)/);
    assert.match(auth, /resetPassword: \(email, captchaToken\)/);
  });

  test('AND THE TOKEN IS PUT WHERE EACH METHOD ACTUALLY WANTS IT', () => {
    // The library is inconsistent: signUp and signInWithPassword take it
    // inside `options`; resetPasswordForEmail takes it top-level. Getting this
    // wrong does not throw - the field is ignored, no token reaches Supabase,
    // and the request is rejected as if the person failed a challenge they
    // visibly passed.
    assert.match(auth, /signUp\(\{ email, password, options: \{ captchaToken \} \}\)/);
    assert.match(auth, /signInWithPassword\(\{ email, password, options: \{ captchaToken \} \}\)/);
    const resetCall = auth.slice(auth.indexOf('resetPasswordForEmail'));
    assert.match(resetCall.slice(0, 220), /redirectTo:[\s\S]*?captchaToken,/);
    assert.ok(
      !/resetPasswordForEmail\(email, \{[^}]*options:/.test(auth),
      'the reset call nests captchaToken inside options, where it is ignored',
    );
  });

  test('and the inconsistency is documented rather than rediscovered', () => {
    assert.match(authRaw, phrase('WHERE captchaToken GOES IS NOT CONSISTENT'));
  });
});

describe('when the challenge cannot load', () => {
  test('the form says so instead of leaving a button that never enables', () => {
    // Ad blockers and corporate proxies block challenges.cloudflare.com
    // routinely. A permanently disabled sign-in button with no explanation is
    // indistinguishable from the site being broken.
    // Asserted as "the unavailable path notifies the parent", not as the exact
    // call text - which changed when the callbacks moved into refs, and failed
    // this test on a fix that did not touch the behaviour at all. Third time a
    // test pinned to an expression has blocked a correct change.
    assert.match(widget, /onUnavailable(Ref\.current)?\?\.\(\)/);
    assert.match(login, /captchaBlocked/);
    assert.match(en, phrase('may be blocking challenges.cloudflare.com'));
  });

  test('the loader times out rather than hanging forever', () => {
    assert.match(lib, /turnstile_load_timeout/);
    assert.match(lib, /timeoutMs = 10000/);
  });

  test('and a failed load can be retried', () => {
    // The promise is cached; caching a rejected one would make the failure
    // permanent for the life of the page.
    assert.match(lib, /scriptPromise = null;/);
  });

  test('an expired token disables the button rather than being submitted', () => {
    // Both handlers must clear the token; how they reach the parent is not the
    // property under test.
    assert.match(widget, /'expired-callback': \(\) => onToken(Ref\.current)?\?\.\(null\)/);
    assert.match(widget, /'error-callback': \(\) => onToken(Ref\.current)?\?\.\(null\)/);
    assert.match(login, /captchaEnabled\(\) && !captchaBlocked && !captchaToken/);
  });
});

describe('the widget does not make the form jump', () => {
  test('it reserves height before it loads', () => {
    // Layout shift under a submit button is how people click the wrong thing.
    const styles = readRaw(new URL('../../web/src/styles.css', import.meta.url));
    assert.match(styles, /\.turnstile \{[^}]*min-height/);
  });
});

describe('the build can actually see the key', () => {
  const viteConfig = readRaw(new URL('../../web/vite.config.js', import.meta.url));

  test('VITE READS .env FROM THE REPOSITORY ROOT', () => {
    /**
     * Found by checking a real build rather than trusting it: the site key was
     * correctly set in `.env` and the bundle contained neither the key nor the
     * Turnstile loader.
     *
     * Vite's envDir defaults to the Vite project root - `web/` - and there is
     * no `web/.env`. A missing variable inlines as `undefined`, `enabled()`
     * becomes constant-false, and Rollup removes the whole feature. No error,
     * no warning, just a widget that never appears.
     *
     * This is the same shape as the blank-page incident in lib/config.js: a
     * configuration variable that was set, in the documented place, and never
     * arrived.
     */
    assert.match(viteConfig, /envDir: '\.\.'/);
  });

  test('and the reason is recorded, because envDir looks removable', () => {
    assert.match(viteConfig, phrase('there is no `web/.env`'));
    assert.match(viteConfig, phrase('is not reproducible'));
  });

  test('there is exactly one .env, and .env.example describes that one', () => {
    // Two env files, one of which is silently authoritative for half the
    // variables, is worse than either.
    assert.match(envExample, /^VITE_TURNSTILE_SITE_KEY=$/m);
    assert.match(envExample, /^VITE_SUPABASE_URL=/m);
  });
});

describe('THE WIDGET IS CREATED ONCE, NOT ON EVERY RENDER', () => {
  /**
   * The bug: `useEffect(..., [onToken, onUnavailable])`, which is what the
   * exhaustive-deps lint rule asks for and is wrong here.
   *
   * A parent writing `onUnavailable={() => setBlocked(true)}` creates a new
   * function identity every render, and the sign-in form re-renders on every
   * keystroke because its inputs are controlled. So every character typed into
   * the email field tore the widget down and built a new one - visible as
   * Cloudflare misbehaving, and it burns their rate limits doing it.
   *
   * It could also never settle: solving the challenge called setCaptchaToken,
   * which re-rendered, which destroyed the widget that had just produced the
   * token.
   */
  test('the effect has no dependencies, so props changing identity cannot re-run it', () => {
    const effect = widget.slice(widget.indexOf('useEffect('), widget.indexOf('if (!enabled()) return null'));
    assert.match(effect, /\}, \[\]\);/);
    assert.ok(
      !/\}, \[on(Token|Unavailable)/.test(effect),
      'the effect depends on a callback prop - it will re-run whenever the parent re-renders',
    );
  });

  test('and the callbacks reach it through refs, so they are still current', () => {
    // Empty deps with the callbacks captured directly would freeze the first
    // render's closures. Refs give both: one widget, latest handlers.
    assert.match(widget, /onTokenRef\.current = onToken/);
    assert.match(widget, /onUnavailableRef\.current = onUnavailable/);
    assert.match(widget, /onTokenRef\.current\?\.\(token\)/);
  });

  test('a second render into the same node is refused', () => {
    // React 18 StrictMode invokes effects twice in development, and rendering
    // two widgets into one container throws.
    assert.match(widget, /if \(widgetId\.current !== null\) return;/);
    const main = readSource(new URL('../../web/src/main.jsx', import.meta.url));
    assert.match(main, /StrictMode/, 'StrictMode is off - the guard above was written for it');
  });

  test('and the id is cleared on teardown, or the guard blocks a legitimate remount', () => {
    assert.match(widget, /widgetId\.current = null;/);
  });

  test('the reason is recorded, because the lint rule will ask for the deps back', () => {
    const raw = readRaw(new URL('../../web/src/components/Turnstile.jsx', import.meta.url));
    assert.match(raw, phrase('is what the linter asks for and is wrong here'));
    assert.match(raw, phrase('every character typed tore the widget down'));
  });
});
