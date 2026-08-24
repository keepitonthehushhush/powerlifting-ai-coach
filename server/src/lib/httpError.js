/**
 * An error carrying an HTTP status.
 *
 * Deliberately alone in its own module with zero imports. It used to live in
 * middleware/errorHandler.js, which meant anything throwing an HttpError -
 * including the rate limit middleware - transitively imported the error
 * handler, which imports config, which validates the environment and throws at
 * module load. Importing a class should not require production secrets to be
 * present.
 *
 * The general rule this is an instance of: values shared widely should not
 * live in modules that do work at import time.
 */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}
