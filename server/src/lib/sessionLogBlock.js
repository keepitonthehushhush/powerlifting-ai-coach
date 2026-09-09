import { z } from 'zod';

import { KG_PER_LB } from './nutrition.js';

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
    /*
     * POSITIVE, not non-negative. A pull-up has no weight, and the way to say
     * that is to leave the field out - `weight: 0` renders on the card as
     * "Pull-up 4x8 @ 0 lb" and writes a zero into progress_logs, where it is a
     * data point rather than an absence and drags any estimate through it.
     * A zero is dropped rather than refused, below: losing the whole session
     * because one movement had no load would be a worse answer.
     */
    weight: z.number().positive().max(2000).optional(),
    /*
     * THE UNIT THE ATHLETE SAID IT IN, which is not always the one on their
     * profile. "I squatted 100 kilos today" from somebody set to pounds has
     * no field to land in without this, and the card would show "100 lb" -
     * a confident wrong label on a number a human is being asked to confirm,
     * which is the exact thing the units comment in chat.js says to avoid.
     * Converted to the profile's unit before anybody sees it.
     */
    unit: z.enum(['lb', 'kg']).optional(),
    rpe: z.number().min(1).max(10).optional(),
    completed: z.boolean().optional(),
  })
  .strict();

export const SessionLogData = z
  .object({
    // Absent means today. A date the athlete did not give is not a date.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    exercises: z.array(Exercise).min(1).max(60),
    /*
     * THERE IS DELIBERATELY NO NOTES FIELD, and POST /api/sessions accepting
     * one is not a reason to offer it here.
     *
     * `notes` is up to four thousand characters, and the card cannot show four
     * thousand characters. So it would reach the database as model-authored
     * free text that the person tapping yes never read - the one place in this
     * feature where "the athlete confirmed it" would be false. The notes on a
     * session are the athlete's own words about their own training and they
     * can write them on the log page.
     */
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

/**
 * A DAY OF SLACK IN THE FUTURE, because the server is in UTC and nobody lives
 * there.
 *
 * An athlete in Sydney at nine on Tuesday morning is still on Monday by UTC.
 * They say "log Tuesday" - correctly, it is Tuesday where they are - and a
 * strict `days >= 0` calls their own today a plan and drops the block, with
 * nothing shown to them at all. Every UTC+ athlete would lose the feature for
 * most of their waking day.
 *
 * The widest offsets in use are about +14 and -12, so a single day covers
 * every timezone on earth while still refusing next week. This is the cheap
 * half of the fix; the other half is that the BROWSER supplies the date when
 * the coach did not, because the browser is the only participant that knows
 * what day it is where the athlete is standing.
 */
export const FUTURE_SLACK_DAYS = 1;

export function isLoggableDate(date, today = new Date()) {
  if (date === undefined) return true; // means today, resolved by the browser
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return false;
  const when = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(when)) return false;
  const noon = Date.parse(`${today.toISOString().slice(0, 10)}T12:00:00Z`);
  const days = (noon - when) / 86_400_000;
  return days >= -FUTURE_SLACK_DAYS && days <= MAX_BACKDATE_DAYS;
}

/**
 * Put every weight into the unit the profile stores, and drop the ones that
 * are not weights.
 *
 * Same division of labour as the bodyweight write: the model reports what the
 * athlete SAID, including which unit they said it in, and the arithmetic
 * happens here where it can be tested. A conversion done in the model's head
 * is a factor of 2.2 waiting for a bad day.
 *
 * @returns {object|null} null when the profile's unit cannot be named, because
 *   a weight relabelled into a unit we are guessing at is worse than no card.
 */
export function toProfileWeights(session, profileUnits) {
  const to = profileUnits === 'kg' || profileUnits === 'lb' ? profileUnits : null;
  if (!to || !session) return null;

  const exercises = session.exercises.map((movement) => {
    const { unit, weight, ...rest } = movement;
    if (weight === undefined) return rest;
    const from = unit ?? to; // unstated means they used their own unit
    const converted =
      from === to ? weight : from === 'kg' ? weight / KG_PER_LB : weight * KG_PER_LB;
    return { ...rest, weight: Math.round(converted * 10) / 10 };
  });

  return { ...session, exercises };
}

/**
 * A stable key for a proposed session, so the same workout cannot be written
 * twice.
 *
 * ── WHY IT IS DERIVED FROM THE CONTENT ────────────────────────────────────
 *
 * There are two ways one session becomes two rows, and only a content key
 * closes both. A per-request token stops a RETRY after a save that failed
 * late; it does nothing when the coach offers the same session again in a
 * later turn, because that is a genuinely new request. The date and the
 * movements are the same string both times.
 *
 * FNV-1a, and it does not need to be better than that. This is a duplicate
 * guard, not a security boundary: the worst a collision does is refuse a
 * second session that happened to hash the same, and the manual log form
 * takes it. A cryptographic digest in the browser is async, which would put
 * an await in the middle of a confirm handler to buy nothing.
 *
 * The canonical form sorts nothing and rounds nothing - two descriptions that
 * differ in any field are different sessions, which is the safe direction to
 * be wrong in.
 */
export function sessionKey(session) {
  if (!session || !Array.isArray(session.exercises)) return null;
  const canonical = JSON.stringify([
    session.date ?? '',
    session.exercises.map((m) => [m.exercise, m.sets ?? '', m.reps ?? '', m.weight ?? '', m.rpe ?? '', m.completed ?? '']),
  ]);

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    // The FNV prime, by shifts, because a 32-bit multiply overflows a double.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The key a write actually gets: null for anything the athlete typed, a
 * content key for something the coach proposed.
 *
 * This is a function rather than a ternary at the insert because the RULE is
 * the interesting part and a ternary cannot be tested. Two properties matter
 * and both are asserted directly:
 *
 *   - A MANUAL ENTRY IS NEVER GIVEN A KEY. Postgres allows many NULLs in a
 *     unique index, so somebody logging the same workout by hand twice is
 *     never fought. They meant it; they typed it twice.
 *   - THE SAME PROPOSAL ALWAYS GETS THE SAME KEY, which is what makes a
 *     retry and a re-offer land on one row.
 *
 * The flag comes from the browser, and that is the whole of what is trusted:
 * "this came from the card." The key itself is derived HERE, from the body
 * being written, so a client cannot hand over a string that quietly reserves
 * a key some future real session would need.
 */
export function clientKeyForWrite({ fromCoach, date, exercises }) {
  if (!fromCoach) return null;
  return sessionKey({ date, exercises });
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

  /*
   * ── A FAILED BLOCK MUST NOT BE READ ALOUD ─────────────────────────────
   *
   * stripAll removes the TAGS and leaves everything between them, which is
   * right when there is nothing between them and wrong here. The prompt puts
   * this block at the very end of the reply, which is exactly where the output
   * cap cuts - so the ordinary truncated reply is one whose block is unclosed,
   * and the athlete would have read:
   *
   *   Strong work, that is a solid triple. {"exercises": [{"exercise": "Back
   *
   * The JSON-parse branch below already gets this right by cutting at `first`.
   * These two did not.
   */
  const first = text.indexOf(OPEN);
  const second = text.indexOf(OPEN, first + OPEN.length);
  if (second !== -1) {
    // Two blocks is ambiguous and guessing which session they meant is exactly
    // the wrong instinct. Keep only the prose before the first one.
    return { reply: stripAll(text.slice(0, first)), session: null, problem: 'two session blocks' };
  }

  const close = text.indexOf(CLOSE, first);
  if (close === -1) {
    return { reply: stripAll(text.slice(0, first)), session: null, problem: 'unclosed session block' };
  }

  const raw = text.slice(first + OPEN.length, close);
  const reply = stripAll(text.slice(0, first) + text.slice(close + CLOSE.length));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reply, session: null, problem: 'session block was not JSON' };
  }

  /*
   * A zero weight is an absence written down as a number - a pull-up, a dip,
   * an empty bar. Dropped BEFORE validation, because `.positive()` would
   * otherwise refuse the whole session over one bodyweight movement.
   */
  if (parsed && Array.isArray(parsed.exercises)) {
    for (const movement of parsed.exercises) {
      if (movement && movement.weight === 0) delete movement.weight;
    }
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
