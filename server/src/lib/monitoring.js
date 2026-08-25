import { redact } from './logger.js';

// NODE_ENV is read directly rather than through config.js, and that import is
// deliberately absent. Monitoring and the error handler that calls it are the
// machinery for finding out WHY something failed - a configuration failure
// included. Making them depend on configuration loading successfully means
// they go dark in exactly the case they exist for.

/**
 * Error monitoring, with health data stripped before anything leaves the
 * process.
 *
 * The problem with any error tracker in an application like this one: error
 * events are extremely good at hoovering up context. A failed profile write
 * carries the request body. A failed query carries the parameters. A stack
 * frame carries local variables. Any of those can contain
 * `health_restrictions` - and once it has been transmitted to a third party's
 * servers, no amount of scrubbing on their side undoes it.
 *
 * So `beforeSend` runs the same redactor the logger uses over the ENTIRE event
 * object, not over a hand-picked list of fields. The rule is: if a key looks
 * health-related or credential-shaped anywhere in the payload, at any depth, it
 * does not leave this process. Combined with the redactor's substring matching,
 * a field added later called `injury_notes` or `medicalFlags` is covered
 * without anyone remembering to update a scrubbing config.
 *
 * The SDK is loaded dynamically and only when a DSN is configured. Monitoring
 * is genuinely optional: the app runs identically without it, and a missing or
 * uninstalled SDK degrades to a warning rather than a boot failure.
 */

let sentry = null;

export async function initMonitoring() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return { enabled: false, reason: 'SENTRY_DSN not set' };

  try {
    const Sentry = await import('@sentry/node');

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,

      // Performance sampling off by default: traces attach request data, which
      // is another route for health information to escape. Turn it on
      // deliberately, not by inheriting a template.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),

      // Do not let the SDK attach request bodies, cookies or headers on its
      // own. Everything that reaches Sentry should pass through beforeSend.
      sendDefaultPii: false,

      beforeSend(event) {
        const scrubbed = redact(event);

        // The redactor handles keys. Request bodies and query strings are
        // dropped wholesale regardless, because their SHAPE is user-defined
        // and a key-based rule cannot anticipate every name a client might use.
        if (scrubbed.request) {
          delete scrubbed.request.data;
          delete scrubbed.request.cookies;
          delete scrubbed.request.query_string;
          if (scrubbed.request.headers) {
            scrubbed.request.headers = { 'user-agent': scrubbed.request.headers['user-agent'] };
          }
        }

        // Local variables captured in stack frames are the subtlest leak of
        // all: `profile` is in scope in half the routes in this codebase.
        if (scrubbed.exception?.values) {
          for (const value of scrubbed.exception.values) {
            for (const frame of value.stacktrace?.frames ?? []) delete frame.vars;
          }
        }

        return scrubbed;
      },

      beforeBreadcrumb(breadcrumb) {
        // Breadcrumbs record outbound HTTP calls, including the Supabase query
        // that failed. Keep the fact and the category, drop the payload.
        if (breadcrumb.data) breadcrumb.data = redact(breadcrumb.data);
        return breadcrumb;
      },
    });

    sentry = Sentry;
    return { enabled: true };
  } catch (err) {
    // A monitoring tool that can break the application it monitors is worse
    // than no monitoring tool.
    return {
      enabled: false,
      reason: `@sentry/node unavailable (${err.message}). Continuing without error monitoring.`,
    };
  }
}

/**
 * Report an error. A no-op when monitoring is disabled, so call sites need no
 * conditional.
 *
 * `context` passes through the redactor here as well - defence in depth, so a
 * call site cannot bypass scrubbing by attaching a profile object directly.
 */
export function captureError(error, context = {}) {
  if (!sentry) return;
  sentry.captureException(error, { extra: redact(context) });
}

export function isMonitoringEnabled() {
  return sentry !== null;
}
