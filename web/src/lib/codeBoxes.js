/**
 * Six boxes, drawn from one input's value.
 *
 * ── WHY THIS IS ONE INPUT WEARING SIX BOXES, NOT SIX INPUTS ───────────────
 *
 * Six real `<input>` elements is the obvious build and it is the worse one,
 * for reasons that only show up on the device the feature exists for:
 *
 *   - iOS offers the code from Messages and from a password manager through
 *     `autocomplete="one-time-code"`, and it fills ONE field. Split across
 *     six, the whole code lands in the first box or nowhere. Apple's own
 *     developer forums carry this as an open complaint about apps that split
 *     the field, and Cloud Four's write-up reaches the same conclusion: "All
 *     critical features of a one-time passcode input are possible using HTML
 *     alone."
 *   - Pasting is one gesture into one field. Six fields need code to
 *     redistribute it, and that code is where paste normally breaks.
 *   - Backspace across a boundary, arrow keys, select-all and undo are all
 *     free in one field and hand-written in six.
 *   - A screen reader announces six unlabeled boxes as six questions.
 *
 * So there is exactly one `<input>` - keeping autofill, paste, the keyboard
 * and the label - and the boxes are presentation drawn from its value. The
 * appearance is the fancy part; the input is deliberately ordinary.
 *
 * This module is the part with a decision in it, kept pure so the boundaries
 * can be exercised without a DOM: which box is next, what happens on the
 * sixth character, and what a value longer or shorter than the field should
 * look like.
 */

export const CODE_LENGTH = 6;

/**
 * @param {string} value - the input's current value, already cleaned.
 * @param {{length?: number, focused?: boolean}} [options]
 * @returns {Array<{index: number, char: string, state: 'filled'|'active'|'empty'}>}
 *   `active` is where the next character will land, and only ever when the
 *   field has focus - a caret drawn on an unfocused field is a lie about
 *   where typing would go.
 */
export function describeCodeBoxes(value, options = {}) {
  const length = Number.isInteger(options.length) && options.length > 0
    ? options.length
    : CODE_LENGTH;
  const focused = options.focused === true;
  const chars = [...String(value ?? '')].slice(0, length);

  return Array.from({ length }, (_, index) => {
    const char = chars[index] ?? '';
    if (char !== '') return { index, char, state: 'filled' };
    // The active box is the first empty one. When the code is complete there
    // is no next box, so nothing is active even with focus - a caret sitting
    // past the end would point at a box that cannot be typed into.
    const isNext = index === chars.length && chars.length < length;
    return { index, char: '', state: focused && isNext ? 'active' : 'empty' };
  });
}

/** Is the field full? The only condition worth auto-submitting on. */
export function codeIsComplete(value, length = CODE_LENGTH) {
  return new RegExp(`^\\d{${length}}$`).test(String(value ?? ''));
}
