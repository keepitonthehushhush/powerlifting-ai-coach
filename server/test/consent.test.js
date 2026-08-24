import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_TYPES,
  POLICY_VERSIONS,
  REQUIRED_CONSENTS,
  deriveCurrentConsents,
} from '../src/lib/policyVersions.js';

/**
 * Consent state, per Washington's My Health My Data Act.
 *
 * The enforcement itself lives in Postgres — a trigger refuses to store health
 * data without active consent, and the `authenticated` role has no UPDATE or
 * DELETE on the ledger, so history cannot be rewritten from the application.
 * Those are verified against the live database (docs/BUILD_LOG.md).
 *
 * What is testable here is the reduction from ledger to current state, and the
 * policy decisions encoded in the constants.
 */

describe('policy configuration', () => {
  test('every consent type has a policy version', () => {
    for (const type of CONSENT_TYPES) {
      assert.ok(POLICY_VERSIONS[type], `${type} needs a version, or its consents prove nothing`);
    }
  });

  test('health data collection is NOT required to use the product', () => {
    // MHMDA requires consent to be freely given. Consent that gates something
    // unrelated to its purpose is not freely given — and the coach genuinely
    // works without injury data, just more conservatively.
    assert.ok(
      !REQUIRED_CONSENTS.includes('health_data_collection'),
      'making health data mandatory would be both worse practice and legally weaker'
    );
  });

  test('the consents that are required are the ones the product cannot run without', () => {
    assert.deepEqual([...REQUIRED_CONSENTS].sort(), ['ai_processing', 'terms_of_service']);
  });
});

describe('deriveCurrentConsents', () => {
  const V = POLICY_VERSIONS;

  test('reports every type as ungranted when the ledger is empty', () => {
    const current = deriveCurrentConsents([]);
    for (const type of CONSENT_TYPES) {
      assert.equal(current[type].granted, false, `${type} must default to not granted`);
      assert.equal(current[type].stale, false);
    }
  });

  test('the newest row per type wins', () => {
    // Rows arrive newest-first, as the query orders them.
    const current = deriveCurrentConsents([
      { consent_type: 'health_data_collection', granted: false, policy_version: V.health_data_collection },
      { consent_type: 'health_data_collection', granted: true, policy_version: V.health_data_collection },
    ]);
    assert.equal(current.health_data_collection.granted, false, 'the withdrawal is newer and must win');
  });

  test('a withdrawal followed by a re-grant reads as granted', () => {
    const current = deriveCurrentConsents([
      { consent_type: 'health_data_collection', granted: true, policy_version: V.health_data_collection },
      { consent_type: 'health_data_collection', granted: false, policy_version: V.health_data_collection },
      { consent_type: 'health_data_collection', granted: true, policy_version: V.health_data_collection },
    ]);
    assert.equal(current.health_data_collection.granted, true);
  });

  test('consent types do not leak into one another', () => {
    // The whole point of granular consent: accepting the terms must not imply
    // permission to store injury data.
    const current = deriveCurrentConsents([
      { consent_type: 'terms_of_service', granted: true, policy_version: V.terms_of_service },
    ]);
    assert.equal(current.terms_of_service.granted, true);
    assert.equal(current.health_data_collection.granted, false);
    assert.equal(current.ai_processing.granted, false);
  });

  test('flags consent given against a superseded policy version as stale', () => {
    const current = deriveCurrentConsents([
      { consent_type: 'health_data_collection', granted: true, policy_version: 'chd-2020-01-01' },
    ]);
    assert.equal(current.health_data_collection.granted, true);
    assert.equal(current.health_data_collection.stale, true, 'they agreed to something we have since changed');
  });

  test('a withdrawal is never stale', () => {
    // Stale means "re-ask them". There is nothing to re-ask about a refusal,
    // and prompting someone repeatedly to reconsider a withdrawal is exactly
    // the dark pattern the freely-given requirement exists to prevent.
    const current = deriveCurrentConsents([
      { consent_type: 'health_data_collection', granted: false, policy_version: 'chd-2020-01-01' },
    ]);
    assert.equal(current.health_data_collection.stale, false);
  });

  test('carries the recorded timestamp through for display', () => {
    const current = deriveCurrentConsents([
      {
        consent_type: 'ai_processing',
        granted: true,
        policy_version: V.ai_processing,
        created_at: '2026-08-24T12:00:00Z',
      },
    ]);
    assert.equal(current.ai_processing.recorded_at, '2026-08-24T12:00:00Z');
  });
});
