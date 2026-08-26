import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const nav = read('../../web/src/components/SiteNav.jsx');
const logo = read('../../web/src/components/Logo.jsx');
const sticky = read('../../web/src/components/StickyHeader.jsx');
const chat = read('../../web/src/pages/Chat.jsx');
const library = read('../../web/src/pages/Library.jsx');
const progress = read('../../web/src/pages/Progress.jsx');
const css = read('../../web/src/styles.css');
const en = read('../../web/src/i18n/locales/en.js');

describe('one navigation, used everywhere', () => {
  test('every signed-in page renders the shared nav', () => {
    // Before this, only the coach page had navigation at all and the others
    // carried an ad-hoc "back to coach" link, so moving between logging,
    // progress and the library meant going via the conversation.
    for (const [name, page] of [['Chat', chat], ['Library', library], ['Progress', progress]]) {
      assert.match(page, /<SiteNav/, `${name} does not use the shared navigation`);
    }
  });

  test('no page keeps its own hand-rolled back link', () => {
    for (const [name, page] of [['Library', library], ['Progress', progress]]) {
      assert.doesNotMatch(page, /backToCoach/, `${name} still has a bespoke back link`);
    }
  });

  test('destinations are ordered by the training loop, not by when they were added', () => {
    // Talk to the coach, log what you lifted, see what it did, look it up.
    const order = [...nav.matchAll(/to: '\/([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(order.slice(0, 4), ['coach', 'log', 'progress', 'library']);
  });

  test('the rarely-used pages are present but quieter', () => {
    assert.match(nav, /to: '\/intake', key: 'nav\.profile', quiet: true/);
    assert.match(nav, /to: '\/account', key: 'nav\.data', quiet: true/);
  });

  test('the current page is marked for screen readers, not only in colour', () => {
    assert.match(nav, /aria-current=/);
  });

  test('the accent marks the current page and nothing else', () => {
    // One accent doing one job is the whole of the minimal look. If the accent
    // also painted hovers and borders it would stop meaning "you are here".
    const activeRule = css.slice(css.indexOf('.nav-item.active::after'), css.indexOf('.nav-item.active::after') + 300);
    assert.match(activeRule, /background: var\(--accent\)/);
    const hoverRule = css.slice(css.indexOf('.nav-item:hover'), css.indexOf('.nav-item:hover') + 120);
    assert.doesNotMatch(hoverRule, /--accent/);
  });

  test('focus is never removed, only restyled', () => {
    assert.match(css, /\.nav-item:focus-visible \{[^}]*outline:/);
  });
});

describe('the jump control is nowhere near a thumb', () => {
  test('the coach page uses the in-header control, not the floating one', () => {
    // A floating button at the bottom right of the conversation would sit on
    // the send button, which is both the most-used control on the page and
    // where a thumb already rests between sets.
    assert.match(chat, /<JumpToTop/);
    assert.doesNotMatch(chat, /<BackToTop/);
  });

  test('the long scrolling pages keep the floating one, where nothing collides', () => {
    for (const page of [library, progress]) {
      assert.match(page, /<BackToTop/);
    }
  });

  test('both honour reduced motion rather than always animating', () => {
    const occurrences = [...sticky.matchAll(/prefers-reduced-motion/g)];
    assert.ok(occurrences.length >= 2, 'each scroll control must check reduced motion');
  });
});

describe('the mark', () => {
  test('depends on no font being installed', () => {
    // The first draft set the name in Impact. Impact was not present on the
    // machine that rendered it, the browser substituted silently, and the
    // result looked nothing like the design.
    assert.doesNotMatch(logo, /font-family|fontFamily/);
  });

  test('is drawn in theme variables, so it re-themes with everything else', () => {
    for (const variable of ['--surface', '--secondary', '--accent', '--text']) {
      assert.ok(logo.includes(variable), `the mark does not use ${variable}`);
    }
    assert.doesNotMatch(logo, /#[0-9a-fA-F]{6}/, 'no colour should be hardcoded in the mark');
  });

  test('has a simplified variant for small sizes', () => {
    // Below about 32px the inner sleeves merge into a blob - checked by
    // rendering at 48, 32, 24 and 16 rather than assumed.
    assert.match(logo, /FULL_MARK_MINIMUM/);
    assert.match(logo, /compact/);
  });

  test('carries an accessible name rather than being decorative', () => {
    assert.match(logo, /role="img"/);
    assert.match(logo, /aria-label/);
  });
});

describe('the navigation is usable on a phone', () => {
  test('the destinations get their own row on a narrow screen', () => {
    // Squeezing both groups onto one line leaves targets too small to hit
    // standing up in a gym, which is where this app is actually used.
    const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
    assert.match(mobile, /\.nav-places \{[^}]*flex-basis: 100%/s);
  });

  test('the destinations scroll sideways rather than wrapping to three lines', () => {
    assert.match(css, /\.nav-places \{[^}]*overflow-x: auto/s);
    assert.match(css, /\.nav-places \{[^}]*min-width: 0/s);
  });

  test('the product is still identified when the name is hidden', () => {
    // The wordmark text drops below 560px; the badge has to carry identity
    // alone, which is what the compact variant is for.
    const narrow = css.slice(css.indexOf('@media (max-width: 560px)'));
    assert.match(narrow, /\.wordmark-text \{ display: none/);
  });

  test('every nav label is translated', () => {
    const keys = [...nav.matchAll(/key: 'nav\.([a-z]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length >= 6);
    for (const key of keys) {
      assert.match(en, new RegExp(`\\n    ${key}:`), `nav.${key} is missing from the English catalogue`);
    }
  });
});
