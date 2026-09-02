/**
 * Logging with health data redacted at the boundary.
 *
 * The constraint: user-reported injuries and medical conditions are health
 * information. They are legitimately sent to the Anthropic API - that is the
 * product - but they must not end up in stdout, in a hosting provider's log
 * retention, or in a third-party error tracker like Sentry.
 *
 * The design choice worth defending: redaction happens HERE, in the logger,
 * not at each call site. Relying on every future call site to remember which
 * fields are sensitive is a policy that fails the first time someone is in a
 * hurry. Centralizing it means the unsafe thing is hard to do by accident -
 * you would have to bypass the logger entirely.
 *
 * SENSITIVE_KEYS is deliberately broader than the current schema, so a field
 * added later with an obvious name is covered before anyone remembers to
 * update this list.
 *
 * ── WHAT THIS DOES NOT COVER, DELIBERATELY ────────────────────────────────
 *
 * Redaction is keyed on the NAME of the key holding a value. A sensitive
 * string that arrives as an array element - `{ fields: ['health_restrictions'] }`
 * from the profile route - is not redacted, because it is a value and not a
 * key. That case is left alone on purpose: the field names are what makes a
 * failed save diagnosable, and they say that somebody edited their injury
 * note without saying what it now reads. The AI processing disclosure states
 * this explicitly rather than letting the page imply it never happens.
 */

const SENSITIVE_KEYS = [
  'health_restrictions', 'healthrestrictions',
  'injury', 'injuries', 'medical', 'diagnosis',
  'medication', 'medications', 'condition', 'conditions',
  // Added 2026-08-27, while auditing the AI processing disclosure against the
  // code. That page promised logs do not record "your recovery information",
  // and the promise held only because no call site happened to pass a profile
  // - not because anything stopped one. Washington's My Health My Data Act
  // treats sleep, alcohol, nicotine and eating as consumer health data, which
  // is the same category as the injury fields above, so they belong on the
  // same list. Substring matching means a stray key like `sleepMs` gets
  // redacted too; over-redacting a retry delay costs nothing.
  'sleep', 'alcohol', 'nicotine', 'nutrition',
  // 'medication' above already matches by substring, but glp1 does not contain
  // it. Whether somebody takes a prescription drug is health data by any
  // reading, and naming it explicitly is cheaper than being clever.
  'glp1', 'glp_1', 'semaglutide', 'tirzepatide', 'ozempic', 'wegovy', 'mounjaro', 'zepbound',
  // Added with migration 0053. The obstacle field asks somebody to name what
  // actually stops them, and the honest answers are frequently medical - "my
  // back seizes on squat day", "the meds leave me too tired". The if-then plan
  // names the obstacle it answers, so it carries the same content. Both are in
  // private.health_fingerprint() and both belong here.
  'obstacle', 'if_then', 'ifthen', 'intention',
  // Added 2026-08-29, auditing the policy documents against the code. Migration
  // 0024 declares gender health data ("Health data. woman | man | nonbinary |
  // self_described | prefer_not_to_say"), the consumer health data policy lists
  // it as consumer health data, and this list did not have it - so the page's
  // promise that "health information is never written to application logs" was
  // held up by nothing but the accident that no call site passes a profile.
  // That is the same accident that covered sleep, alcohol, nicotine and
  // nutrition until 2026-08-27, which is twice, and the substring match means
  // gender_self_described - the free-text one - is covered by the same entry.
  //
  // `pronouns` stays OFF this list, deliberately and for the same reason it is
  // outside private.health_fingerprint(): being addressed correctly must not be
  // something a person trades privacy for. See migration 0024.
  'gender',
  'date_of_birth', 'dateofbirth',
  'password', 'access_token', 'refresh_token', 'authorization',
  'apikey', 'api_key',
];

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

function isSensitiveKey(key) {
  const lower = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

/**
 * Recursively strip sensitive values. Returns a new structure; never mutates
 * the input, so redacting for a log line cannot corrupt the object the request
 * is still using.
 */
export function redact(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[max depth]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

function emit(level, message, meta) {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...(meta ? { meta: redact(meta) } : {}),
  };
  // Structured single-line JSON: greppable, and parseable by any log drain.
  const serialised = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(serialised);
  else console.log(serialised);
}

export const logger = {
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
};
