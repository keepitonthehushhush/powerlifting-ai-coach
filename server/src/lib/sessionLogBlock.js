import { z } from 'zod';

/**
 * A session the athlete described in conversation, offered back for them to
 * confirm.
 *
 * ── WHY THIS ONE IS DIFFERENT FROM EVERY OTHER BLOCK ──────────────────────
 *
 * program_data, training_intention and profile_update all WRITE. This one does
 * not. The route parses it, validates it, strips it, and hands it to the
 * browser as a PROPOSAL. Nothing reaches workout_sessions until the athlete
 * taps yes.
 *
 * That is not caution, it is where the value is. A training log is a record of
 * what a person actually did, and it is read back months later to decide
 * whether they are getting stronger. A log with invented sets in it is worse
 * than no log: it is wrong in a way that looks like data, it feeds the
 * progression rules, and the person who has to notice is the one least able
 * to remember what they lifted in March.
 *
 * The model is good at reading "worked up to 315 for a triple, then two back-
 * offs at 275" out of a sentence. It is not the right thing to be certain
 * about it. So it proposes and the athlete confirms, which is the same
 * division of labor the intention block uses for wording.
 *
 * ── AND THE CONFIRM PATH ADDS NO PRIVILEGE ────────────────────────────────
 *
 * On yes, the browser posts the proposal to POST /api/sessions - the endpoint
 * the athlete already owns and could already call with anything they liked.
 * So the coach's suggestion is a pre-filled form, not a new door: there is no
 * write here that the athlete could not already perform, which is why this
 * needs no new table, no new policy and no new grant.
 */

export const SESSION_TAG = 'session_log';

const OPEN = `<${SESSION_TAG}>`;
const CLOSE = `</${SESSION_TAG}>`;

/**
 * Bounded, and the bounds mirror the ones POST /api/sessions already enforces.
 * Deliberately so: a proposal the athlete confirms and the server then rejects
 * is a yes that does nothing, which is the most confusing possible outcome.
 */
const Exercise = z
  .object({
    exercise: z.string().trim().min(1).max(120),
    sets: z.number().int().positive().max(50).optional(),
    reps: z.number().int().positive().max(200).optional(),
    weight: z.number().nonnegative().max(2000).optional(),
    rpe: z.number().min(1).max(10).optional(),
    completed: z.boolean().optional(),
  })
  .strict();

export const SessionLogData = z
  .object({
    // Absent means today. A date the athlete did not give is not a date.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    exercises: z.array(Exercise).min(1).max(60),
    notes: z.string().max(4000).optional(),
  })
  .strict();

/**
 * How far back a proposed date may reach, and that it may not reach forward.
 *
 * Forward is the one that matters: a session dated next Tuesday is a PLAN, and
 * a plan filed as a record makes the progression rules believe work happened
 * that has not. "Log my session for tomorrow" is a reasonable-sounding request
 * and it must not produce a row.
 */
export const MAX_BACKDATE_DAYS = 400;

export function isLoggableDate(date, today = new Date()) {
  if (date === undefined) return true; // means today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return false;
  const when = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(when)) return false;
  const noon = Date.parse(`${today.toISOString().slice(0, 10)}T12:00:00Z`);
  const days = (noon - when) / 86_400_000;
  return days >= 0 && days <= MAX_BACKDATE_DAYS;
}

/** Removes every tag, opened or closed, matched or not. */
function stripAll(text) {
  return text
    .split(OPEN).join('')
    .split(CLOSE).join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits a reply into the prose the athlete reads and the proposed session.
 *
 * @returns {{reply: string, session: object|null, problem: string|null}}
 *   `problem` is for logging only. A coaching reply that ends "(could not
 *   parse your workout)" is noise to somebody who just finished training.
 */
export function extractSessionLogBlock(text, today = new Date()) {
  if (typeof text !== 'string' || !text.includes(OPEN)) {
    return { reply: typeof text === 'string' ? stripAll(text) : '', session: null, problem: null };
  }

  const first = text.indexOf(OPEN);
  const second = text.indexOf(OPEN, first + OPEN.length);
  if (second !== -1) {
    return { reply: stripAll(text), session: null, problem: 'two session blocks' };
  }

  const close = text.indexOf(CLOSE, first);
  if (close === -1) {
    return { reply: stripAll(text), session: null, problem: 'unclosed session block' };
  }

  const raw = text.slice(first + OPEN.length, close);
  const reply = stripAll(text.slice(0, first) + text.slice(close + CLOSE.length));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reply, session: null, problem: 'session block was not JSON' };
  }

  const result = SessionLogData.safeParse(parsed);
  if (!result.success) {
    return { reply, session: null, problem: 'session block failed validation' };
  }

  if (!isLoggableDate(result.data.date, today)) {
    // A future date is a plan. See MAX_BACKDATE_DAYS.
    return { reply, session: null, problem: 'session date is not loggable' };
  }

  return { reply, session: result.data, problem: null };
}
