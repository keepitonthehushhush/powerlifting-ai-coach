import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeCodeBoxes, codeIsComplete, CODE_LENGTH } from '../../web/src/lib/codeBoxes.js';
import { cleanTotpCode } from '../../web/src/lib/mfa.js';
import { readSource } from './helpers/source.js';

/**
 * Six boxes, one input.
 *
 * The visible part of this is decoration. The part worth testing is that the
 * decoration never becomes the thing itself: six real inputs would break iOS
 * autofill, paste, backspace across a boundary, and a screen reader - all of
 * which work for free while there is exactly one field.
 */

describe('which box the next digit lands in', () => {
  const states = (value, focused) =>
    describeCodeBoxes(value, { focused }).map((b) => b.state).join(' ');

  test('an empty focused field points at the first box', () => {
    assert.equal(states('', true), 'active empty empty empty empty empty');
  });

  test('an empty UNfocused field points at nothing', () => {
    // A caret on a field that is not focused is a lie about where typing
    // would go, and it is the detail that makes a fake caret look fake.
    assert.equal(states('', false), 'empty empty empty empty empty empty');
  });

  test('it advances as digits arrive', () => {
    assert.equal(states('1', true), 'filled active empty empty empty empty');
    assert.equal(states('12345', true), 'filled filled filled filled filled active');
  });

  test('a COMPLETE code has no active box, even with focus', () => {
    // There is no next box. A caret sitting past the end would point at
    // something that cannot be typed into.
    assert.equal(states('123456', true), 'filled '.repeat(5).trim() + ' filled');
    assert.ok(!describeCodeBoxes('123456', { focused: true }).some((b) => b.state === 'active'));
  });

  test('the digits land in the right boxes', () => {
    assert.deepEqual(
      describeCodeBoxes('9184', { focused: true }).map((b) => b.char),
      ['9', '1', '8', '4', '', '']
    );
  });

  test('it is always exactly six boxes, whatever it is handed', () => {
    // A value longer than the field, or nonsense, must not change the shape
    // of the row - a seventh box appearing would be a visible bug.
    for (const value of ['1234567890', '', null, undefined, 42, {}]) {
      assert.equal(describeCodeBoxes(value).length, CODE_LENGTH, `${String(value)} changed the row`);
    }
  });

  test('a pasted code with spaces fills the boxes, because the input cleans first', () => {
    // Authenticator apps display "123 456". Paste is one gesture into one
    // field, which is the whole argument for one input.
    assert.deepEqual(
      describeCodeBoxes(cleanTotpCode('123 456'), { focused: true }).map((b) => b.char),
      ['1', '2', '3', '4', '5', '6']
    );
  });
});

describe('when the field submits itself', () => {
  test('only on six digits', () => {
    assert.equal(codeIsComplete('123456'), true);
    for (const partial of ['12345', '1234567', '', '12a456', null, undefined]) {
      assert.equal(codeIsComplete(partial), false, `${String(partial)} was treated as complete`);
    }
  });

  test('the same rejected code is not resubmitted on its own', () => {
    // Auto-submit without this turns one wrong code into a loop: the server
    // rejects it, the value is restored, and it fires again.
    const source = readSource(new URL('../../web/src/components/CodeInput.jsx', import.meta.url));
    assert.match(source, /submitted\.current === next/, 'nothing remembers what was submitted');
    assert.match(source, /submitted\.current = null/, 'the guard is never re-armed');
  });
});

describe('the illusion never becomes six real inputs', () => {
  const component = readSource(new URL('../../web/src/components/CodeInput.jsx', import.meta.url));

  test('there is exactly one input element', () => {
    /*
     * The property this whole component exists to keep. iOS fills
     * autocomplete="one-time-code" into ONE field; split across six, the code
     * lands in the first box or nowhere.
     */
    const inputs = component.match(/<input\b/g) ?? [];
    assert.equal(inputs.length, 1, `${inputs.length} inputs - autofill and paste are broken`);
  });

  test('the boxes are hidden from assistive technology', () => {
    // They are a picture of the input. Announced, they would be six more
    // things to answer.
    assert.match(component, /aria-hidden="true"/);
  });

  test('it keeps the attributes that make autofill and the keypad work', () => {
    assert.match(component, /autoComplete="one-time-code"/);
    assert.match(component, /inputMode="numeric"/);
    // type=text, not number: 000004 and 4 are different codes and a number
    // input drops the leading zeros.
    assert.match(component, /type="text"/);
    assert.doesNotMatch(component, /type="number"/);
  });

  test('the field is transparent rather than invisible', () => {
    /*
     * `opacity: 0` reads as hidden to some password managers, which then skip
     * it for autofill - removing the one feature the single input is for.
     */
    const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
    const rule = css.slice(css.indexOf('.code-input-field {'), css.indexOf('.code-input-field:focus'));
    assert.match(rule, /color: transparent/);
    assert.doesNotMatch(rule, /opacity: 0/);
  });

  test('what can be tapped is exactly what can be seen', () => {
    /*
     * Measured in a harness at 320, 375 and 430px before this was written.
     * With the width cap on `.code-boxes`, the row stopped at 336px on a
     * 430px screen while the input - which is `inset: 0` on `.code-input` -
     * stayed 390px, leaving 54px of invisible, tappable field past the last
     * box. Nothing looked wrong in the screenshot; only the numbers showed it.
     *
     * The cap belongs on the wrapper, where it caps both.
     */
    const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
    const wrapper = css.slice(css.indexOf('.code-input {'), css.indexOf('.code-input-field {'));
    const row = css.slice(css.indexOf('.code-boxes {'), css.indexOf('.code-box {'));
    assert.match(wrapper, /max-width:/, 'the wrapper is uncapped, so the row can outgrow the screen');
    assert.doesNotMatch(row, /max-width:/, 'capping the row leaves tappable field past the last box');
  });

  test('the boxes are the same size on every phone', () => {
    /*
     * `aspect-ratio: 3/4` tied height to width, so the same six digits were
     * 54px tall on a 320px phone and 77px on a 430px one. A fixed height is
     * what makes it look like the same control everywhere; the WIDTH is what
     * flexes, and it can go under 44px because the box is not the tap target.
     */
    const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
    const box = css.slice(css.indexOf('.code-box {'), css.indexOf(".code-box[data-state='filled']"));
    assert.match(box, /height: [\d.]+rem/, 'the box height is not fixed');
    assert.doesNotMatch(box, /aspect-ratio/, 'the height follows the width again');
  });

  test('both places that ask for a code use it', () => {
    // A second, hand-rolled code field is how two of these drift apart.
    for (const name of ['MfaChallenge', 'MfaSettings']) {
      const screen = readSource(new URL(`../../web/src/components/${name}.jsx`, import.meta.url));
      assert.match(screen, /<CodeInput/, `${name} still has its own field`);
      assert.doesNotMatch(screen, /autoComplete="one-time-code"/, `${name} kept a raw input`);
    }
  });
});
