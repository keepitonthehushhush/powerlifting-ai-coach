import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES } from '../src/lib/errorCodes.js';
import { readProfileApi } from './helpers/source.js';

import {
  evaluateAgeGate,
  ageInYears,
  adultGateDecision,
  MINIMUM_AGE,
  ABSOLUTE_MINIMUM_AGE,
} from '../src/lib/ageGate.js';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';

// A fixed reference date, so these assertions mean the same thing next year.
const NOW = new Date('2026-08-25T12:00:00Z');

describe('ageInYears', () => {
  test('is calendar-correct on the birthday and the day either side', () => {
    assert.equal(ageInYears('2008-08-24', NOW), 18, 'day after turning 18');
    assert.equal(ageInYears('2008-08-25', NOW), 18, 'on the 18th birthday');
    assert.equal(ageInYears('2008-08-26', NOW), 17, 'day before turning 18');
  });

  test('does not drift across leap years', () => {
    // Elapsed-milliseconds ÷ 365.25 gets this wrong, and gets it wrong exactly
    // at the boundary where it matters.
    assert.equal(ageInYears('2008-02-29', new Date('2026-02-28T12:00:00Z')), 17);
    assert.equal(ageInYears('2008-02-29', new Date('2026-03-01T12:00:00Z')), 18);
  });

  test('returns null rather than a number for anything unparseable', () => {
    for (const value of [null, undefined, '', 'yesterday', 'not-a-date', {}]) {
      assert.equal(ageInYears(value, NOW), null);
    }
  });
});

describe('evaluateAgeGate', () => {
  test('admits an adult', () => {
    const gate = evaluateAgeGate('1990-01-01', NOW);
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, 'ok');
  });

  test('admits on the eighteenth birthday exactly, not the day after', () => {
    assert.equal(evaluateAgeGate('2008-08-25', NOW).allowed, true);
    assert.equal(evaluateAgeGate('2008-08-26', NOW).allowed, false);
  });

  test('refuses a minor, and says which reason', () => {
    const gate = evaluateAgeGate('2012-06-01', NOW);
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'too_young');
  });

  test('distinguishes a typo from a minor', () => {
    // Telling a 70-year-old they are too young because they typed 2030 is a
    // dead end for them. The reason has to carry the difference.
    assert.equal(evaluateAgeGate('2030-01-01', NOW).reason, 'implausible');
    assert.equal(evaluateAgeGate('1850-01-01', NOW).reason, 'implausible');
  });

  describe('fails closed', () => {
    for (const [label, value] of [
      ['missing', null],
      ['empty string', ''],
      ['unparseable', 'sometime in 1990'],
      ['not a string', 12345],
    ]) {
      test(label, () => {
        const gate = evaluateAgeGate(value, NOW);
        assert.equal(gate.allowed, false, 'an unreadable date must never admit anyone');
        assert.equal(gate.reason, 'unknown');
      });
    }
  });

  test('the minimum is stated once, not scattered', () => {
    assert.equal(typeof MINIMUM_AGE, 'number');
    const boundary = new Date(Date.UTC(NOW.getUTCFullYear() - MINIMUM_AGE, 7, 25));
    assert.equal(evaluateAgeGate(boundary.toISOString().slice(0, 10), NOW).allowed, true);
  });
});

describe('the gate is enforced where it counts', () => {
  const route = readProfileApi({ raw: true });

  test('the API checks it, not only the form', () => {
    // The form is not the control. Anyone can POST to this route.
    assert.match(route, /evaluateAgeGate/);
    // Through the registry, not by matching "403" in the source. The literal
    // moved into errorCodes.js and this test failed on a change that made the
    // status MORE reliable, which is the shape of a test asserting text
    // instead of behavior - the sixth in this repository.
    assert.match(route, /codedError\(\s*'age_restricted'/);
    assert.equal(ERROR_CODES.age_restricted.status, 403);
  });

  test('it fires on health fields rather than on every write', () => {
    // A minor is not barred from having an account or a bodyweight; they are
    // barred from us storing health information about them. A gate that is
    // broader than the obligation is inaccurate, not extra-safe.
    for (const field of ['health_restrictions', 'sleep_hours_typical', 'alcohol_units_per_week', 'nicotine_use', 'nutrition_notes']) {
      assert.ok(route.includes(field), `${field} must be in the health-field list the gate keys on`);
    }
  });

  test('the block is logged by reason, never by date or age', () => {
    const block = route.slice(route.indexOf('age_gate_blocked') - 200, route.indexOf('age_gate_blocked') + 200);
    assert.match(block, /reason/);
    assert.ok(!/dateOfBirth[^)]*\}/.test(block), 'a birth date must not reach the logs');
    assert.ok(!/gate\.age/.test(block), 'a computed age must not reach the logs');
  });
});

describe('age reaches the coach', () => {
  test('a known birth date renders as an age', () => {
    const prompt = buildSystemPrompt({ profile: { units: 'lb', date_of_birth: '1990-01-01' } });
    assert.match(prompt, /age: +\d+/);
  });

  test('an unknown one does not invent a number', () => {
    const prompt = buildSystemPrompt({ profile: { units: 'lb' } });
    assert.match(prompt, /age: +not provided yet/);
  });

  test('the prompt treats age as an input, not a stereotype', () => {
    const prompt = buildSystemPrompt({ profile: { units: 'lb', date_of_birth: '1960-01-01' } });
    assert.match(prompt, /one input among several/);
    assert.match(prompt, /Do not make age a running theme/);
  });
});

/**
 * The four bands, and the switch that keeps three of them asleep.
 *
 * ── WHY THIS IS EXHAUSTIVE AND NOT A HAPPY PATH ───────────────────────────
 *
 * This function decides whether a product that holds health information will
 * coach a child. Every boundary is a year of somebody's life, and the failure
 * that matters is not an exception - it is a quiet `allowed: true`. So the
 * table below walks every age from 10 to 20 in both switch positions, rather
 * than sampling the ones that felt interesting while writing it.
 */
describe('the guardian consent path', () => {
  const asOf = new Date('2026-08-29T00:00:00Z');
  const born = (age) => {
    const d = new Date(Date.UTC(2026 - age, 7, 29));   // a birthday exactly today
    return d.toISOString().slice(0, 10);
  };
  const decide = (age, opts) => adultGateDecision({ date_of_birth: born(age) }, { asOf, ...opts });

  test('with the switch OFF nothing under 18 is coached, whatever anybody consents to', () => {
    for (let age = 10; age <= 20; age++) {
      const withConsent = decide(age, { minorsEnabled: false, guardianConsent: true });
      const without = decide(age, { minorsEnabled: false, guardianConsent: false });
      assert.equal(withConsent.allowed, age >= MINIMUM_AGE, `age ${age} with a guardian consent`);
      assert.equal(without.allowed, age >= MINIMUM_AGE, `age ${age} without one`);
      // And a guardian consent must not even change the reason code while off.
      assert.deepEqual(withConsent, without, `age ${age}: the switch is off but consent changed the answer`);
    }
  });

  test('with the switch OFF the reason codes are the ones that shipped', () => {
    // A new reason code reaching a user while the feature is off would be a
    // message about guardians on a product that has no guardian path.
    for (let age = 10; age <= 20; age++) {
      const { reason } = decide(age, { minorsEnabled: false, guardianConsent: true });
      assert.ok(['ok', 'too_young'].includes(reason), `age ${age} produced ${reason}`);
    }
  });

  /**
   * ── THE FLOOR IS A LITERAL, ON PURPOSE ────────────────────────────────
   *
   * Every other assertion in this file reads ABSOLUTE_MINIMUM_AGE from the
   * module, which means lowering the constant does not fail them - it just
   * makes their loops shorter. Dropping the floor from 13 to 10 passed the
   * whole suite, and that is the single most consequential number in this
   * feature: below 13 the product falls under COPPA's amended Rule, with
   * verifiable parental consent, a mandated written information security
   * program, and penalties to $53,088 per violation.
   *
   * 13 is a legal fact, not a configuration value, so it is written out here
   * as a number. A test that derives its expectation from the thing it is
   * checking is a test that agrees with whatever it finds.
   */
  test('the hard floor is 13 and 18 is the age of consent', () => {
    assert.equal(ABSOLUTE_MINIMUM_AGE, 13, 'COPPA reaches under-13s; this floor is not a dial');
    assert.equal(MINIMUM_AGE, 18);
  });

  test('12 and under is refused whoever consents, at every switch position', () => {
    for (const age of [0, 5, 10, 11, 12]) {
      for (const enabled of [false, true]) {
        const d = decide(age, { minorsEnabled: enabled, guardianConsent: true });
        assert.equal(d.allowed, false, `age ${age} was allowed (minorsEnabled=${enabled})`);
        assert.equal(d.reason, 'too_young', `age ${age} got reason ${d.reason}`);
      }
    }
  });

  test('13 is the first age a guardian consent can do anything at all', () => {
    assert.equal(decide(12, { minorsEnabled: true, guardianConsent: true }).allowed, false);
    assert.equal(decide(13, { minorsEnabled: true, guardianConsent: true }).allowed, true);
    assert.equal(decide(13, { minorsEnabled: true, guardianConsent: false }).reason, 'guardian_consent_required');
  });

  test('with the switch ON, under 13 is refused no matter who consents', () => {
    for (let age = 0; age < ABSOLUTE_MINIMUM_AGE; age++) {
      const d = decide(age, { minorsEnabled: true, guardianConsent: true });
      assert.equal(d.allowed, false, `age ${age} was allowed with a guardian consent`);
      assert.equal(d.reason, 'too_young');
    }
  });

  test('with the switch ON, 13 to 17 turns on the guardian consent', () => {
    for (let age = ABSOLUTE_MINIMUM_AGE; age < MINIMUM_AGE; age++) {
      const without = decide(age, { minorsEnabled: true, guardianConsent: false });
      assert.equal(without.allowed, false, `age ${age} was coached with no guardian consent`);
      assert.equal(without.reason, 'guardian_consent_required');
      assert.equal(without.isMinor, true);

      const withIt = decide(age, { minorsEnabled: true, guardianConsent: true });
      assert.equal(withIt.allowed, true, `age ${age} was refused despite a guardian consent`);
      assert.equal(withIt.isMinor, true, `age ${age} must still be marked a minor`);
    }
  });

  test('18 and over is never a minor and never needs a guardian', () => {
    for (const enabled of [false, true]) {
      for (let age = MINIMUM_AGE; age <= 25; age++) {
        const d = decide(age, { minorsEnabled: enabled, guardianConsent: false });
        assert.equal(d.allowed, true);
        assert.equal(d.isMinor, false, `age ${age} was marked a minor`);
      }
    }
  });

  test('it still fails closed on a date it cannot read', () => {
    for (const enabled of [false, true]) {
      for (const dob of [null, undefined, '', 'not a date', '2099-01-01']) {
        const d = adultGateDecision({ date_of_birth: dob }, { asOf, minorsEnabled: enabled, guardianConsent: true });
        assert.equal(d.allowed, false, `${dob} was allowed through`);
        assert.equal(d.isMinor, false, `${dob} should not be reported as a minor - it is unknown`);
      }
      assert.equal(adultGateDecision(null, { asOf, minorsEnabled: enabled }).allowed, false);
    }
  });

  test('the day somebody turns 18 they stop needing a guardian', () => {
    // isMinor is computed, never stored. A stored flag is right until the
    // morning of a birthday and silently wrong afterwards - and would leave a
    // legal adult under somebody else's authority.
    const seventeenth = { date_of_birth: '2008-08-30' };   // 17 today, 18 tomorrow
    const opts = { minorsEnabled: true, guardianConsent: false };
    assert.equal(adultGateDecision(seventeenth, { ...opts, asOf }).isMinor, true);
    assert.equal(adultGateDecision(seventeenth, { ...opts, asOf }).allowed, false);

    const tomorrow = new Date('2026-08-30T00:00:00Z');
    assert.equal(adultGateDecision(seventeenth, { ...opts, asOf: tomorrow }).isMinor, false);
    assert.equal(adultGateDecision(seventeenth, { ...opts, asOf: tomorrow }).allowed, true);
  });

  test('the old two-argument call still works', () => {
    // chat.js passed a Date as the second argument for months. Breaking that
    // silently would open the gate, not close it.
    assert.equal(adultGateDecision({ date_of_birth: '1990-01-01' }, asOf).allowed, true);
    assert.equal(adultGateDecision({ date_of_birth: '2015-01-01' }, asOf).allowed, false);
  });
});
