import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readRaw, stripComments } from './helpers/source.js';

const css = readRaw(new URL('../../web/src/styles.css', import.meta.url));

/*
 * The rules, without the prose about them.
 *
 * CSS comments are the same slash-star pairs stripComments already removes,
 * and the first version of this file did not bother: so the absence check on
 * `.h3 { font-size: 1.05rem }` was satisfied by the COMMENT quoting the old
 * rule, twelve hundred lines below the rule itself. That is the readSource
 * lesson arriving in a file type readSource does not cover, for the third
 * time. Structural assertions read this; assertions about the prose read `css`.
 */
const rules = stripComments(css);

/*
 * The stylesheet already stated the rule, at length, 700 lines above the place
 * that broke it:
 *
 *   "NOT CENTERED: anything longer than about two lines. Body copy, the policy
 *    pages, coaching replies, field hints... Centered paragraphs give every
 *    line a different starting x."
 *
 * Both changes here are that rule reaching the two places quietly exempt.
 */
describe('a form is entry, not display', () => {
  test('the centering layout does not center the form inside it', () => {
    /*
     * `.centered` is the viewport-centering grid for the sign-in card, declared
     * 900 lines earlier. Giving it text-align as well handed one class two
     * jobs, and text-align inherits - so "Email" and "Password" sat centered
     * over full-width inputs on the first screen anybody sees, each label's
     * first character somewhere in the middle of the box it names.
     */
    assert.match(rules, /\.centered form,\s*\n\.centered \.fineprint \{ text-align: start; \}/);
  });

  test('and the card itself is still centered, because that part was right', () => {
    // The fix is not "stop centering". A short title and subtitle centered in a
    // card is what makes it look composed; the policy says so and is not being
    // overturned here.
    assert.match(rules, /\.centered \{ text-align: center; \}/);
    assert.match(rules, /\.centered \{\s*\n\s*min-height: 100dvh;/, 'the layout half of .centered is gone');
  });
});

describe('the home page follows its own policy', () => {
  test('prose reads from a fixed left margin', () => {
    /*
     * Three blocks broke it and one badly: "Why not just ask a general AI?" is
     * six lines carrying the most specific claim on the page - seven experts,
     * three versions, one error in all of them - and every line started at a
     * different x.
     */
    const start = rules.indexOf('.home-section > p,');
    assert.ok(start > 0, 'the prose alignment rule is gone');
    const rule = rules.slice(start, rules.indexOf('}', start) + 1);
    for (const selector of ['.home-section > p', '.home-honest > li', '.home-steps > li p']) {
      assert.ok(rule.includes(selector), `${selector} is still centered`);
    }
    assert.match(rule, /text-align: start/);
  });

  test('the display type is left alone', () => {
    // Headline, subhead, section titles and step numbers stay centered. They
    // are short, and they are what stops the page looking pinned to the left
    // edge - the distinction the policy draws.
    assert.match(rules, /\.home \{[\s\S]{0,400}text-align: center;/);
  });
});

describe('the type scale has a rung between a page title and a paragraph', () => {
  const tokens = rules.slice(rules.indexOf('--text-large-title:'), rules.indexOf('--text-caption:') + 40);

  test('title-3 exists and sits between title and body', () => {
    // There was nothing between 32px and 17px, so every sub-heading was either
    // a page title or the size of the paragraph under it.
    assert.match(tokens, /--text-title-3: 1\.25rem/);
    const order = ['--text-large-title', '--text-title', '--text-title-3', '--text-headline', '--text-body', '--text-caption'];
    let previous = -1;
    for (const name of order) {
      const at = tokens.indexOf(name);
      assert.ok(at > previous, `${name} is out of order in the scale`);
      previous = at;
    }
  });

  test('the roughly sixty section headings use it instead of a hardcoded size', () => {
    /*
     * `.h3` was `font-size: 1.05rem` - 16.8px, off this scale entirely, and a
     * fifth of a pixel SMALLER than the body text it introduces. It is used on
     * the policy pages, the FAQ and the account screen.
     */
    assert.match(rules, /\.h3 \{ font-size: var\(--text-title-3\)/);
    assert.doesNotMatch(rules, /\.h3 \{ font-size: 1\.05rem/);
  });

  test('and so does a step title on the home page', () => {
    const start = rules.indexOf('.home-h3 {');
    assert.ok(start > 0, '.home-h3 is gone');
    const rule = rules.slice(start, rules.indexOf('}', start));
    assert.match(rule, /font-size: var\(--text-title-3\)/);
    assert.doesNotMatch(rule, /--text-headline/, 'a step title is body-sized again');
  });

  test('headline and body being equal is deliberate, and says so', () => {
    /*
     * That is the HIG's own definition - headline is 17pt SEMIBOLD,
     * distinguished by weight rather than size - and it is right for a label
     * above a control. It was never the problem, and the note stops the next
     * reader "fixing" it. Read from the raw file, because it IS a comment.
     */
    assert.match(tokens, /--text-headline: 1\.0625rem/);
    assert.match(tokens, /--text-body: 1\.0625rem/);
    assert.match(css, /headline and body are deliberately the same number/);
  });
});
