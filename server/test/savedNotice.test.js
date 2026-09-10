import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readRaw } from './helpers/source.js';

const notice = readSource(new URL('../../web/src/components/SavedNotice.jsx', import.meta.url));
const chat = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const css = readSource(new URL('../../web/src/styles.css', import.meta.url));

/*
 * The coach writes three things on the athlete's behalf - a program, a
 * bodyweight, a logged session - and each one used to appear as a line of
 * text in the same ink as everything else, in a transcript that was already
 * moving because a reply had just landed. A record changing hands looked
 * exactly like the coach saying another sentence.
 */
describe('a write the coach made is visibly different from a thing it said', () => {
  test('all three confirmations go through one component', () => {
    // Three treatments that drift apart is how "the program one animates and
    // the weight one does not" becomes a bug report.
    const uses = chat.match(/<SavedNotice/g) ?? [];
    assert.equal(uses.length, 3, `expected three confirmations, found ${uses.length}`);
    // And none of them is left rendering the old bare card.
    const bare = chat.match(/className="program-saved"[^>]*role="status"/g) ?? [];
    assert.equal(bare.length, 0, 'a confirmation still renders the un-animated card');
  });

  test('each one re-mounts when its content changes', () => {
    /*
     * A CSS animation runs on mount. Without a key React reuses the element,
     * the animation does not restart, and the SECOND workout somebody logs is
     * confirmed by a card that silently swaps its own text - which is exactly
     * the "did that go through?" this exists to answer.
     */
    for (const [label, pattern] of [
      ['logged session', /<SavedNotice key=\{loggedSession\./],
      ['bodyweight', /key=\{`\$\{savedProfile\.bodyweight\}-\$\{savedProfile\.units\}`\}/],
      ['program', /key=\{`\$\{savedProgram\.week\}-\$\{savedProgram\.days\}`\}/],
    ]) {
      assert.match(chat, pattern, `the ${label} confirmation is not keyed, so it animates once and never again`);
    }
  });
});

describe('the motion itself', () => {
  test('the card rises and the check draws', () => {
    assert.match(css, /animation: saved-notice-in 260ms/);
    assert.match(css, /@keyframes saved-notice-in/);
    assert.match(css, /animation: saved-check-draw 340ms/);
    assert.match(css, /@keyframes saved-check-draw/);
  });

  test('the stroke animation is not a magic number', () => {
    /*
     * pathLength="1" normalizes the geometry, so dasharray is 1 whatever the
     * path measures. A measured constant silently stops matching the first
     * time somebody nudges the shape, and the check then draws to the wrong
     * length or not at all.
     */
    assert.match(notice, /pathLength="1"/);
    assert.match(css, /stroke-dasharray: 1;/);
    assert.match(css, /stroke-dashoffset: 1;/);
  });
});

describe('somebody who asked for less motion still gets the message', () => {
  test('the movement is removed and the mark is not', () => {
    /*
     * The usual way this media query is implemented wrong is to hide the
     * animated thing. That hands the people who asked for less motion a card
     * with a hole in it. The rule turns off the movement and leaves the check
     * fully drawn.
     */
    const reduced = css.slice(css.indexOf('.saved-notice { animation: none; }'));
    assert.ok(reduced, 'no reduced-motion branch for the confirmation card');
    const block = reduced.slice(0, reduced.indexOf('}\n\n') + 1);
    assert.match(block, /\.saved-check path \{[^}]*animation: none/);
    assert.match(block, /stroke-dashoffset: 0/, 'the check is left undrawn under reduced motion');
    assert.doesNotMatch(block, /display: none|visibility: hidden|opacity: 0/);
  });
});

describe('what a screen reader gets', () => {
  test('the card is announced and the decoration is not', () => {
    assert.match(notice, /role="status"/);
    assert.match(notice, /aria-hidden="true"/);
    // focusable="false" as well: IE-era SVGs land in the tab order without it,
    // and a decorative mark that can be tabbed to is a stop on the way to
    // nothing.
    assert.match(notice, /focusable="false"/);
  });

  test('the check is not the only thing carrying the meaning', () => {
    // The sentence says what happened. If the mark never rendered at all, the
    // card would still be correct - which is the test of whether an icon is
    // decoration or load-bearing.
    const raw = readRaw(new URL('../../web/src/components/SavedNotice.jsx', import.meta.url));
    assert.match(raw, /\{children\}/);
    assert.doesNotMatch(notice, /aria-label=/, 'the mark is carrying meaning it should not');
  });
});
