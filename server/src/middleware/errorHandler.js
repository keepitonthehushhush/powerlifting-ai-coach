import { logger } from '../lib/logger.js';
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
 * Two rules:
 *   1. The stack trace never reaches the client. In production it never
 *      reaches the response body at all; internals are for logs.
 *   2. Everything logged goes through the redacting logger. An error object
 *      from a failed profile write can easily carry the row that failed - and
 *      that row contains health_restrictions.
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

  res.status(status).json({
    error: status === 500 ? 'internal_error' : 'request_failed',
    message:
      status === 500
        ? 'Something went wrong on our end.'
        : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
