import { extractProgramBlock } from './programBlock.js';

/**
 * Ask once more for the program block the coach wrote a session without.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The Program page is the only durable memory in this product. The
 * conversation window holds a fixed number of recent messages; everything
 * before it is gone by definition. So when the coach writes a session in
 * prose and does not emit a <program_data> block, the athlete gets a workout
 * they can follow today and the app forgets it happened - and next week the
 * coach cannot say what week they are on, because nothing recorded it.
 *
 * That is exactly what an athlete reported: a session arrived, the Program
 * tab did not change. The prompt has always asked for the block. Asking is
 * the first line of defense and it is not sufficient on its own, which is the
 * same conclusion this route already reached about the clearance gate.
 *
 * ── WHY A SECOND CALL RATHER THAN A BETTER INSTRUCTION ────────────────────
 *
 * Because the instruction is already there and this still happened. A model
 * that has just written four hundred words of coaching has spent its
 * attention on the coaching; the machine-readable copy is the thing most
 * easily dropped, and no amount of emphasis makes "never forget" reliable.
 *
 * The repair is cheap in the way that matters: the system prompt is
 * unchanged, so it is a cache read rather than a cache write, and the output
 * is one line of JSON rather than a coaching reply.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not rewrite, re-plan, or second-guess the session. It transcribes
 * what the coach already said into the block format. If the model comes back
 * with something unusable, that is the end of it - one attempt, then the
 * outcome is recorded and the athlete keeps the reply they already have. A
 * repair that can fail twice is a latency problem wearing a correctness
 * costume.
 */

/** Does this prose actually prescribe training, or is it a conversation? */
export function prescribesTraining(text) {
  if (typeof text !== 'string') return false;
  // Same shape the safety eval uses to decide whether a reply is a program:
  // a sets-by-reps pair, or two or more day/week headings.
  const setsAndReps = /\b\d+\s*[x×]\s*\d+\b/.test(text);
  const dayHeadings = (text.match(/\b(day|week|session)\s*\d/gi) || []).length >= 2;
  return setsAndReps || dayHeadings;
}

const INSTRUCTION = `You wrote the session above without a usable <program_data> block.

Emit ONLY that block now, describing exactly the session you just wrote. Do not rewrite
it, do not change any weight or rep count, do not add or remove movements, and do not
write anything else - no greeting, no explanation, no apology. Transcribe what you
already said.

If the reply above genuinely contains no prescribed training - if it was a question, a
refusal, or a conversation - reply with the single word NONE.`;

/**
 * @param {object}   options
 * @param {Function} options.callModel  (system, messages) => Promise<{text}>
 * @param {Array}    options.system     the same system blocks as the first call
 * @param {Array}    options.messages   the conversation sent to the first call
 * @param {string}   options.reply      the coach's prose, blocks already stripped
 * @returns {Promise<{program: object|null, outcome: 'repaired'|'declined'|'unusable'|'failed',
 *                    usage: object|null, model: string|null}>}
 *
 * `usage` and `model` come back so the caller can bill this call. A second
 * request that does not appear in the cost line is a request that will be
 * blamed on something else the next time the unit economics are measured.
 */
export async function repairProgramBlock({ callModel, system, messages, reply }) {
  let result;
  try {
    result = await callModel(system, [
      ...messages,
      { role: 'assistant', content: reply },
      { role: 'user', content: INSTRUCTION },
    ]);
  } catch {
    // A repair that throws must never take the coaching reply down with it.
    // The athlete already has their session; this is bookkeeping.
    return { program: null, outcome: 'failed', usage: null, model: null };
  }

  const usage = result?.usage ?? null;
  const model = result?.model ?? null;
  const text = result?.text;

  if (typeof text !== 'string' || /^\s*NONE\s*$/i.test(text)) {
    return { program: null, outcome: 'declined', usage, model };
  }

  const { program } = extractProgramBlock(text);
  return program
    ? { program, outcome: 'repaired', usage, model }
    : { program: null, outcome: 'unusable', usage, model };
}
