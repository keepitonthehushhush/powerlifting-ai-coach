/**
 * The Coach Diaz mark.
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────────
 *
 * A slanted hexagonal badge - arcade cabinet marquee geometry - with a loaded
 * barbell across it and a magenta keyline offset inside a cyan outline. The
 * offset keyline is the deliberate misregistration of cheaply printed arcade
 * artwork, which is where the energy of the era actually comes from.
 *
 * It is drawn from scratch as geometry. Nothing here is traced from, or
 * derived from, any existing game, character or logotype: an art movement is
 * not ownable, a specific asset is, and this is the former. It also carries no
 * likeness of a real person.
 *
 * ── WHY IT IS PATHS AND NOT A FONT ────────────────────────────────────────
 *
 * The first draft set the name in Impact with a skew. Impact was not installed
 * in the machine that rendered it, the browser silently substituted a generic
 * sans, and the result looked nothing like the design. A logo that depends on a
 * font being present on the reader's device is not a logo, it is a suggestion.
 * The badge is geometry; the wordmark alongside it is deliberately ordinary
 * type, because that combination is what survives.
 *
 * ── WHY TWO VARIANTS ──────────────────────────────────────────────────────
 *
 * The full mark carries five barbell elements. Below about 32px the inner
 * sleeves merge into a single blob - checked by rendering it at 48, 32, 24 and
 * 16 rather than by assuming - so anything smaller gets `compact`: bar and two
 * sleeves, a heavier outline, and no inner keyline. A mark that turns to mud at
 * favicon size is a mark with one size.
 *
 * ── WHY IT USES CSS VARIABLES ─────────────────────────────────────────────
 *
 * Filling from --surface, --secondary, --accent and --text means the badge
 * re-themes with the rest of the application instead of being a dark-mode
 * asset punched onto a cream background in light mode.
 */

const FULL_MARK_MINIMUM = 32;

export function Logo({ size = 32, title = 'Coach Diaz' }) {
  const compact = size < FULL_MARK_MINIMUM;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={title}
      className="logo-mark"
    >
      <path
        d="M52 6 L148 6 L194 100 L148 194 L52 194 L6 100 Z"
        fill="var(--surface)"
        stroke="var(--secondary)"
        strokeWidth={compact ? 14 : 11}
        strokeLinejoin="round"
      />
      {!compact && (
        <path
          d="M56 20 L144 20 L178 100 L144 180 L56 180 L22 100 Z"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      )}
      <g stroke="var(--text)" strokeLinecap="round">
        {compact ? (
          <>
            <line x1="46" y1="100" x2="154" y2="100" strokeWidth="18" />
            <line x1="66" y1="60" x2="66" y2="140" strokeWidth="28" />
            <line x1="134" y1="60" x2="134" y2="140" strokeWidth="28" />
          </>
        ) : (
          <>
            <line x1="40" y1="100" x2="160" y2="100" strokeWidth="14" />
            <line x1="62" y1="66" x2="62" y2="134" strokeWidth="22" />
            <line x1="138" y1="66" x2="138" y2="134" strokeWidth="22" />
            <line x1="88" y1="80" x2="88" y2="120" strokeWidth="13" />
            <line x1="112" y1="80" x2="112" y2="120" strokeWidth="13" />
          </>
        )}
      </g>
    </svg>
  );
}

/** Mark plus name, for the navigation bar and anywhere the product signs itself. */
export function Wordmark({ size = 30, name }) {
  return (
    <span className="wordmark">
      <Logo size={size} title={name} />
      <span className="wordmark-text">{name}</span>
    </span>
  );
}
