import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES } from '../src/lib/errorCodes.js';
import { readProfileApi } from './helpers/source.js';

import { evaluateAgeGate, ageInYears, MINIMUM_AGE } from '../src/lib/ageGate.js';
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
