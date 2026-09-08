import { z } from 'zod';

/**
 * A fact the athlete stated about themselves, written back to their profile.
 *
 * Today that is exactly one field: bodyweight. The mechanism is general and
 * the WHITELIST IS THE SAFETY BOUNDARY - a field is writable from a
 * conversation only because somebody decided it should be, one at a time, with
 * the reason written down. Widening it is a deliberate edit here.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Bodyweight goes stale, and a stale one is not inert. It feeds the plausibility
 * checks and the bodyweight-relative work in equipment.js, so an athlete who has
 * gained fifteen pounds since intake is being coached against a number that is
 * no longer true. They say the real one out loud in conversation all the time -
 * "I'm 205 now" - and until this existed, the coach heard it, used it for that
 * reply, and forgot it. The correction lived in the transcript and never
 * reached the record.
 *
 * ── WHY IT IS A BLOCK AND NOT A TOOL ──────────────────────────────────────
 *
 * Because "the coach is given no tools to call" is a safety property of this
 * product, pinned by a test. programBlock.js states the argument in full and it
 * has not changed: the blast radius of a prompt injection today is one athlete
 * hearing something wrong, and the moment the model can invoke something, that
 * stops being true. The coach still only produces text. We read some of it more
 * carefully.
 *
 * ── WHY THE UNIT IS IN THE BLOCK AND THE ARITHMETIC IS NOT ────────────────
 *
 * A profile stores bodyweight in the athlete's own units, so "I'm 84 kilos"
 * from somebody whose profile is in pounds must not be written as 84. The model
 * could convert - and would, mostly. Mostly is the problem: a silent unit error
 * writes a number that is wrong by a factor of 2.2, is inside every bound we
 * could check, and looks completely ordinary on the account page.
 *
 * So the block reports WHAT THE ATHLETE SAID, unit included, and the conversion
 * happens here, in a function with a test. The model does the part it is good
 * at - understanding that "eighty-four kilos" is a bodyweight - and arithmetic
 * we can prove does the part it is not.
 *
 * ── AND IT IS VISIBLE ─────────────────────────────────────────────────────
 *
 * Unlike the intention block, which is deliberately silent, a recorded
 * bodyweight is reported back to the athlete with a link to the page where they
 * can change it. This is a SETTING THEY OWN. A setting that changes because
 * something misheard a sentence, with nothing on screen to say so, is a bug
 * nobody can report - and the whole reason it is safe to write from a
 * conversation is that the athlete sees it and can undo it.
 */

/** A tag rather than a fence, for the reason programBlock.js gives: coaching
 *  prose contains code fences, and a delimiter that collides with its content
 *  is not a delimiter. */
export const PROFILE_TAG = 'profile_update';

const OPEN = `<${PROFILE_TAG}>`;
const CLOSE = `</${PROFILE_TAG}>`;

/** Pounds in a kilogram. The international avoirdupois pound is defined as
 *  exactly 0.45359237 kg, so this is a definition rather than a measurement. */
export const LB_PER_KG = 1 / 0.45359237;

/**
 * Bounds are on the ATHLETE'S number, before conversion, and they are wider
 * than any real person on purpose: this is a sanity check against a misparse,
 * not a judgment about bodies. 20-1000 lb and 9-454 kg both land inside the
 * `bodyweight > 0` check on the column and the max of 1000 in profileSchema.js.
 */
export const ProfileUpdateData = z
  .object({
    bodyweight: z.number().positive().max(1000),
    units: z.enum(['lb', 'kg']),
  })
  .strict()
  .refine(({ bodyweight, units }) => (units === 'kg' ? bodyweight >= 9 : bodyweight >= 20), {
    message: 'below any plausible bodyweight for the unit given',
  })
  .refine(({ bodyweight, units }) => (units === 'kg' ? bodyweight <= 454 : bodyweight <= 1000), {
    message: 'above any plausible bodyweight for the unit given',
  });

/**
 * The athlete's stated weight, in the units their profile stores.
 *
 * Rounded to two decimals because the column is numeric(6,2) and a value the
 * database is going to round anyway should be rounded where it can be tested.
 *
 * @returns {number|null} null when either unit is unrecognized - a conversion
 *   we cannot name is not one we should guess at.
 */
export function toProfileUnits(value, statedUnits, profileUnits) {
  if (!Number.isFinite(value)) return null;
  const from = statedUnits === 'kg' || statedUnits === 'lb' ? statedUnits : null;
  // A profile with no units set is in pounds; that is the default everywhere
  // else in this app, including the intake form.
  const to = profileUnits === 'kg' ? 'kg' : profileUnits === 'lb' || !profileUnits ? 'lb' : null;
  if (!from || !to) return null;

  const converted =
    from === to ? value : from === 'kg' ? value * LB_PER_KG : value / LB_PER_KG;
  return Math.round(converted * 100) / 100;
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
 * Splits a reply into the prose the athlete reads and the profile update, if any.
 *
 * @returns {{reply: string, update: object|null, problem: string|null}}
 *   `problem` is for logging only. A coaching reply that ends "(could not save
 *   your weight)" is alarming and actionable by nobody.
 */
export function extractProfileUpdateBlock(text) {
  if (typeof text !== 'string' || !text.includes(OPEN)) {
    // No open tag is the ordinary case, and it is NOT the same as no tags at
    // all: a lone closing tag would otherwise be printed at the athlete
    // verbatim, which is the bug programBlock.js records having shipped.
    return { reply: typeof text === 'string' ? stripAll(text) : '', update: null, problem: null };
  }

  const first = text.indexOf(OPEN);
  const second = text.indexOf(OPEN, first + OPEN.length);
  if (second !== -1) {
    // Two blocks is ambiguous, and guessing which weight the athlete meant is
    // exactly the wrong instinct. Store nothing, strip both.
    return { reply: stripAll(text), update: null, problem: 'two profile blocks' };
  }

  const close = text.indexOf(CLOSE, first);
  if (close === -1) {
    // Truncated mid-block. The prose before it is still worth delivering, and
    // a half-read number is not worth writing to anybody's profile.
    return { reply: stripAll(text), update: null, problem: 'unclosed profile block' };
  }

  const raw = text.slice(first + OPEN.length, close);
  const reply = stripAll(text.slice(0, first) + text.slice(close + CLOSE.length));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reply, update: null, problem: 'profile block was not JSON' };
  }

  const result = ProfileUpdateData.safeParse(parsed);
  if (!result.success) {
    // The reason and never the value. This goes to a log line, and a
    // bodyweight is a fact about somebody's body.
    return { reply, update: null, problem: 'profile block failed validation' };
  }

  return { reply, update: result.data, problem: null };
}
