import { useId, useRef, useState } from 'react';
import { describeCodeBoxes, CODE_LENGTH } from '../lib/codeBoxes.js';
import { cleanTotpCode } from '../lib/mfa.js';

/**
 * A six-digit code field that looks like six boxes and behaves like one input.
 *
 * See lib/codeBoxes.js for why it is one input rather than six. In short: iOS
 * fills `autocomplete="one-time-code"` into a single field, paste is one
 * gesture, and backspace, arrow keys, undo and screen readers are all free in
 * one field and hand-written in six.
 *
 * ── HOW THE ILLUSION IS BUILT ─────────────────────────────────────────────
 *
 * The real input covers the whole row and carries transparent text and a
 * transparent caret. The boxes underneath are divs that render the value one
 * character each, and they are `aria-hidden` because they are a picture of
 * the input, not six more things to announce.
 *
 * `color: transparent` rather than `opacity: 0` on purpose: an input at zero
 * opacity is treated as hidden by some password managers and is skipped for
 * autofill, which would remove the exact feature this component exists to
 * keep.
 *
 * ── AUTO-SUBMIT, WITH THE ONE GUARD IT NEEDS ──────────────────────────────
 *
 * Six digits is the whole field, so waiting for a button press is asking
 * somebody to confirm something they have already finished saying. It submits
 * itself - and remembers the value it submitted, so a code the server rejects
 * is not resubmitted the instant the same characters are typed back. The
 * button stays, because auto-submit that fails silently leaves nothing to
 * press.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  disabled = false,
  invalid = false,
  autoFocus = false,
  describedBy,
}) {
  const inputRef = useRef(null);
  const submitted = useRef(null);
  const [focused, setFocused] = useState(false);
  const id = useId();

  const boxes = describeCodeBoxes(value, { focused: focused && !disabled });

  function handleChange(event) {
    const next = cleanTotpCode(event.target.value);
    onChange(next);

    if (next.length !== CODE_LENGTH) {
      // Backing out of a complete code re-arms the auto-submit, so correcting
      // a typo and retyping the same digits works rather than silently doing
      // nothing.
      submitted.current = null;
      return;
    }
    if (submitted.current === next) return;
    submitted.current = next;
    onComplete?.(next);
  }

  return (
    <div className="field code-field">
      <label htmlFor={id}>{label}</label>

      <div
        className="code-input"
        data-invalid={invalid ? 'true' : undefined}
        // A click anywhere on the row belongs to the input, including the gaps
        // between boxes. Without this, the gaps are dead space on a phone.
        onMouseDown={(event) => {
          if (event.target !== inputRef.current) {
            event.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <input
          id={id}
          ref={inputRef}
          className="code-input-field"
          /*
           * type=text, not number: 000004 and 4 are different codes, and a
           * number input would happily lose the leading zeros. inputMode gives
           * the numeric keypad without that.
           */
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={CODE_LENGTH}
          value={value}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          // Six digits is the whole answer, so the field says so rather than
          // relying on the boxes - which a screen reader cannot see.
          aria-label={`${label} (${CODE_LENGTH} digits)`}
        />

        <div className="code-boxes" aria-hidden="true">
          {boxes.map((box) => (
            <div key={box.index} className="code-box" data-state={box.state}>
              {box.char}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
