import { Router } from 'express';
import { z } from 'zod';
import { codedError } from '../lib/errorCodes.js';
import { logger } from '../lib/logger.js';
import {
  CLIENT_ERROR_CODES,
  TOP_FRAME_PATTERN,
} from '../../../web/src/lib/crashReport.js';

/**
 * Where a browser says what went wrong with it.
 *
 * ── WHY THE VOCABULARY IS IMPORTED AND NOT RETYPED ────────────────────────
 *
 * The list of codes and the shape of a stack coordinate are decided in
 * web/src/lib/crashReport.js, because that is where the browser builds the
 * report. Copying either one here would create two definitions of "what a
 * client may send", and this project has been bitten twice by two copies of
 * one fact drifting apart - most recently by a length floor that the judge
 * prompt described and the verifier enforced differently.
 *
 * Same reason appCapabilities.js is imported into the system prompt rather
 * than described twice.
 *
 * ── THREE PLACES SAY NO, AND THAT IS DELIBERATE ───────────────────────────
 *
 *   the browser   builds only the four permitted keys
 *   this route    refuses anything else, by schema
 *   the database  refuses anything else, by CHECK constraint, and refuses a
 *                 topFrame that is not a coordinate
 *
 * The browser's restraint is a promise; the other two are properties. A
 * modified client, a replayed request, or a future edit to this file that
 * loosens the schema still cannot put a sentence somebody typed into the
 * error table. That is the point of the constraint in 0048 - it makes the
 * privacy claim in the README true by construction rather than by review.
 */
export const clientErrorsRouter = Router();

/**
 * Deliberately strict, and `.strict()` is the load-bearing word: an unknown
 * key is a rejection, not a silent drop. A silent drop is how a client starts
 * sending a `message` field that nobody notices is being ignored, right up
 * until somebody "fixes" the server to store it.
 */
const detailSchema = z
  .object({
    errorName: z.string().regex(/^[A-Za-z]{1,40}$/),
    topFrame: z.string().regex(TOP_FRAME_PATTERN).nullable(),
    frames: z.number().int().min(0).max(1000),
    build: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  })
  .strict();

const reportSchema = z
  .object({
    code: z.enum(CLIENT_ERROR_CODES),
    // The same pattern the error_events.route CHECK enforces.
    route: z.string().regex(/^\/[A-Za-z0-9/_-]{0,80}$/),
    detail: detailSchema,
  })
  .strict();

/** POST /api/client-errors */
clientErrorsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      // The body is not echoed back and is not logged. A rejected report is
      // rejected precisely because we do not know what is in it.
      throw codedError('invalid_request', 'That is not a report this endpoint accepts.');
    }

    const { code, route, detail } = parsed.data;

    const { error } = await req.supabase.rpc('record_client_error_event', {
      p_code: code,
      p_route: route,
      p_detail: detail,
    });

    if (error) {
      // Logged, not thrown, for the same reason recordErrorEvent does it: a
      // failure to record a failure is worth knowing about and is not worth
      // returning an error to a browser that is already having a bad time.
      logger.warn('client_error.not_recorded', { code, cause: error.code });
    }

    // Nothing to say back. The browser is not waiting on an answer and in the
    // crash case may not exist by the time this lands.
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
