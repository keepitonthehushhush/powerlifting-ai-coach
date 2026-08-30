import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * THREE UI DEFECTS, AND THE ASSERTIONS THAT KEEP THEM FIXED.
 *
 * All three were reported by the person using the product, which is the part
 * worth noticing: none of them broke a test, threw an error, or showed up in a
 * log. A layout can be completely wrong and perfectly valid.
 *
 *   1. Pressing Save on an incomplete profile appeared to do nothing. Native
 *      constraint validation canceled the submit and pointed at the first
 *      invalid field, somewhere far up the form.
 *   2. The chat composer put a 24px text box beside a send button wider than
 *      the phone, because the button matched a rule written for a different
 *      kind of button.
 *   3. The checkboxes were the browser's, in the browser's color, with the
 *      browser's timing.
 */

const intakeCode = readSource(new URL('../../web/src/pages/Intake.jsx', import.meta.url));
const chat = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const summary = readRaw(new URL('../../web/src/components/ErrorSummary.jsx', import.meta.url));
/**
 * The same file with comments stripped, for the one assertion that COUNTS
 * something. The docblock explains why `block: 'center'` was chosen, so it
 * contains the string it is counting - the fifth time in this suite that an
 * assertion has collided with the comment explaining it. See helpers/source.js.
 */
const summaryCode = readSource(new URL('../../web/src/components/ErrorSummary.jsx', import.meta.url));
const css = readSource(new URL('../../web/src/styles.css', import.meta.url));
const en = readRaw(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readRaw(new URL('../../web/src/i18n/locales/es.js', import.meta.url));

/** The names listed in REQUIRED_FIELDS. */
function declaredRequired() {
  const block = intakeCode.slice(
    intakeCode.indexOf('const REQUIRED_FIELDS'),
    intakeCode.indexOf('];', intakeCode.indexOf('const REQUIRED_FIELDS'))
  );
  return [...block.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]);
}

/** The names actually wired to a control through the required() helper. */
function enforcedRequired() {
  return [...intakeCode.matchAll(/\{\.\.\.required\('([a-z_]+)'\)\}/g)].map((m) => m[1]);
}

describe('the form says what is missing', () => {
  test('the declared list and the enforced controls agree, in both directions', () => {
    // A field required in the JSX but absent from the list is enforced
    // silently - which is the entire bug. A field in the list that no control
    // enforces names something in the summary that nothing is checking.
    const declared = declaredRequired();
    const enforced = enforcedRequired();
    assert.ok(declared.length >= 5, `only parsed ${declared.length} declared fields`);
    assert.deepEqual([...declared].sort(), [...enforced].sort());
  });

  test('no control still carries a bare required attribute', () => {
    // One left behind would be enforced by the browser, silently, exactly as
    // before - and it would look fine, because the rest of the form works.
    assert.doesNotMatch(intakeCode, /^\s*required\s*$/m);
    assert.doesNotMatch(intakeCode, /\srequired>/);
    assert.doesNotMatch(intakeCode, /\srequired\s*\/>/);
  });

  test('every named field has a label in both languages', () => {
    const keys = [...intakeCode.matchAll(/labelKey: 'intake\.(\w+)'/g)].map((m) => m[1]);
    assert.equal(keys.length, declaredRequired().length);
    for (const key of keys) {
      assert.match(en, new RegExp(`\\b${key}:`), `en is missing intake.${key}`);
      assert.match(es, new RegExp(`\\b${key}:`), `es is missing intake.${key}`);
    }
    for (const catalogue of [en, es]) {
      assert.match(catalogue, /missingTitle:/);
      assert.match(catalogue, /missingHint:/);
    }
  });

  test('OUR SUMMARY IS THE ONLY VALIDATION THE PERSON MEETS', () => {
    // Two mechanisms racing means the native bubble draws over the summary and
    // neither can be read.
    assert.match(intakeCode, /<form onSubmit=\{handleSubmit\} className="stack" noValidate>/);
    assert.match(intakeCode, /control\.checkValidity\(\)/);
  });

  test('the summary renders above the submit button, not at the top of the form', () => {
    // The convention is top-of-form. The convention assumes the person is at
    // the top of the form, and they are provably not - they just pressed a
    // button below eighteen fields. Position IS the fix here.
    const summaryAt = intakeCode.indexOf('<ErrorSummary');
    const buttonAt = intakeCode.indexOf('<button type="submit"');
    const formAt = intakeCode.indexOf('<form onSubmit');
    assert.ok(summaryAt !== -1 && buttonAt !== -1);
    assert.ok(summaryAt < buttonAt, 'the summary must come before the button');
    assert.ok(summaryAt - formAt > 1000, 'the summary has drifted to the top of the form');
  });

  test('fixing a field clears it from the summary', () => {
    // Otherwise the list keeps naming something already dealt with, which
    // reads as the form being broken rather than as the list being stale.
    assert.match(intakeCode, /setMissing\(\(prev\) =>/);
    assert.match(intakeCode, /prev\.filter\(\(m\) => m\.name !== field\)/);
  });

  test('the summary takes focus and scrolls fields clear of the sticky header', () => {
    assert.match(summary, /role="alert"/);
    assert.match(summary, /tabIndex=\{-1\}/);
    assert.match(summary, /ref\.current\?\.focus\(\)/);
    // block: 'center' rather than an offset computed from the header height -
    // one of those is a number that goes stale when the header changes.
    const centres = [...summaryCode.matchAll(/block: 'center'/g)];
    assert.equal(centres.length, 2, 'both the summary and the field should centre');
    assert.doesNotMatch(summaryCode, /offsetHeight|scrollTop -/);
  });

  test('an invalid field says so itself, not only in the summary', () => {
    assert.match(intakeCode, /'aria-invalid': 'true'/);
    assert.match(css, /\[aria-invalid='true'\]/);
  });
});

describe('the chat composer', () => {
  test('THE SEND BUTTON IS NOT A DIRECT CHILD OF THE FORM', () => {
    // This is the whole bug. `.composer` is a <form>, so the send button
    // matched `form > button.primary { min-width: min(320px, 100%) }` - a rule
    // for the submit button at the bottom of a centered form. min-width is a
    // floor flex-shrink cannot get under, so the button took the entire row
    // and the textarea collapsed to 24px on a 390px screen.
    const form = chat.slice(chat.indexOf('<form className="composer"'));
    const rowAt = form.indexOf('<div className="composer-row">');
    // Whitespace-tolerant, because a line break between `<button` and its
    // attributes once made this search return -1. The comparison below then
    // failed for the right reason by luck rather than by design: the guard
    // could not find the button at all, which is not the same finding as the
    // button having moved, and the two must not be reported as one.
    const button = form.match(/<button\s[^>]*type="submit"/);
    const rowEndAt = form.indexOf('</div>');
    assert.ok(rowAt !== -1, 'the controls are no longer wrapped');
    assert.ok(button, 'the submit button could not be found - this check did not run');
    const buttonAt = button.index;
    assert.ok(rowAt < buttonAt && buttonAt < rowEndAt, 'the button escaped the row');
  });

  test('the character counter is not wedged between the box and the button', () => {
    // It was a third flex item, appearing at 80% of the limit and pushing the
    // two controls apart at exactly the moment somebody is mid-sentence.
    const form = chat.slice(chat.indexOf('<form className="composer"'));
    const rowEnd = form.indexOf('</div>');
    const counterAt = form.indexOf('counter');
    assert.ok(counterAt > rowEnd, 'the counter is still inside the control row');
  });

  test('the row sizes both controls deliberately', () => {
    // `flex: 1` alone leaves min-width at auto, which is the intrinsic
    // minimum - and intrinsic minimums are what let this collapse.
    assert.match(css, /\.composer-row textarea \{ flex: 1 1 0; min-width: 0; \}/);
    assert.match(css, phrase('.composer-row button.primary'));
    const rule = css.slice(css.indexOf('.composer-row button.primary'));
    assert.match(rule.slice(0, 200), /min-width: 0/);
  });

  test('the composer is a column now, so nothing can sit between them again', () => {
    const rule = css.slice(css.indexOf('.composer {'), css.indexOf('}', css.indexOf('.composer {')));
    assert.match(rule, /flex-direction: column/);
  });
});

describe('the checkbox', () => {
  test('it is drawn by us, not by the operating system', () => {
    assert.match(css, /input\[type='checkbox'\] \{[\s\S]{0,400}appearance: none/);
    assert.match(css, /-webkit-appearance: none/);
  });

  test('there is a tick, and it is animated rather than switched on', () => {
    assert.match(css, /input\[type='checkbox'\]::before/);
    assert.match(css, /input\[type='checkbox'\]:checked::before/);
    assert.match(css, /transform: rotate\(-45deg\) scale\(1\)/);
  });

  test('nothing that animates costs a reflow', () => {
    // transform, opacity and color are compositor work. Animating width,
    // height, margin or padding on a control somebody is clicking is how a
    // 90ms interaction turns into a janky one.
    const block = css.slice(
      css.indexOf("input[type='checkbox'] {"),
      css.indexOf('label.checkbox {')
    );
    for (const transition of block.matchAll(/transition:([^;]+);/g)) {
      assert.doesNotMatch(
        transition[1],
        /\b(width|height|margin|padding|top|left|font-size)\b/,
        `layout property in a checkbox transition: ${transition[1].trim()}`
      );
    }
  });

  test('it acknowledges the press before the state has changed', () => {
    // The cheapest possible answer to "it feels slow".
    assert.match(css, /input\[type='checkbox'\]:active \{ transform: scale\(0\.92\); \}/);
  });

  test('the target is a thumb, not a 13px box', () => {
    const rule = css.slice(css.indexOf('label.checkbox {'));
    assert.match(rule.slice(0, 200), /min-height: 44px/);
  });

  test('somebody who asked for less motion gets less motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf("input[type='checkbox']")));
    assert.match(reduced.slice(0, 400), /input\[type='checkbox'\]/);
    assert.match(reduced.slice(0, 400), /transition: none/);
  });
});
