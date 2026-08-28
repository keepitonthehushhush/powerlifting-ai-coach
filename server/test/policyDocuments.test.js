import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONSENT_TYPES, REQUIRED_CONSENTS, POLICY_VERSIONS } from '../src/lib/policyVersions.js';
import { POLICY_DOCUMENTS, policyPathFor } from '../../web/src/lib/policyDocuments.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../web/src/App.jsx');
const panel = read('../../web/src/components/ConsentPanel.jsx');
const en = read('../../web/src/i18n/locales/en.js');

/**
 * The defect these tests exist to prevent shipped for weeks: terms_of_service
 * was a REQUIRED consent with no document anywhere in the application. Users
 * checked a box agreeing to terms they could not read, and the ledger recorded
 * them as having agreed to version tos-2026-08-24 — a version string for
 * nothing. A consent record whose subject does not exist proves only that
 * someone clicked something.
 *
 * These assertions are structural on purpose. Nobody will remember this rule
 * in six months; the build will.
 */
describe('every consent has something to read', () => {
  test('each consent type maps to a policy document', () => {
    for (const type of CONSENT_TYPES) {
      assert.ok(
        policyPathFor(type),
        `consent type "${type}" has no document - users would be agreeing to nothing`,
      );
    }
  });

  test('each mapped document is a real route', () => {
    for (const [type, path] of Object.entries(POLICY_DOCUMENTS)) {
      assert.ok(
        app.includes(`path="${path}"`),
        `${type} points at ${path}, which is not routed in App.jsx`,
      );
    }
  });

  test('every routed policy document actually exists as a page', () => {
    // A route pointing at a component that was never written fails at runtime,
    // which is exactly when the person is trying to read it.
    for (const component of ['Terms', 'AiProcessing', 'HealthDataPolicy', 'LeaderboardPolicy']) {
      assert.ok(
        app.includes(`import { ${component} }`),
        `${component} is routed but not imported`,
      );
      assert.doesNotThrow(
        () => read(`../../web/src/pages/${component}.jsx`),
        `${component}.jsx does not exist`,
      );
    }
  });

  test('the document carries the same version the ledger records', () => {
    // Recording agreement to tos-2026-08-24 while showing a document headed
    // with some other version is worse than showing nothing: it looks correct.
    const pages = {
      terms_of_service: read('../../web/src/pages/Terms.jsx'),
      ai_processing: read('../../web/src/pages/AiProcessing.jsx'),
      health_data_collection: read('../../web/src/pages/HealthDataPolicy.jsx'),
      leaderboard_publication: read('../../web/src/pages/LeaderboardPolicy.jsx'),
    };
    // A consent type with no page in this map used to fail as "cannot read
    // properties of undefined", which names the test's own gap rather than the
    // missing document. Say what is actually wrong.
    for (const type of Object.keys(POLICY_VERSIONS)) {
      assert.ok(pages[type], `${type} has no page listed in this test - write the document, then list it here`);
    }
    for (const [type, version] of Object.entries(POLICY_VERSIONS)) {
      assert.ok(
        pages[type].includes(version),
        `the ${type} page does not state version ${version}, which is what gets recorded`,
      );
    }
  });

  test('the required consents are the ones with the strongest need for a document', () => {
    for (const type of REQUIRED_CONSENTS) {
      assert.ok(policyPathFor(type), `required consent "${type}" has no document`);
    }
  });
});

describe('the document is offered before the checkbox', () => {
  test('the panel links to each consent type own document', () => {
    assert.match(panel, /policyPathFor\(type\)/);
    assert.match(panel, /readBeforeAgreeing/);
  });

  test('the link renders above the control, not below it', () => {
    // A link placed after the thing people are reaching for is a link most of
    // them never see. Position is the whole point of the fix.
    const linkAt = panel.indexOf('readBeforeAgreeing');
    const checkboxAt = panel.indexOf('type="checkbox"');
    assert.ok(linkAt !== -1 && checkboxAt !== -1);
    assert.ok(
      linkAt < checkboxAt,
      'the policy link must render before the checkbox it belongs to',
    );
  });

  test('every consent type has a readable document name to put in the link', () => {
    for (const type of CONSENT_TYPES) {
      assert.match(
        en,
        new RegExp(`${type}:\\s*\\{[^}]*document:`, 's'),
        `consent.${type}.document is missing, so the link would have no name`,
      );
    }
  });
});

describe('the policies are readable without an account', () => {
  test('no policy route sits behind ProtectedRoute', () => {
    // Someone deciding whether to sign up is exactly the person who most needs
    // to read these, and they do not have an account yet.
    for (const path of Object.values(POLICY_DOCUMENTS)) {
      const at = app.indexOf(`path="${path}"`);
      const line = app.slice(at, app.indexOf('/>', at) + 2);
      assert.doesNotMatch(line, /ProtectedRoute/, `${path} requires sign-in to read`);
    }
  });
});

describe('the drafts say they are drafts', () => {
  test('each policy page carries the pending-review banner', () => {
    // These were written by an engineer, not a lawyer. Saying so on the page is
    // the difference between an honest placeholder and a false assurance.
    for (const component of ['Terms', 'AiProcessing', 'HealthDataPolicy']) {
      assert.match(
        read(`../../web/src/pages/${component}.jsx`),
        /pending legal review/i,
        `${component} does not disclose that it has not been reviewed`,
      );
    }
  });
});
