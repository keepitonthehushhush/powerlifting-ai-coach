import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROFILE } from '../../web/harness/fixtures.js';
import { startersFor, MAX_STARTERS } from '../src/lib/starters.js';
import { ProfileUpdate } from '../src/lib/profileSchema.js';
import { EMPTY } from '../../web/src/lib/profileForm.js';
import { readSource, stripComments } from './helpers/source.js';

const startersSource = readSource(new URL('../src/lib/starters.js', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
const css = stripComments(readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8'));

/**
 * ── A FIXTURE THAT INVENTS A FIELD NAME REVIEWS A SCREEN THAT CANNOT EXIST ─
 *
 * fixtures.js opens by saying so, in its own words, about two earlier
 * occurrences: "Shapes come from routes." The profile object was written
 * before that rule and never held to it, and five of its eleven keys were
 * names nothing in this repository reads - `experience`, `training_days`,
 * `injuries`, `restrictions`, `leaderboard_opt_in`. Two of its values were
 * outside the database's CHECK constraints as well.
 *
 * Nothing failed. `GET /api/profile` is `select('*')` and the only screen that
 * reads past `units` and `display_name` is the intake form, which reads with
 * `Object.entries` - so an unknown key is dropped in silence and a missing one
 * leaves its input blank. Measured on the rendered page: 3 of 32 fields
 * filled. Every sweep this project has run - the eighteen-screen check, the
 * scroll-cue sweep, the 1,278-capture style snapshot - reviewed the longest
 * form in the product as an empty one.
 *
 * These tests are the mechanical version of the rule that would have caught
 * it: grep the repository for every field name a fixture sets, because one
 * that appears once is being discarded.
 */
describe('the review harness is shaped like the routes it stands in for', () => {
  test('every key on the fixture profile is one the route schema knows', () => {
    /*
     * Checked against `ProfileUpdate` - the actual zod schema PUT /api/profile
     * parses with - rather than against a list written here. It is `.strict()`,
     * so an invented key comes back as `unrecognized_keys`, and it carries
     * every enum, so an invented VALUE fails in the same call. Two classes of
     * fixture bug, one production validator, nothing to keep in step.
     */
    const NOT_UPDATABLE = ['display_name', 'intake_completed_at'];
    const payload = Object.fromEntries(
      Object.entries(PROFILE).filter(([key]) => !NOT_UPDATABLE.includes(key)),
    );
    assert.ok(
      Object.keys(payload).length >= 20,
      `only ${Object.keys(payload).length} fields were submitted to the schema, which is too few to be true`,
    );

    const result = ProfileUpdate.safeParse(payload);
    assert.ok(
      result.success,
      result.success ? '' : `the harness profile is not a profile the API would accept:\n${
        result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`,
    );

    for (const key of NOT_UPDATABLE) {
      assert.ok(key in PROFILE, `${key} left the fixture, so the screens that read it render blank`);
    }
  });

  test('AND EVERY FIELD OF THE INTAKE FORM IS FILLED, which is the half that was wrong', () => {
    /*
     * The direction that matters for what the harness is FOR. A valid profile
     * carrying three fields passes the test above and still renders the intake
     * screen as a blank form - which is exactly the state it was reviewed in.
     *
     * EMPTY is the intake form's own field list, and profilePayload.test.js
     * already holds it against the route's schema, so it is the enumeration
     * with a chain of custody rather than a second list.
     */
    const fields = Object.keys(EMPTY);
    assert.ok(fields.length >= 20, `EMPTY has only ${fields.length} fields - has profileForm.js changed shape?`);

    const missing = fields.filter((field) => !(field in PROFILE));
    assert.deepEqual(
      missing,
      [],
      `the fixture profile answers ${fields.length - missing.length} of ${fields.length} intake questions, ` +
        `so those fields render blank in every review: ${missing.join(', ')}`,
    );
  });

  test('the conversation starters are ids the server can actually emit', () => {
    /*
     * ── THE BUG ───────────────────────────────────────────────────────────
     *
     * The fixture said `['program', 'formCheck', 'whatIsThis']`. `startersFor`
     * cannot return any of the three and neither locale defines them, so
     * `t()` did what it does on a miss and printed the key: three buttons
     * reading `chat.starters.program`, `chat.starters.formCheck` and
     * `chat.starters.whatIsThis`, on the first screen a new account opens.
     *
     * The fixture now CALLS the selector, so there is no second list to drift.
     * This asserts that it does, and that the call is not decorative.
     */
    const chosen = startersFor(PROFILE);
    assert.ok(chosen.length > 0, 'startersFor returns nothing for the fixture profile, so the panel is empty');
    assert.ok(chosen.length <= MAX_STARTERS, `startersFor returned ${chosen.length} openers, above MAX_STARTERS`);

    const fixtureSource = readSource(new URL('../../web/harness/fixtures.js', import.meta.url));
    assert.match(
      fixtureSource,
      /starters: startersFor\(PROFILE\)/,
      'the harness writes its own starter ids again instead of asking the selector',
    );
  });

  test('and EVERY id the selector can ever return is translated, in both languages', () => {
    /*
     * The fixture only exercises one profile. The defect class is a missing
     * string, so the closure is what matters: read the ids out of the selector
     * itself and require each to exist in both catalogues.
     */
    const all = [...new Set(
      [...startersSource.matchAll(/'([a-z][a-zA-Z]*)'/g)].map((match) => match[1]),
    )];

    // The snake_case strings in this file are `experience_level` and `goal`
    // values, which is why the pattern above is camelCase only. The floor is
    // checked against the ids that were actually there when this was written -
    // a parser that finds nothing passes every assertion under it.
    assert.ok(all.length >= 9, `only ${all.length} starter ids were parsed out of starters.js, which cannot be right`);

    /*
     * And the other direction, because a catalogue of nine translated ids says
     * nothing if the selector returns a tenth. Drive it over every goal and
     * experience the schema allows, plus the clearance branch, and require the
     * whole reachable set to be inside the parsed one.
     */
    const EXPERIENCES = [null, 'never_lifted', 'learning_lifts', 'under_6_months',
      'six_to_24_months', 'over_2_years', 'never_trained', 'some_experience', 'currently_training'];
    const GOALS = [null, 'learn_the_lifts', 'general_strength', 'return_from_layoff',
      'body_composition', 'first_meet', 'meet_prep'];
    const reachable = new Set();
    for (const experience_level of EXPERIENCES) {
      for (const goal of GOALS) {
        for (const awaitingClearance of [false, true]) {
          for (const id of startersFor({ experience_level, goal }, { awaitingClearance })) reachable.add(id);
        }
      }
    }
    assert.ok(reachable.size >= 6, `only ${reachable.size} ids are reachable, so the sweep is not reaching the branches`);
    for (const id of reachable) {
      assert.ok(all.includes(id), `startersFor can return '${id}', which this test's own parser did not find`);
    }

    for (const [name, locale] of [['en', en], ['es', es]]) {
      for (const id of all) {
        assert.match(
          locale,
          new RegExp(`\\n\\s*${id}:\\s*['"\`]`),
          `${name} has no chat.starters.${id}, so that opener renders as its own key`,
        );
      }
    }
  });
});

describe('the first-week panel is a thing you can press', () => {
  test('its dismiss button clears the AA target floor', () => {
    /*
     * 58x20 measured on the rendered page, against the 24x24 WCAG 2.5.8 asks
     * for at AA. Same defect as the 23px `button.link` and the 23px policy
     * footer anchors, on a third class name that neither floor reaches - and
     * invisible to the eighteen-screen sweep for a different reason again:
     * this panel only renders before there is data, and that sweep ran the
     * `full` fixtures only.
     */
    const rule = css
      .split('}')
      .map((block) => block.split('{'))
      .filter((parts) => parts.length === 2 && parts[0].split(',').map((x) => x.trim()).includes('.first-week-hide'));
    assert.equal(rule.length, 1, '.first-week-hide has no rule of its own');
    assert.match(rule[0][1], /min-height:\s*24px/, 'the dismiss button is under the 24px SC 2.5.8 asks for at AA');
    assert.doesNotMatch(rule[0][1], /padding:\s*0;/, 'zero padding is what made it 20px tall');
  });
});
