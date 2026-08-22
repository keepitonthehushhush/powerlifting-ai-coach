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
 * hurry. Centralising it means the unsafe thing is hard to do by accident -
 * you would have to bypass the logger entirely.
 *
 * SENSITIVE_KEYS is deliberately broader than the current schema, so a field
 * added later with an obvious name is covered before anyone remembers to
 * update this list.
 */

const SENSITIVE_KEYS = [
  'health_restrictions', 'healthrestrictions',
  'injury', 'injuries', 'medical', 'diagnosis',
  'medication', 'medications', 'condition', 'conditions',
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
