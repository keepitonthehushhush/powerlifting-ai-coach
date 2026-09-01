import { z } from 'zod';

/**
 * The obstacle and the if-then plan, recorded from the conversation that made
 * them.
 *
 * ── WHY THE COACH EMITS THIS RATHER THAN THE ATHLETE TYPING IT ─────────────
 *
 * Because the sequence that produces a usable answer is a conversation, and a
 * form cannot have it. The evidence behind mental contrasting is about
 * CONTRASTING - naming the wish, then naming the obstacle against it, and being
 * pushed past the first answer when the first answer is a circumstance rather
 * than a behavior. "No time" is a calendar. "I open my laptop after dinner and
 * it is suddenly ten" is an obstacle. Getting from the first to the second is
 * what the coach is for, and a text box on the profile page cannot do it.
 *
 * So the coach runs the sequence, the athlete confirms the wording, and the
 * coach emits the result in a block the route stores - exactly the shape
 * programBlock.js already established, for the same reason: a thing that must
 * survive the conversation cannot live in the conversation.
 *
 * ── WHY IT IS A SEPARATE TAG AND NOT A FIELD ON THE PROGRAM BLOCK ──────────
 *
 * They have different lifetimes. A program is replaced every block; an if-then
 * plan is meant to outlive several of them, and folding it into program_data
 * would silently discard it every time a new program was written. They are also
 * governed differently - the plan is health data and the program is not.
 */

/** A tag rather than a fence, for the reason programBlock.js gives: coaching
 *  prose contains code fences, and a delimiter that collides with its content
 *  is not a delimiter. */
export const INTENTION_TAG = 'training_intention';

const OPEN = `<${INTENTION_TAG}>`;
const CLOSE = `</${INTENTION_TAG}>`;

/**
 * Bounded because it is model output being written to a health column.
 *
 * 400 characters each: long enough for the specific, situational sentence that
 * makes an obstacle useful, short enough that it cannot become a transcript.
 * `.strict()` because an unknown key is a model doing something we did not ask
 * for, and the right response to that is to store nothing rather than to store
 * the parts we recognize.
 */
export const IntentionData = z
  .object({
    obstacle: z.string().trim().min(1).max(400),
    plan: z.string().trim().min(1).max(400),
  })
  .strict();

/** Removes every tag, opened or closed, matched or not. */
function stripAll(text) {
  return text
    .split(OPEN).join('')
    .split(CLOSE).join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits a reply into the prose the athlete reads and the intention, if any.
 *
 * @returns {{reply: string, intention: object|null, problem: string|null}}
 *   `problem` is for logging only and is never shown. A coaching reply that
 *   ends "(could not save your plan)" is alarming and actionable by nobody.
 */
export function extractIntentionBlock(text) {
  if (typeof text !== 'string' || !text.includes(OPEN)) {
    // No open tag is the ordinary case. It is NOT the same as no tags at all:
    // a lone closing tag would otherwise be printed at the athlete verbatim,
    // which is the bug programBlock.js records having shipped.
    return { reply: typeof text === 'string' ? stripAll(text) : '', intention: null, problem: null };
  }

  const first = text.indexOf(OPEN);
  const second = text.indexOf(OPEN, first + OPEN.length);
  if (second !== -1) {
    // Two blocks is ambiguous and guessing which one the athlete agreed to is
    // exactly the wrong instinct. Store nothing, strip both.
    return { reply: stripAll(text), intention: null, problem: 'two intention blocks' };
  }

  const close = text.indexOf(CLOSE, first);
  if (close === -1) {
    // Truncated mid-block. The prose before it is still worth delivering.
    return { reply: stripAll(text), intention: null, problem: 'unclosed intention block' };
  }

  const raw = text.slice(first + OPEN.length, close);
  const reply = stripAll(text.slice(0, first) + text.slice(close + CLOSE.length));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reply, intention: null, problem: 'intention block was not JSON' };
  }

  const result = IntentionData.safeParse(parsed);
  if (!result.success) {
    // The message and not the data: this goes to a log line, and the data is
    // the athlete's own words about what stops them.
    return { reply, intention: null, problem: 'intention block failed validation' };
  }

  return { reply, intention: result.data, problem: null };
}
