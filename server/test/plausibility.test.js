import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessProfileNumbers,
  worstSeverity,
  CEILING_MULTIPLE,
  NOVICE_MULTIPLE,
} from '../src/lib/plausibility.js';
import { describeNumberChecks, describeProgressCadence, buildSystemPrompt } from '../src/prompts/systemPrompt.js';
import { flatten, readSource } from './helpers/source.js';

const base = {
  units: 'lb',
  bodyweight: 200,
  experience_level: 'six_to_24_months',
  progress_cadence: 'every_session',
  health_restrictions: '',
  equipment_available: 'full gym',
  days_per_week: 3,
  goal: 'general_strength',
};

const codes = (profile) => assessProfileNumbers(profile).map((f) => f.code);

describe('assessProfileNumbers', () => {
  test('says nothing about a perfectly ordinary set of numbers', () => {
    assert.deepEqual(
      codes({ ...base, current_squat: 315, current_bench: 225, current_deadlift: 405 }),
      []
    );
  });

  test('says nothing at all when no lifts have been entered', () => {
    assert.deepEqual(codes({ ...base }), []);
  });

  test('catches the missing keystroke', () => {
    // 315 typed as 3150. The single highest-confidence check in the module.
    const found = codes({ ...base, current_squat: 3150 });
    assert.ok(found.includes('squat_beyond_ceiling'));
  });

  test('does NOT call a genuine elite lifter impossible', () => {
    // A 500lb squat at 200lb bodyweight is 2.5x - a very strong lifter, and a
    // real one. The check that fires here is the check that insults them.
    assert.deepEqual(
      codes({ ...base, current_squat: 500, current_bench: 350, current_deadlift: 585 }),
      []
    );
  });

  test('the ceiling sits above the elite standard, not at it', () => {
    for (const lift of ['squat', 'bench', 'deadlift']) {
      assert.ok(
        CEILING_MULTIPLE[lift] > NOVICE_MULTIPLE[lift] * 2,
        `${lift} ceiling is too close to ordinary human numbers`
      );
    }
  });

  test('catches two boxes filled in the wrong order', () => {
    const found = codes({ ...base, current_squat: 225, current_bench: 315, current_deadlift: 405 });
    assert.ok(found.includes('bench_exceeds_squat'));
  });

  test('catches a bench above the deadlift', () => {
    const found = codes({ ...base, current_squat: 500, current_bench: 400, current_deadlift: 405 });
    assert.ok(found.includes('bench_exceeds_deadlift'));
  });

  test('notices a deadlift far below the squat, but only quietly', () => {
    const findings = assessProfileNumbers({
      ...base,
      current_squat: 400,
      current_deadlift: 300,
    });
    const low = findings.find((f) => f.code === 'deadlift_low_against_squat');
    assert.ok(low, 'the imbalance was not noticed');
    assert.equal(low.severity, 'low', 'a real body type must not be flagged loudly');
  });

  test('notices numbers that contradict having never touched a barbell', () => {
    const found = codes({
      ...base,
      experience_level: 'never_lifted',
      current_squat: 315,
      current_deadlift: 405,
    });
    assert.ok(found.includes('untrained_but_strong'));
  });

  test('but a beginner with beginner numbers is left alone', () => {
    assert.deepEqual(
      codes({ ...base, experience_level: 'never_lifted', current_squat: 95, current_bench: 65 }),
      []
    );
  });

  test('three identical maxes read as a placeholder', () => {
    const found = codes({ ...base, current_squat: 200, current_bench: 200, current_deadlift: 200 });
    assert.ok(found.includes('all_three_identical'));
  });

  test('understatement is caught gently or not at all', () => {
    // Someone who says progress now comes monthly, with numbers a first-week
    // novice would post. Most likely they entered sets rather than singles.
    const findings = assessProfileNumbers({
      ...base,
      experience_level: 'over_2_years',
      progress_cadence: 'every_month_or_slower',
      current_squat: 135,
      current_bench: 95,
      current_deadlift: 155,
    });
    const soft = findings.find((f) => f.code === 'experienced_but_light');
    assert.ok(soft);
    assert.equal(soft.severity, 'low');
    assert.equal(soft.direction, 'understated');
  });

  test('only overstatement is ever treated as urgent', () => {
    // The asymmetry the module is built on: too heavy is a safety problem,
    // too light is a week of easy training.
    for (const profile of [
      { ...base, current_squat: 3150 },
      { ...base, current_squat: 135, current_bench: 95, current_deadlift: 155, experience_level: 'over_2_years', progress_cadence: 'every_month_or_slower' },
    ]) {
      for (const finding of assessProfileNumbers(profile)) {
        if (finding.severity === 'high') {
          assert.notEqual(finding.direction, 'understated');
        }
      }
    }
  });

  test('every finding carries a question to ask, not a conclusion to state', () => {
    const findings = assessProfileNumbers({
      ...base,
      current_squat: 3150,
      current_bench: 315,
      current_deadlift: 225,
    });
    assert.ok(findings.length > 0);
    for (const f of findings) {
      assert.ok(f.ask && f.ask.length > 20, `${f.code} has no question`);
      assert.ok(f.observation && f.observation.length > 20, `${f.code} has no observation`);
    }
  });

  test('survives a missing profile, a missing bodyweight and junk values', () => {
    assert.deepEqual(assessProfileNumbers(null), []);
    assert.deepEqual(assessProfileNumbers(undefined), []);
    // No bodyweight means the multiples cannot be computed, but the ratio
    // checks still can - and they are the reliable ones anyway.
    assert.ok(
      codes({ ...base, bodyweight: null, current_squat: 225, current_bench: 315 }).includes(
        'bench_exceeds_squat'
      )
    );
    assert.deepEqual(
      codes({ ...base, current_squat: NaN, current_bench: 0, current_deadlift: -5 }),
      []
    );
  });

  test('worstSeverity reports the loudest finding present', () => {
    assert.equal(worstSeverity([]), null);
    assert.equal(worstSeverity(null), null);
    assert.equal(worstSeverity([{ severity: 'low' }, { severity: 'high' }]), 'high');
    assert.equal(worstSeverity([{ severity: 'low' }, { severity: 'medium' }]), 'medium');
  });
});

describe('how the coach is told to raise it', () => {
  const directive = describeNumberChecks({
    ...base,
    experience_level: 'never_lifted',
    current_squat: 225,
    current_bench: 315,
    current_deadlift: 405,
  });

  test('there is a directive at all when something looks off', () => {
    assert.ok(directive);
  });

  test('it never puts an accusation in the coach’s mouth', () => {
    // The whole design fails if this produces a coach who audits a new client.
    // Each of these words is allowed to appear ONCE, inside the sentence that
    // forbids it, and nowhere else. Matching on the flattened text because
    // these directives are hard-wrapped and the prohibition spans two lines.
    const flat = flatten(directive).toLowerCase();
    const prohibition = flat.slice(flat.indexOf('never use the words'));
    assert.ok(prohibition.length > 0, 'the directive does not forbid the words at all');
    for (const word of ['lying', 'dishonest', 'inflated', 'exaggerat', 'unrealistic']) {
      const total = flat.split(word).length - 1;
      const insideProhibition = prohibition.split(word).length - 1;
      assert.equal(
        total,
        insideProhibition,
        `"${word}" appears in the directive somewhere other than the sentence forbidding it`
      );
    }
  });

  test('it forbids withholding coaching over arithmetic', () => {
    assert.match(directive, /DO NOT WITHHOLD COACHING/);
  });

  test('it tells the coach to ask once and then let it go', () => {
    const flat = flatten(directive);
    assert.match(flat, /once, in one sentence/i);
    assert.match(flat, /believe whatever they tell you/i);
  });

  test('an overstated number makes the first prescription conservative', () => {
    const overstated = describeNumberChecks({ ...base, current_squat: 3150 });
    assert.match(overstated, /CONSERVATIVE/);
  });

  test('and it expires the moment there is a logged session to read', () => {
    assert.match(flatten(directive), /logs a real session/);
    const withLogs = buildSystemPrompt({
      profile: { ...base, experience_level: 'never_lifted', current_squat: 225, current_bench: 315 },
      recentLogs: [{ date: '2026-08-01', lift: 'squat', weight: 225, reps: 5, sets: 3, completed: true }],
    });
    assert.doesNotMatch(withLogs, /THE ENTERED MAXES DO NOT QUITE ADD UP/);
  });

  test('nothing is said when the numbers are ordinary', () => {
    assert.equal(
      describeNumberChecks({ ...base, current_squat: 315, current_bench: 225, current_deadlift: 405 }),
      null
    );
  });
});

describe('what the reported rate of progress is allowed to change', () => {
  test('a session-by-session lifter is exactly who this app is built for, so nothing is said', () => {
    assert.equal(describeProgressCadence({ progress_cadence: 'every_session' }), null);
    assert.equal(describeProgressCadence({ progress_cadence: 'no_history' }), null);
    assert.equal(describeProgressCadence({}), null);
  });

  test('a stalled lifter is told plainly that linear progression may not fit', () => {
    const directive = describeProgressCadence({ progress_cadence: 'stalled' });
    assert.match(directive, /OUTGROWN THE MODEL/);
    assert.match(flatten(directive), /not a failure/i);
  });

  test('it does not promise programming this codebase cannot write', () => {
    for (const cadence of ['every_week', 'every_month_or_slower', 'stalled']) {
      assert.match(
        flatten(describeProgressCadence({ progress_cadence: cadence })),
        /Do not promise a periodised or block program/
      );
    }
  });

  test('cadence changes what is SAID, never what progression computes', () => {
    // The loads come from logged performance. A recollection of the last few
    // months is a far weaker signal than a set that was actually done, and
    // letting it move the numbers would undo the point of computing them.
    const progression = readSource(new URL('../src/lib/progression.js', import.meta.url));
    assert.doesNotMatch(progression, /progress_cadence|cadence/);
  });
});
