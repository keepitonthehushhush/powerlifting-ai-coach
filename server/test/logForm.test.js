import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, stripComments } from './helpers/source.js';

const form = readSource(new URL('../../web/src/pages/LogSession.jsx', import.meta.url));
const route = readSource(new URL('../src/routes/sessions.js', import.meta.url));
const css = stripComments(readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8'));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
const fixtures = readSource(new URL('../../web/harness/fixtures.js', import.meta.url));

/** Flat rules, brace-matched. A regex finds the wrong one. */
function rules(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selectors = text.slice(i, open);
    let depth = 0;
    let end = -1;
    for (let k = open; k < text.length; k += 1) {
      if (text[k] === '{') depth += 1;
      else if (text[k] === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
    }
    if (end === -1) break;
    if (!/@/.test(selectors)) {
      out.push({ selectors: selectors.split(',').map((x) => x.trim()).filter(Boolean), body: text.slice(open + 1, end) });
    }
    i = end + 1;
  }
  return out;
}
const RULES = rules(css);
const rulesFor = (sel) => RULES.filter((r) => r.selectors.includes(sel));

/**
 * The form somebody fills in standing up, between sets, one-handed.
 *
 * Everything here was measured on the rendered page at 320, 360, 390 and
 * 1280px with touch emulation on, not reasoned about from the source.
 */
describe('the log form is a thing you can use in a gym', () => {
  test('a text-styled BUTTON clears the AA target floor, and an inline link is left alone', () => {
    /*
     * ── THE DEFECT ────────────────────────────────────────────────────────
     *
     * `.link` sets `padding: 0`, so every `<button class="link">` in the
     * application rendered 23px tall. WCAG 2.5.8 asks for 24x24 CSS pixels at
     * AA. Measured on this form, where "Remove" was 61x23 and "Add movement"
     * was 309x23 - the two controls somebody reaches for with a thumb.
     *
     * Scoped to `button`, and that is the interesting half. SC 2.5.8 has an
     * explicit INLINE exception for targets inside a sentence or a block of
     * text, which is exactly what the anchors in the policy pages are. Giving
     * those a minimum height would space out running prose to fix something
     * that was never a failure, so the rule must NOT be on bare `.link`.
     */
    const floor = rulesFor('button.link');
    assert.equal(floor.length, 1, 'nothing gives a text-styled button a minimum target');
    assert.match(floor[0].body, /min-height:\s*24px/, 'the floor is not the 24px SC 2.5.8 asks for');

    for (const bare of rulesFor('.link')) {
      assert.doesNotMatch(
        bare.body,
        /min-height/,
        'bare `.link` sets a minimum height, which applies to anchors inside sentences - ' +
          'those are exempt under the inline exception and should not be spaced out',
      );
    }
  });

  test('the two controls on this form are real controls, not footnotes', () => {
    // 23px underlined text links, one of them the second most pressed thing on
    // the screen (almost nobody logs a session with one movement in it).
    assert.match(form, /className="secondary add-row"/, 'adding a movement is not a button');
    assert.match(form, /className="row-remove"/, 'removing a movement is not a button');
    assert.doesNotMatch(
      form,
      /className="link" onClick=\{(addRow|\(\) => removeRow)/,
      'a control on this form is back to being a text link',
    );
    for (const sel of ['.add-row', '.row-remove']) {
      const rule = rulesFor(sel);
      assert.equal(rule.length, 1, `${sel} has no rule`);
      assert.match(rule[0].body, /min-height:\s*44px/, `${sel} is not a thumb-sized target`);
    }
  });

  test('Remove is drawn in the ink, not in the label that sits on the ink', () => {
    /*
     * ── THE DEFECT, WHICH WAS MINE AND SHIPPED PAST FOUR CHECKS ───────────
     *
     * The button was `color: var(--error-text)` under a comment of mine
     * claiming the token "carries the meaning at 4.5:1 without the fill". It
     * does not. --error-text is the LABEL THAT SITS ON the error fill, chosen
     * the same way --accent-text is, so against a card it is #ffffff on
     * #ffffff - 1.00:1 in all ten light themes, 1.09-1.13:1 in the dark ones.
     * The button was invisible on every screen. It built, linted, passed the
     * suite and rendered, and only a screenshot said so.
     *
     * --error is the ink. palette.test.js already asserts it clears 4.5:1
     * against a card in all twenty palettes; measured, the worst is 5.57:1.
     */
    const rule = rulesFor('.row-remove');
    assert.equal(rule.length, 1);
    assert.match(rule[0].body, /(?<![-a-z])color:\s*var\(--error\)/, 'Remove is not drawn in --error');
    assert.doesNotMatch(
      rule[0].body,
      /var\(--error-text\)/,
      '--error-text is the label ON the error fill; on a card it measures 1.00:1',
    );
  });

  test('the keypad matches the field, because two of these cannot take a decimal', () => {
    // sets and reps are `z.number().int()` in this same repository, so a
    // decimal point on their keypad offers an entry the API will reject.
    const numbers = form.slice(form.indexOf("['sets'"), form.indexOf("].map(([field"));
    assert.match(numbers, /'sets',[^\n]*'numeric'/, 'sets offers a decimal point');
    assert.match(numbers, /'reps',[^\n]*'numeric'/, 'reps offers a decimal point');
    // 2.5lb jumps and RPE 8.5 are real, so these two keep it.
    assert.match(numbers, /'weight',[^\n]*'decimal'/, 'weight lost its decimal point');
    assert.match(numbers, /'rpe',[^\n]*'decimal'/, 'RPE lost its decimal point');
  });

  test('the weight field says which unit, and says it to a screen reader too', () => {
    // It was labeled "Weight" and nothing else, in a product that supports
    // pounds and kilograms, on the one screen filled in at a rack.
    assert.match(form, /aria-label=\{unit \? t\('log\.weightWithUnits'/, 'the unit never reaches the accessible name');
    assert.match(form, /data-unit=\{unit/, 'the unit is never rendered');
    for (const [name, locale] of [['en', en], ['es', es]]) {
      assert.match(locale, /weightWithUnits:/, `${name} has no weightWithUnits`);
    }
    /*
     * WCAG 2.5.3 Label in Name: the accessible name must CONTAIN the visible
     * label, or voice control users cannot say what they can see. The visible
     * label is log.weight and the accessible name is log.weightWithUnits, so
     * the second has to start with the first.
     */
    const visible = en.match(/\n\s*weight: '([^']+)'/)[1];
    const spoken = en.match(/\n\s*weightWithUnits: '([^']+)'/)[1];
    assert.ok(
      spoken.includes(visible),
      `"${spoken}" does not contain the visible label "${visible}" (WCAG 2.5.3)`,
    );
  });

  test('five Remove buttons do not all answer to the same name', () => {
    // A list of five identically-named buttons is a list a screen-reader user
    // cannot navigate. The visible word stays short because its column is.
    assert.match(form, /aria-label=\{t\('log\.removeNumbered', \{ number: index \+ 1 \}\)\}/);
    for (const [name, locale] of [['en', en], ['es', es]]) {
      assert.match(locale, /removeNumbered: '[^']*\{number\}/, `${name}'s removeNumbered has no number in it`);
    }
  });

  test('RPE is explained, once, on the form that asks for it', () => {
    // The product's job is taking beginners to competent lifters. RPE is the
    // one piece of jargon on this screen and it was printed unexplained.
    assert.match(form, /t\('log\.rpeHint'\)/, 'nothing explains RPE');
    for (const [name, locale] of [['en', en], ['es', es]]) {
      assert.match(locale, /rpeHint: '[^']{40,}'/, `${name}'s RPE hint is missing or too short to explain anything`);
    }
  });
});

describe('the unit comes from the sessions route, not from the profile', () => {
  test('the route returns it, selected narrowly', () => {
    assert.match(route, /select\('units'\)/, 'the sessions route does not read the unit');
    assert.match(route, /units: profile\.data\?\.units \?\? 'lb'/, 'the route does not return a unit');
  });

  test('and the form does not reach for the profile to get one string', () => {
    /*
     * ── WHY THIS IS A TEST AND NOT A COMMENT ──────────────────────────────
     *
     * Two reasons, and both are the kind that come back.
     *
     * GET /api/profile returns the whole profile row, injuries and
     * restrictions included, to a screen with no use for any of it - and this
     * repository's rule is that health data does not travel anywhere it is not
     * needed.
     *
     * It also STAMPS `profile_first_read_at`. Opening the log form would
     * record that the athlete had looked at their profile, and quietly corrupt
     * the funnel that measures whether anybody ever does. That one is
     * invisible: nothing breaks, a number just stops being true.
     */
    assert.doesNotMatch(form, /getProfile\(/, 'the log form fetches the whole profile, health fields and all');
    assert.match(form, /\.then\(\(\{ sessions, units: theirs \}\)/, 'the form ignores the unit the route sends');
  });

  test('the harness fixture has the route shape, not the shape the page wants', () => {
    // The harness's first rule, and the bug that wrote it: a fixture that
    // guesses renders a page that cannot exist, and column widths get tuned
    // against a lie.
    assert.match(fixtures, /getSessions: \{ units: 'lb', sessions:/, 'the fixture does not carry a unit');
    assert.match(fixtures, /full \? RECENT_SESSIONS : \[\]/, 'the full harness still renders an empty log form');
  });
});
