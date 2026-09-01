import { z } from 'zod';

/**
 * Turning the coach's prose program into a record we can store, print, and
 * measure logged sessions against.
 *
 * ── WHY NOT TOOL USE, WHICH IS THE OBVIOUS ANSWER ─────────────────────────
 *
 * Because "the coach is given no tools to call" is a safety property of this
 * product, pinned by a test that says so, and it is worth more than the
 * convenience. Excessive agency is the failure mode where a prompt injection
 * stops being a rude reply and starts being an action. Today the blast radius
 * of a successful injection is that one athlete's coach says something wrong
 * to them; the moment the model can invoke something, that stops being true.
 *
 * A second extraction call would have preserved that property too, and was the
 * runner-up. It costs an extra request per program and introduces a second
 * model whose output we would also have to validate - all to read structure
 * out of text the first model had already structured.
 *
 * So: the coach appends a delimited block, we parse it here, and we strip it
 * before the athlete ever sees the reply. No tools, no second call, no new
 * capability. The model still only produces text; we simply read some of it
 * more carefully.
 *
 * ── THIS IS MODEL OUTPUT BEING PERSISTED, SO IT IS BOUNDED ────────────────
 *
 * Everything below has a length, a range, or a count. Not because the model is
 * expected to be hostile - it is our own prompt - but because an athlete's
 * free text reaches that model, and "the model wrote it" is not a provenance
 * that justifies storing arbitrary JSON in a database row that is later
 * rendered to a page.
 *
 * ── AND IT NEVER BREAKS THE CONVERSATION ──────────────────────────────────
 *
 * A malformed block is dropped, silently as far as the athlete is concerned,
 * and the prose reply is delivered exactly as it would have been. Same rule as
 * the usage metrics: bookkeeping must never cost somebody the coaching they
 * already received. The block is stripped from the reply whether or not it
 * parsed, because a visible chunk of JSON is a worse failure than a missing
 * record.
 */

/**
 * A tag rather than a markdown fence.
 *
 * Fences appear in ordinary coaching prose - the coach quite reasonably
 * formats a week's training as a code block sometimes - and a delimiter that
 * collides with the content it delimits is not a delimiter.
 */
export const PROGRAM_TAG = 'program_data';

const OPEN = `<${PROGRAM_TAG}>`;
const CLOSE = `</${PROGRAM_TAG}>`;

/** Mirrors the CHECK constraint on workout_programs.phase in migration 0001. */
export const PHASES = ['novice', 'intermediate', 'peaking'];

const Exercise = z.object({
  lift: z.string().min(1).max(120),
  sets: z.number().int().min(1).max(20),
  reps: z.number().int().min(1).max(100),
  // Nullable rather than optional: "bodyweight" and "the empty bar" are real
  // answers, and a missing weight must not become a zero that the printed
  // plan then shows as 0lb.
  weight: z.number().min(0).max(2000).nullable().default(null),
  notes: z.string().max(300).nullish(),
});

const Day = z.object({
  name: z.string().min(1).max(80),
  exercises: z.array(Exercise).min(1).max(12),
});

export const ProgramData = z
  .object({
    phase: z.enum(PHASES),
    week: z.number().int().min(1).max(520),
    days: z.array(Day).min(1).max(7),
    summary: z.string().max(600).nullish(),
  })
  .strict();

/**
 * Splits a reply into the text the athlete sees and the program, if any.
 *
 * @param {string} text the raw model reply
 * @returns {{reply: string, program: object|null, problem: string|null}}
 *   `problem` is for logging only. It is never shown to anybody: a coaching
 *   reply that ends "(could not save your program)" is alarming and
 *   actionable by nobody.
 */
export function extractProgramBlock(text) {
  if (typeof text !== 'string' || !text.includes(OPEN)) {
    /*
     * No open tag is the ordinary case - most replies carry no program - but
     * it is not the same as "no tags at all". A model that hallucinates a
     * lone `</program_data>` used to have it printed verbatim, because this
     * returned before anything looked. stripAll removes a stray close and
     * leaves the prose around it; with no tags at all it is a trim.
     */
    return { reply: typeof text === 'string' ? stripAll(text) : '', program: null, problem: null };
  }

  const opens = text.split(OPEN).length - 1;
  const closes = text.split(CLOSE).length - 1;

  // More than one block is ambiguous about which is the program, and a missing
  // close means the reply was truncated mid-block. Strip what can be stripped
  // and store nothing rather than guess.
  if (opens !== 1 || closes !== 1) {
    return {
      reply: stripAll(text),
      program: null,
      problem: `expected one ${PROGRAM_TAG} block, found ${opens} open and ${closes} close`,
    };
  }

  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);
  if (end < start) {
    return { reply: stripAll(text), program: null, problem: 'closing tag precedes the opening tag' };
  }

  const raw = text.slice(start + OPEN.length, end);
  const reply = (text.slice(0, start) + text.slice(end + CLOSE.length)).trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { reply, program: null, problem: `block is not valid JSON: ${err.message}` };
  }

  const result = ProgramData.safeParse(parsed);
  if (!result.success) {
    return { reply, program: null, problem: `block failed validation: ${result.error.message}` };
  }

  return { reply, program: result.data, problem: null };
}

/**
 * Removes every tag and anything between the first open and the last close.
 *
 * ── THE TRUNCATED BLOCK, AND WHY IT REACHED SOMEBODY'S SCREEN ─────────────
 *
 * Reported with a screenshot on 2026-08-31. A reply hit the output ceiling
 * partway through the program block, so the text carried one open tag and no
 * close. That lands in the `opens !== 1 || closes !== 1` branch above and
 * comes here - and the old last line removed only the TAG CHARACTERS, leaving
 * the half-written JSON in the reply. The athlete was shown
 *
 *     {"phase":"intermediate","week":20,"summary":"Push/lower-
 *
 * followed by the app's own "this reply stops early" note. Machine output, in
 * a coaching conversation, immediately under a paragraph about bracing.
 *
 * Nothing failed. `problem` was set and logged exactly as designed, the
 * program was correctly not saved, and the reply was returned - with the
 * wreckage still in it, because "strip the tags" and "strip the block" are
 * different operations and only one of them was implemented for this case.
 *
 * An open tag with no close after it means the reply was cut off inside the
 * block. There is nothing after it to keep, so everything from the tag to the
 * end goes.
 */
function stripAll(text) {
  const first = text.indexOf(OPEN);
  const last = text.lastIndexOf(CLOSE);
  if (first !== -1 && last > first) {
    return (text.slice(0, first) + text.slice(last + CLOSE.length)).trim();
  }
  // Opened and never closed: the rest of the text IS the partial block.
  if (first !== -1) return text.slice(0, first).trim();
  // A stray close with no open. Drop the tag; the prose around it is real.
  return text.split(CLOSE).join('').trim();
}

/**
 * Counts the prescribed work, for the "measure sessions against the plan" half
 * of this. Kept here rather than in the page so the printed plan and any
 * future comparison agree on what a program contains.
 */
export function summariseProgram(program) {
  if (!program) return null;
  const exercises = program.days.flatMap((day) => day.exercises);
  return {
    phase: program.phase,
    week: program.week,
    days: program.days.length,
    exercises: exercises.length,
    totalSets: exercises.reduce((sum, e) => sum + e.sets, 0),
    lifts: [...new Set(exercises.map((e) => e.lift.toLowerCase()))].sort(),
  };
}
