import { useEffect, useRef } from 'react';

/**
 * "You cannot save yet, and here is exactly what is missing."
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The intake form relied on the browser's own constraint validation. Press
 * Save with an empty required field and the browser cancels the submit, scrolls
 * to the FIRST invalid control, and shows a bubble that disappears after a few
 * seconds. It never mentions the other four, and on a long form under a sticky
 * header it can point at something the header is covering. The reported
 * experience was the honest summary of all that: pressing Save appears to do
 * nothing, and the only way to find out why is to scroll and hunt.
 *
 * ── WHERE IT GOES, AND WHY THAT IS NOT THE CONVENTION ─────────────────────
 *
 * Error summaries conventionally sit at the TOP of a form. That convention
 * assumes the person is at the top of the form. Here they are provably not -
 * they just pressed a button at the bottom of eighteen fields. So this renders
 * where the button is. The eye does not have to travel and nothing has to be
 * hunted for.
 *
 * ── HOW IT BEHAVES ────────────────────────────────────────────────────────
 *
 * It takes focus when it appears, so a screen reader announces it and a
 * keyboard user is already inside it. Each entry is a real button that scrolls
 * its field to the MIDDLE of the viewport - `block: 'center'`, which sidesteps
 * the sticky header entirely rather than trying to compute an offset for it -
 * and then focuses it.
 *
 * @param {object}   props
 * @param {string}   props.title    heading, e.g. "5 things still to fill in"
 * @param {string}   props.hint     one line under it
 * @param {Array<{name: string, label: string}>} props.items
 */
export function ErrorSummary({ title, hint, items }) {
  const ref = useRef(null);

  useEffect(() => {
    if (items.length > 0) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [items]);

  if (items.length === 0) return null;

  function go(name) {
    const field = document.getElementById(name);
    if (!field) return;
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // After the scroll, not during: focusing first makes the browser do its own
    // jump and the smooth scroll fights it.
    window.setTimeout(() => field.focus({ preventScroll: true }), 260);
  }

  return (
    <div
      className="error-summary"
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="error-summary-title"
    >
      <h2 id="error-summary-title">{title}</h2>
      {hint && <p className="muted small">{hint}</p>}
      <ul>
        {items.map((item) => (
          <li key={item.name}>
            <button type="button" onClick={() => go(item.name)}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
