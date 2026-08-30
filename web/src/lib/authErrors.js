/**
 * Supabase Auth's errors, translated into ours.
 *
 * ── THE INCIDENT THIS EXISTS FOR ──────────────────────────────────────────
 *
 * On 2026-08-29 a real person could not create an account. Production auth
 * logs, four hits across two addresses:
 *
 *   POST /signup  400  captcha_failed
 *     "captcha protection: request disallowed (no captcha_token found)"
 *   POST /token   400  captcha_failed   (x3)
 *
 * CAPTCHA protection was switched on in the Supabase dashboard while the
 * deployed bundle carried no `VITE_TURNSTILE_SITE_KEY`. With no key the widget
 * never renders, no token is produced, and the browser sends the sign-up
 * without one - so every attempt was rejected before it reached the database.
 *
 * .env.example had warned about precisely this ordering, in these words:
 * "Enabling CAPTCHA in Supabase makes a token REQUIRED on sign-in, sign-up and
 * password reset immediately. Deploy a build carrying this key first ... the
 * other order locks everybody out with no error that says why."
 *
 * The ordering was the operational mistake. This file is about the second
 * half of that sentence - "with no error that says why" - which is ours.
 *
 * ── WHAT THE PERSON ACTUALLY SAW ──────────────────────────────────────────
 *
 * Login.jsx rendered `error.message` verbatim, so a stranger trying to sign up
 * read: "captcha protection: request disallowed (no captcha_token found)".
 *
 * That sentence is addressed to an operator, not a customer. It names a thing
 * they cannot see, blames a token they have never heard of, and offers no
 * action. Somebody who reads it does not retry, does not write in, and does
 * not come back - the failure is silent on our side and total on theirs.
 *
 * So every auth failure now maps to a code we own and a sentence written for
 * the person reading it, and anything unrecognized falls back to a message
 * that at least admits the problem is ours.
 *
 * ── AND WHY THE CODES ARE HERE RATHER THAN INVENTED AT EACH CALL SITE ─────
 *
 * They are a vocabulary, not strings. They are recorded to error_events
 * (migration 0043), they name i18n keys, and server/src/lib/errorCodes.js
 * carries the same ones so the product has ONE list of things that can go
 * wrong rather than two that drift. A test asserts the two agree.
 */

/**
 * Our codes for the auth failures worth distinguishing.
 *
 * Deliberately not one code per Supabase string. These are grouped by WHAT THE
 * PERSON SHOULD DO, which is the only distinction a message can act on:
 * fix your input, wait, allow a domain, or nothing-because-it-is-us.
 */
export const AUTH_ERROR_CODES = Object.freeze({
  /**
   * The server demanded a CAPTCHA token and the client had none to send.
   *
   * THIS IS OURS, NOT THEIRS. It means the deployed build and the Supabase
   * settings disagree, and no action by the person can resolve it - which is
   * why its message apologizes rather than instructing.
   */
  captcha_misconfigured: 'captcha_misconfigured',
  /** The widget exists but could not load - ad blocker, extension, network. */
  captcha_unavailable: 'captcha_unavailable',
  /** A token was sent and rejected: expired, already spent, or wrong key. */
  captcha_rejected: 'captcha_rejected',
  /** Wrong email or password. Ordinary, and the person can fix it. */
  invalid_credentials: 'invalid_credentials',
  /** The address already has an account. */
  email_already_registered: 'email_already_registered',
  /** Supabase's own password rules refused it. */
  password_rejected: 'password_rejected',
  /** Auth email quota - the free tier's is low and this is how it presents. */
  auth_rate_limited: 'auth_rate_limited',
  /** The address is not deliverable or not accepted. */
  email_rejected: 'email_rejected',
  /** Signed out elsewhere, or a stale tab. Recoverable by signing in again. */
  session_expired: 'session_expired',
  /** Anything we have not seen. Reported, never shown raw. */
  auth_unexpected: 'auth_unexpected',
});

/**
 * Codes worth writing to error_events.
 *
 * A bad password is not a defect and would drown the table; the rest are
 * either our fault or a signal that something outside the app is wrong.
 * `invalid_credentials` is deliberately absent for that reason.
 */
export const RECORDED_AUTH_CODES = Object.freeze([
  AUTH_ERROR_CODES.captcha_misconfigured,
  AUTH_ERROR_CODES.captcha_unavailable,
  AUTH_ERROR_CODES.captcha_rejected,
  AUTH_ERROR_CODES.auth_rate_limited,
  AUTH_ERROR_CODES.email_rejected,
  AUTH_ERROR_CODES.auth_unexpected,
]);

/**
 * Match on Supabase's `code` first, then on the message.
 *
 * The code is stable and the message is not - Supabase has reworded these
 * before. Matching the message at all is a fallback for older responses that
 * carry no code, and it is why every pattern here is loose rather than exact.
 */
const RULES = [
  { code: 'captcha_failed', to: AUTH_ERROR_CODES.captcha_rejected },
  { test: /captcha/i, to: AUTH_ERROR_CODES.captcha_rejected },

  { code: 'invalid_credentials', to: AUTH_ERROR_CODES.invalid_credentials },
  { test: /invalid login credentials/i, to: AUTH_ERROR_CODES.invalid_credentials },

  { code: 'user_already_exists', to: AUTH_ERROR_CODES.email_already_registered },
  { code: 'email_exists', to: AUTH_ERROR_CODES.email_already_registered },
  { test: /already registered|already exists/i, to: AUTH_ERROR_CODES.email_already_registered },

  { code: 'weak_password', to: AUTH_ERROR_CODES.password_rejected },
  { test: /password.*(weak|short|requirement)/i, to: AUTH_ERROR_CODES.password_rejected },

  { code: 'over_email_send_rate_limit', to: AUTH_ERROR_CODES.auth_rate_limited },
  { code: 'over_request_rate_limit', to: AUTH_ERROR_CODES.auth_rate_limited },
  { test: /rate limit|too many requests/i, to: AUTH_ERROR_CODES.auth_rate_limited },

  { code: 'email_address_invalid', to: AUTH_ERROR_CODES.email_rejected },
  { code: 'email_address_not_authorized', to: AUTH_ERROR_CODES.email_rejected },
  { test: /invalid email|not authorized/i, to: AUTH_ERROR_CODES.email_rejected },

  { code: 'refresh_token_not_found', to: AUTH_ERROR_CODES.session_expired },
  { code: 'session_not_found', to: AUTH_ERROR_CODES.session_expired },
  { test: /refresh token|session (not found|expired)/i, to: AUTH_ERROR_CODES.session_expired },
];

/**
 * Classify an auth error.
 *
 * @param {{code?: string, message?: string, status?: number}|null} error
 * @param {{captchaConfigured?: boolean, captchaBlocked?: boolean}} [context]
 * @returns {string} one of AUTH_ERROR_CODES
 */
export function classifyAuthError(error, context = {}) {
  if (!error) return AUTH_ERROR_CODES.auth_unexpected;

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  const matched = RULES.find((rule) =>
    (rule.code && rule.code === code) || (rule.test && rule.test.test(message))
  );
  const base = matched ? matched.to : AUTH_ERROR_CODES.auth_unexpected;

  /**
   * A CAPTCHA rejection means different things depending on what the CLIENT
   * had available, and only the client knows which.
   *
   * Told to send a token we never had a key for      -> our misconfiguration.
   * Told to send one the widget failed to load       -> their network.
   * Told to send one we did have                     -> expired or spent.
   *
   * Collapsing these into one message is how the incident produced a sentence
   * nobody could act on. The distinction is the entire point of this function.
   */
  if (base === AUTH_ERROR_CODES.captcha_rejected) {
    if (context.captchaConfigured === false) return AUTH_ERROR_CODES.captcha_misconfigured;
    if (context.captchaBlocked) return AUTH_ERROR_CODES.captcha_unavailable;
  }

  return base;
}

/** The i18n key carrying the sentence a person should read for this code. */
export function authErrorMessageKey(code) {
  return `auth.errors.${code}`;
}

/** Should this failure be written to error_events? */
export function shouldRecord(code) {
  return RECORDED_AUTH_CODES.includes(code);
}
