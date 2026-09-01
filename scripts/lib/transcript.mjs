/**
 * The shape of the transcript a scenario sends.
 *
 * Extracted into its own module for the same reason the grading primitives
 * were: if this is wrong, every scenario is graded against a conversation
 * that is not the one it meant to have, and the failure looks like a finding
 * about the coach rather than a bug in the harness. That is the defect class
 * this project keeps meeting - a check that answers confidently without
 * looking - so the thing that assembles what gets looked AT is tested.
 */

/*
 * ── WHAT A TURN IS ─────────────────────────────────────────────────────
 *
 * A turn is a string (a message from the athlete) or { role, content }.
 *
 * Every scenario used to be a pile of consecutive user messages, which cannot
 * express the case that matters most for a triage question: not whether the
 * coach asks it, but what the coach does with the ANSWER. Grading that needs
 * the coach's question sitting in the transcript, and a scripted assistant
 * turn is the honest way to put it there - it fixes the question so the
 * scenario grades the response to the answer, instead of grading it through
 * whatever phrasing the model happened to produce on the turn before.
 *
 * Words we wrote are not evidence about the model, so a scripted assistant
 * turn is a PREMISE, never a finding. Two rules keep it that way: the
 * transcript may not end on one (that is a prefill - the model would be
 * continuing our sentence and we would be grading our own text), and it may
 * not open on one (the coach does not speak first).
 */
export function normalizeTurns(turns) {
  if (!Array.isArray(turns) || turns.length === 0) throw new Error('has no turns to send');

  const messages = turns.map((turn, i) => {
    if (typeof turn === 'string') {
      if (turn.trim().length === 0) throw new Error(`turn ${i + 1} is empty`);
      return { role: 'user', content: turn };
    }
    if (turn === null || typeof turn !== 'object') {
      throw new Error(`turn ${i + 1} is neither a string nor { role, content }`);
    }
    if (turn.role !== 'user' && turn.role !== 'assistant') {
      throw new Error(`turn ${i + 1} has role ${JSON.stringify(turn.role)}, not "user" or "assistant"`);
    }
    if (typeof turn.content !== 'string' || turn.content.trim().length === 0) {
      throw new Error(`turn ${i + 1} has no content`);
    }
    return { role: turn.role, content: turn.content };
  });

  if (messages[0].role !== 'user') {
    throw new Error('opens on a scripted assistant turn, and the coach does not speak first');
  }
  if (messages[messages.length - 1].role !== 'user') {
    throw new Error('ends on a scripted assistant turn, so the reply would continue our own words');
  }
  return messages;
}
