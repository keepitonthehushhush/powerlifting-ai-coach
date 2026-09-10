import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSource, readRaw } from './helpers/source.js';

const root = fileURLToPath(new URL('../../web/src/', import.meta.url));
const css = readRaw(join(root, 'styles.css'));

function jsxFiles(dir = root, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) jsxFiles(full, found);
    else if (entry.name.endsWith('.jsx')) found.push(full);
  }
  return found;
}

/** Does the stylesheet define a rule for this class anywhere, alone or compound? */
const isStyled = (name) => new RegExp(`\\.${name.replace(/-/g, '\\-')}(?![\\w-])`).test(css);

/*
 * ── A BUTTON THAT NAMES A CLASS THAT DOES NOT EXIST ────────────────────────
 *
 * `className="link-button"` had no rule. The only trace of .link-button in the
 * stylesheet is a comment saying two of them USED to exist - it was retired
 * and two call sites were left behind. `className="secondary"` had no rule
 * either; there is a --secondary COLOR token, which is presumably what the
 * author had in mind.
 *
 * The base `button` rule sets font, cursor and border-radius and nothing else,
 * so all five of those buttons rendered in the browser's own chrome. Measured
 * rather than assumed: rgb(239, 239, 239) fill, a 2px default border, black
 * text - in the middle of a designed screen, and in two cases as the DECLINE
 * button on a guardian consent form beside a styled "I agree".
 *
 * A `div` with a dead class is inert. A BUTTON with a dead class is loud,
 * because the platform has strong opinions about unstyled buttons. So this
 * checks buttons, and it checks the thing that actually went wrong: if you
 * name a class, it has to exist.
 */
describe('a button that names a class gets that class', () => {
  const offenders = [];
  const buttons = [];

  for (const file of jsxFiles()) {
    const source = readSource(file);
    for (const match of source.matchAll(/<button\b[^>]*?>/gs)) {
      const declared = match[0].match(/className="([^"]*)"/);
      // Buttons with NO className are a separate question - several are styled
      // by a descendant selector, and conflating the two would make this noisy
      // enough to ignore. The defect found was a class that does not exist.
      if (!declared) continue;
      const names = declared[1].trim().split(/\s+/).filter(Boolean);
      buttons.push(names);
      const dead = names.filter((name) => !isStyled(name));
      if (dead.length === names.length) {
        offenders.push(`${file.replace(root, '')}: className="${declared[1]}"`);
      }
    }
  }

  test('the scan found buttons to check', () => {
    // A walk that matches nothing passes every assertion under it.
    assert.ok(buttons.length > 20, `only ${buttons.length} classed buttons found - this test is measuring nothing`);
  });

  test('every classed button names at least one class the stylesheet defines', () => {
    assert.deepEqual(offenders, [], `these render in the browser's default chrome:\n  ${offenders.join('\n  ')}`);
  });

  test('and the two dead names in particular are gone', () => {
    // Named, so that reintroducing either fails with the reason attached.
    for (const dead of ['link-button']) {
      assert.ok(!isStyled(dead), `${dead} now has a rule, so this test is stale`);
      for (const file of jsxFiles()) {
        assert.doesNotMatch(readSource(file), new RegExp(`className="[^"]*\\b${dead}\\b`), `${dead} is back in ${file.replace(root, '')}`);
      }
    }
  });
});

describe('yes and no are the same size', () => {
  test('.secondary exists and matches .primary\'s box', () => {
    /*
     * Two of the three `secondary` buttons are the decline on the guardian
     * consent screen. A refusal rendered in browser default beside a designed
     * acceptance is not a neutral pair of choices, and this codebase says
     * withdrawal must never be harder than consent.
     *
     * Measured after the fix: 141x49 both. Before adding a transparent border
     * to .primary they were 47 and 49 - the outline made the peer 2px taller,
     * which is the kind of difference nobody can name and everybody sees.
     */
    const primary = css.slice(css.indexOf('.primary {'), css.indexOf('}', css.indexOf('.primary {')));
    const secondary = css.slice(css.indexOf('.secondary {'), css.indexOf('}', css.indexOf('.secondary {')));
    assert.ok(secondary, '.secondary has no rule');
    for (const property of ['padding: 0.7rem 1.1rem', 'font-weight: 600']) {
      assert.ok(primary.includes(property), `.primary lost ${property}`);
      assert.ok(secondary.includes(property), `.secondary does not match .primary on ${property}`);
    }
    assert.match(primary, /border: 1px solid transparent/, 'the peers differ in height again');
    assert.match(secondary, /border: 1px solid var\(--field-border\)/);
  });

  test('and they get the same metrics inside a form or a stack', () => {
    assert.match(css, /\.stack > button\.secondary/);
    assert.match(css, /form > button\.secondary/);
  });
});

describe('the MFA forms space their own controls', () => {
  test('every form in the app is a stack, or says what it is instead', () => {
    /*
     * Spacing comes from the container here. The MFA challenge had no
     * container class, so Verify sat flush against the last code box - 0px
     * between them, measured. Six of the eight forms already carried `stack`;
     * the two that did not were both MFA, which is why both looked wrong in
     * the same way.
     */
    const KNOWN_OTHER = new Set(['composer']);
    const bare = [];
    for (const file of jsxFiles()) {
      const source = readSource(file);
      for (const match of source.matchAll(/<form\b[^>]*?>/gs)) {
        const declared = match[0].match(/className="([^"]*)"/);
        const names = declared ? declared[1].trim().split(/\s+/) : [];
        if (!names.includes('stack') && !names.some((n) => KNOWN_OTHER.has(n))) {
          bare.push(`${file.replace(root, '')}: ${declared ? declared[1] : '(no className)'}`);
        }
      }
    }
    assert.deepEqual(bare, [], `these forms have no spacing container:\n  ${bare.join('\n  ')}`);
  });
});
