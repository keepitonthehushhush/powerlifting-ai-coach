import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/lib/logger.js';

/**
 * Health data reaching a log file is the failure mode this project most needs
 * to avoid, so the redactor is tested against the shapes it will actually
 * encounter: a profile row, a nested error payload, an auth header.
 */
describe('redact', () => {
  test('removes health restrictions from a profile row', () => {
    const out = redact({
      user_id: 'abc',
      experience_level: 'never_trained',
      health_restrictions: 'herniated disc L4/L5, ongoing sciatica',
    });
    assert.equal(out.health_restrictions, '[redacted]');
    assert.equal(out.experience_level, 'never_trained', 'non-sensitive fields must survive');
  });

  test('reaches sensitive keys nested inside errors and arrays', () => {
    const out = redact({
      rows: [{ id: 1, injury_notes: 'shoulder impingement' }],
      context: { supabase: { body: { health_restrictions: 'knee pain' } } },
    });
    assert.equal(out.rows[0].injury_notes, '[redacted]');
    assert.equal(out.context.supabase.body.health_restrictions, '[redacted]');
  });

  test('removes credentials as well as health data', () => {
    const out = redact({ authorization: 'Bearer ey...', access_token: 'x', api_key: 'sk-ant-x' });
    assert.equal(out.authorization, '[redacted]');
    assert.equal(out.access_token, '[redacted]');
    assert.equal(out.api_key, '[redacted]');
  });

  test('matches on substrings so related field names are covered', () => {
    const out = redact({ past_injuries: 'x', current_medications: 'y', medicalHistory: 'z' });
    assert.equal(out.past_injuries, '[redacted]');
    assert.equal(out.current_medications, '[redacted]');
    assert.equal(out.medicalHistory, '[redacted]');
  });

  test('does not mutate the object being logged', () => {
    const original = { health_restrictions: 'knee pain' };
    redact(original);
    assert.equal(original.health_restrictions, 'knee pain');
  });

  test('drops error stacks, which routinely embed request bodies', () => {
    const out = redact(new Error('boom'));
    assert.equal(out.message, 'boom');
    assert.equal(out.stack, undefined);
  });

  test('terminates on circular structures rather than recursing forever', () => {
    const a = { name: 'a' };
    a.self = a;
    assert.doesNotThrow(() => redact(a));
  });
});
