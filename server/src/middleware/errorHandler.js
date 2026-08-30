import { logger } from '../lib/logger.js';
import { captureError } from '../lib/monitoring.js';
import { HttpError } from '../lib/httpError.js';
import { recordErrorEvent } from '../lib/errorRecord.js';

// Imported above, then re-exported. `export { X } from './y.js'` alone forwards
// the binding WITHOUT introducing it into this module's scope - so `HttpError`
// was undefined inside errorHandler, and the handler threw a ReferenceError on
// every error it was asked to report. See docs/BUILD_LOG.md D.6.
export { HttpError };

/**
 * How long an error response will wait for its own record. Chosen to be short
 * enough that nobody notices and long enough that a healthy database always
 * makes it.
 */
const RECORD_TIMEOUT_MS = 1200;

export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

/**
 * The status this error is asking to be reported as.
 *
 * Deliberately duck-typed rather than `err instanceof HttpError`. Two reasons,
 * and the second is why this matters in production:
 *
 *   1. Under a bundler or a serverless runtime a module can be instantiated
 *      more than once. Two HttpError classes then exist, `instanceof` is false
 *      for one of them, and a considered 400 is reported to the user as a 500.
 *   2. An `instanceof` against an undefined binding throws. That is exactly
 *      what happened here, inside the one function whose job is to make sure
 *      nothing else throws unhandled.
 *
 * Reading a numeric property cannot fail either way.
 */
function statusOf(err) {
  const status = err?.status ?? err?.statusCode;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

/**
 * Terminal error handler.
 *
 * Four rules:
 *   1. The original error is logged FIRST, before anything that could itself
 *      fail. When this handler threw, it threw on the line above the logging
 *      call, so the error that actually broke the request was never recorded
 *      anywhere - the logs showed only the handler's own failure. An error
 *      reporter that can lose the error is worse than none, because it looks
 *      like it is working.
 *   2. The stack trace never reaches the client. In production it never
 *      reaches the response body at all; internals are for logs.
 *   3. Everything logged goes through the redacting logger. An error object
 *      from a failed profile write can easily carry the row that failed - and
 *      that row contains health_restrictions.
 *   4. Only genuine server faults reach the error tracker. A 400 or a 429 is
 *      the system working correctly; forwarding those trains everyone to
 *      ignore the alerts that matter.
 *
 * NODE_ENV is read directly rather than through config.js on purpose. This is
 * the last line of defense in the request pipeline, and the last thing that
 * should stop working because configuration failed to load.
 */
// Express identifies an error handler BY ARITY: four parameters or it is
// treated as ordinary middleware and never called on an error. `next` is
// unused on purpose, and removing it silently disables this whole file.
// (The linter is configured not to report unused arguments for this reason.)
export async function errorHandler(err, req, res, _next) {
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    const status = statusOf(err);

    logger.error('request.failed', {
      method: req?.method,
      path: req?.path,
      status,
      userId: req?.user?.id,
      error: { name: err?.name, message: err?.message },

      // Validation details, which the client already receives and the logs
      // did not. "Invalid request." is the same sentence whichever field was
      // rejected, so without this a 400 is undiagnosable from the server side
      // - and diagnosing one meant guessing at the client, twice.
      //
      // Safe to log: zod's flatten() yields field NAMES and rule messages
      // ("String must contain at most 4000 character(s)"), never the value
      // that failed. The redacting logger strips anything sensitive that a
      // future error type puts here anyway.
      ...(err?.details ? { details: err.details } : {}),

      ...(isProduction ? {} : { stack: err?.stack }),
    });

    /**
     * ── RECORDED BEFORE THE RESPONSE, NOT AFTER ────────────────────────────
     *
     * A serverless function is frozen the moment it responds, so a write
     * started afterwards dies mid-socket - this project has already lost
     * telemetry that way once, and the symptom was `TypeError: fetch failed`
     * rather than anything resembling a database error.
     *
     * Bounded, because the one thing worse than not recording an error is a
     * slow database turning every error response into a hang. If the bound is
     * reached the row is lost and the request still answers, which is the
     * right way round.
     *
     * It cannot throw: recordErrorEvent swallows everything. The `catch` here
     * is for the timeout race itself.
     */
    try {
      await Promise.race([
        recordErrorEvent(req, { status, details: err?.details }),
        new Promise((resolve) => setTimeout(resolve, RECORD_TIMEOUT_MS)),
      ]);
    } catch {
      // Already logged inside recordErrorEvent. Nothing further to do here.
    }

    if (status >= 500) {
      // captureError redacts again on its way out. The context here is
      // deliberately thin - ids and route, never request bodies.
      captureError(err, { method: req?.method, path: req?.path, userId: req?.user?.id });
    }

    res.status(status).json({
      error: status === 500 ? 'internal_error' : 'request_failed',
      message: status === 500 ? 'Something went wrong on our end.' : err?.message,
      ...(err?.details ? { details: err.details } : {}),
    });
  } catch (handlerFault) {
    // Never delegate to Express's default handler. It would send an HTML error
    // page from a JSON API and, more importantly, this fault would go
    // unrecorded - which is precisely how the original bug stayed invisible.
    try {
      logger.error('errorHandler.failed', {
        error: { name: handlerFault?.name, message: handlerFault?.message },
        original: { name: err?.name, message: err?.message },
      });
    } catch {
      // Logging itself is broken. There is nothing left to try.
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Something went wrong on our end.' });
    }
  }
}
