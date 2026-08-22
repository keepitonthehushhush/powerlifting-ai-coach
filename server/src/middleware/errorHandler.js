import { logger } from '../lib/logger.js';
import { captureError } from '../lib/monitoring.js';
import { config } from '../config.js';

/**
 * A thrown error carrying an HTTP status. Lets routes signal intent
 * (`throw new HttpError(400, 'message too long')`) without every route
 * needing to know how responses are shaped.
 */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

/**
 * Terminal error handler.
 *
 * Three rules:
 *   1. The stack trace never reaches the client. In production it never
 *      reaches the response body at all; internals are for logs.
 *   2. Everything logged goes through the redacting logger. An error object
 *      from a failed profile write can easily carry the row that failed - and
 *      that row contains health_restrictions.
 *   3. Only genuine server faults reach the error tracker. A 400 or a 429 is
 *      the system working correctly; forwarding those trains everyone to
 *      ignore the alerts that matter.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500;

  logger.error('request.failed', {
    method: req.method,
    path: req.path,
    status,
    userId: req.user?.id,
    error: { name: err.name, message: err.message },
    ...(config.isProduction ? {} : { stack: err.stack }),
  });

  if (status >= 500) {
    // captureError redacts again on its way out. The context here is
    // deliberately thin - ids and route, never request bodies.
    captureError(err, { method: req.method, path: req.path, userId: req.user?.id });
  }

  res.status(status).json({
    error: status === 500 ? 'internal_error' : 'request_failed',
    message:
      status === 500
        ? 'Something went wrong on our end.'
        : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
