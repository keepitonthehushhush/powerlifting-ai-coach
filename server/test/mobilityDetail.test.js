import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readMigration, flatten, phrase } from './helpers/source.js';
import {
  MOBILITY_DETAIL_LEVELS,
  DEFAULT_MOBILITY_DETAIL,
  resolveMobilityDetail,
  directiveFor,
} from '../src/lib/mobilityDetail.js';
import {
  MOBILITY_DETAIL_LEVELS as WEB_LEVELS,
  DEFAULT_MOBILITY_DETAIL as WEB_DEFAULT,
  resolveMobilityDetail as webResolve,
} from '../../web/src/lib/mobilityDetail.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';

/**
 * ── WHY THIS SETTING EXISTS ───────────────────────────────────────────────
 *
 * "It does not provide the stretches." The coach was obeying its warm-up
 * instructions, which say not to attach a generic stretching routine to every
 * session - right for most people, and it left the athlete who wants one with
 * no way to ask that outlives the conversation window.
 */
const migration = readMigration(
  new URL('../../supabase/migrations/0074_how_much_mobility_work_they_actually_want.sql', import.meta.url),
);
const preferences = readSource(new URL('../src/routes/preferences.js', import.meta.url));

const PROFILE = {
  units: 'lb',
  bodyweight: 200,
  experience_level: 'two years',
  cleared_to_train: true,
  goal: 'get stronger',
  days_per_week: 4,
};

const promptFor = (mobility_detail) =>
  flatten(buildSystemPrompt({ profile: { ...PROFILE, mobility_detail } }));

describe('the levels', () => {
  test('are the three the migration permits, and no others', () => {
    // The CHECK is the enforcement; this is the code that feeds it. Two lists
    // for one rule is how this repository got an integration that worked and
    // audited nothing.
    const check = migration.slice(migration.indexOf('check (mobility_detail'));
    assert.ok(check.length > 0, 'the CHECK is gone - this check did not run');
    const inDb = [...check.slice(0, check.indexOf(')')).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...inDb].sort(), [...MOBILITY_DETAIL_LEVELS].sort());
  });

  test('the browser copy has not drifted from the server one', () => {
    assert.deepEqual([...WEB_LEVELS], [...MOBILITY_DETAIL_LEVELS]);
    assert.equal(WEB_DEFAULT, DEFAULT_MOBILITY_DETAIL);
    for (const level of MOBILITY_DETAIL_LEVELS) {
      assert.equal(webResolve(level), resolveMobilityDetail(level));
    }
    assert.equal(webResolve('nonsense'), resolveMobilityDetail('nonsense'));
  });

  test('the database default is the code default', () => {
    assert.match(migration, new RegExp(`default '${DEFAULT_MOBILITY_DETAIL}'`));
  });

  test('THE DEFAULT IS THE MIDDLE LEVEL, NOT THE WIDEST', () => {
    /*
     * This is the asymmetry with nutrition_detail and it is the whole safety
     * argument for a setting that can WIDEN.
     *
     * An unreadable value - a build older than the value, a null from before
     * the column - resolves here. Resolving to `full` would have an old build
     * start prescribing a block nobody asked for; resolving to `off` would
     * silently withhold the targeted drills that were always part of the
     * product. The status quo is the only safe fallback.
     */
    assert.equal(DEFAULT_MOBILITY_DETAIL, 'brief');
    assert.equal(MOBILITY_DETAIL_LEVELS.indexOf(DEFAULT_MOBILITY_DETAIL), 1);
    for (const junk of [null, undefined, '', 'FULL', 'everything', 42, {}]) {
      assert.equal(resolveMobilityDetail(junk), 'brief');
    }
  });
});

describe('what reaches the model', () => {
  test('the default costs nothing', () => {
    // A directive restating what the warm-up section already says would spend
    // tokens on every turn of every conversation to change nothing.
    assert.equal(directiveFor('brief'), null);
    assert.equal(directiveFor(undefined), null);
  });

  test('off and full each say something, and the prompt carries it', () => {
    for (const level of ['off', 'full']) {
      const directive = directiveFor(level);
      assert.ok(directive, `${level} produces no directive`);
      assert.ok(promptFor(level).includes(directive.trim().slice(0, 60)), `${level} never reaches the prompt`);
    }
  });

  test('the built prompt at the default carries no mobility directive', () => {
    const built = promptFor('brief');
    assert.ok(!built.includes('MOBILITY WORK IS OFF'));
    assert.ok(!built.includes('ASKED FOR THE FULL MOBILITY BLOCK'));
  });
});

describe('NO LEVEL MAY PROMISE WHAT THE EVIDENCE DOES NOT SUPPORT', () => {
  /*
   * The three findings that bound this feature:
   *
   *   - static stretching before lifting measurably reduces force, ranking
   *     last of every warm-up method tested for explosive strength;
   *   - active cool-downs are "largely ineffective for improving most
   *     psychophysiological markers of post-exercise recovery" (Van Hooren
   *     and Peake);
   *   - the protection people expect comes from warm-ups and from getting
   *     stronger through full range, not from lengthening tissue.
   *
   * A rule about what copy may claim is a rule somebody edits in a hurry, so
   * it is asserted rather than written in a comment and trusted.
   */
  const CLAIMS = [
    [/prevents? injur|injury prevention|avoid(ing)? injur/i, 'injury prevention'],
    [/speeds? recovery|aids? recovery|improves? recovery|flush(es)? /i, 'recovery'],
    [/reduces? soreness|less sore|prevent(s)? soreness/i, 'soreness'],
  ];

  test('not in the directives', () => {
    for (const level of MOBILITY_DETAIL_LEVELS) {
      const directive = directiveFor(level) ?? '';
      // The `full` directive names these in order to FORBID them, so the
      // negative claim is scoped to sentences that are not prohibitions.
      const asserted = directive
        .split('\n')
        .filter((line) => !/do not|never|does not|cannot|the evidence/i.test(line))
        .join('\n');
      for (const [pattern, what] of CLAIMS) {
        assert.ok(!pattern.test(asserted), `the ${level} directive claims ${what}`);
      }
    }
  });

  test('not in the settings copy, in either language', () => {
    for (const [name, catalog] of [['en', en], ['es', es]]) {
      const copy = catalog.mobilitySettings;
      assert.ok(copy, `mobilitySettings is missing from ${name}.js`);
      const prose = [copy.heading, copy.intro, copy.legend, ...Object.values(copy.level), ...Object.values(copy.levelHint)].join(' ');
      for (const [pattern, what] of CLAIMS) {
        assert.ok(!pattern.test(prose), `${name}.js sells this as ${what}`);
      }
    }
  });

  test('and the screen says so out loud rather than merely not lying', () => {
    // A settings screen offering a stretch routine is exactly where somebody
    // arrives believing it prevents injury. Saying nothing leaves them
    // believing it.
    for (const [name, catalog] of [['en', en], ['es', es]]) {
      assert.ok(catalog.mobilitySettings.notRecovery, `mobilitySettings.notRecovery is missing from ${name}.js`);
    }
    assert.match(en.mobilitySettings.notRecovery, /does not speed recovery or prevent injury/i);
    assert.match(es.mobilitySettings.notRecovery, /no acelera la recuperación ni previene lesiones/i);
  });
});

describe('the rules that sit above this setting', () => {
  test('held stretches stay after training at every level', () => {
    const full = directiveFor('full');
    assert.match(full, phrase('AFTER the training, never before', 'i'));
    assert.match(full, phrase('reduce force production', 'i'));
  });

  test('THE UNDIAGNOSED-INJURY RULE IS NOT UNLOCKED BY full', () => {
    /*
     * The clearance rule forbids suggesting stretches, mobility work,
     * corrective exercises or rehab movements to somebody who has reported a
     * symptom and has not been cleared. That is a clinical call. A preference
     * about how a healthy athlete's training is written is not consent to be
     * treated, and the widest setting of a comfort control must never be
     * readable as the athlete having authorized it.
     */
    // phrase(), not a raw regex: the directive is wrapped prose and a pattern
    // that spans a line break matches nothing. Cost one round here, and it is
    // the reason this helper exists.
    assert.match(directiveFor('full'), phrase('has reported a symptom that has not been cleared', 'i'));
    assert.match(directiveFor('full'), phrase('That rule is above this one'));
  });

  test('turning mobility off does not touch the warm-up', () => {
    // The warm-up is not mobility work and is the last thing cut. An athlete
    // setting this to off must not lose their ramp sets.
    assert.match(directiveFor('off'), phrase('warm-up is NOT mobility work and still applies in full', 'i'));
  });
});

describe('the route', () => {
  test('validates against the level list rather than a literal', () => {
    assert.match(preferences, /const MobilityDetail = new Set\(MOBILITY_DETAIL_LEVELS\)/);
    assert.match(preferences, /preferencesRouter\.get\('\/mobility-detail'/);
    assert.match(preferences, /preferencesRouter\.put\('\/mobility-detail'/);
  });

  test('never logs the value, only that it changed', () => {
    // "Somebody turned mobility work off" is an inference about a person that
    // a log line has no reason to hold.
    const at = preferences.indexOf("preferences.mobility_detail_saved");
    assert.ok(at > 0, 'the save is not logged at all');
    const line = preferences.slice(at, preferences.indexOf('\n', at));
    assert.ok(!line.includes('value'), 'the log line carries the athlete setting');
  });
});
