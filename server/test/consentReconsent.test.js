import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { POLICY_VERSIONS, CONSENT_TYPES } from '../src/lib/policyVersions.js';

/**
 * ── RE-CONSENT ─────────────────────────────────────────────────────────────
 *
 * When a policy changes, people are asked again. Three things have to be true
 * for that ask to mean anything, and none of them were:
 *
 *   1. The box has to be EMPTY. It rendered ticked, because the stored record
 *      still said granted=true - so the screen put a pre-ticked checkbox in
 *      front of somebody and would have called the result consent. The CJEU
 *      settled that in Planet49 (C-673/17): a pre-ticked box is not consent
 *      under the GDPR. It was also simply broken as an interaction - a ticked
 *      box left nothing to click, and clicking it could only have sent a
 *      WITHDRAWAL, so re-consent was unreachable through its own control.
 *
 *   2. They have to be told WHY. "Please review and confirm again" is
 *      homework. What changed, what they agreed to, and when is information.
 *
 *   3. The database has to agree with the screen. has_active_consent()
 *      ignored policy_version, so a superseded agreement went on authorizing
 *      health-data writes while the panel showed an empty box.
 */

const panel = readSource(new URL('../../web/src/components/ConsentPanel.jsx', import.meta.url));
const panelRaw = readRaw(new URL('../../web/src/components/ConsentPanel.jsx', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const migration = readRaw(new URL('../../supabase/migrations/0027_consent_must_be_current.sql', import.meta.url));
const invariants = readRaw(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));

describe('a stale consent is presented as unanswered', () => {
  test('THE CHECKBOX IS UNCHECKED WHEN THE VERSION IS STALE', () => {
    assert.match(panel, /checked=\{Boolean\(state\?\.granted\) && !state\?\.stale\}/);
  });

  test('the reasoning names the case law rather than asserting a rule', () => {
    assert.match(panelRaw, phrase('a pre-ticked box is not valid consent under the GDPR'));
    assert.match(panelRaw, /Planet49 \(C-673\/17\)/);
  });

  test('and names the interaction failure too, which is the part a redesign would lose', () => {
    assert.match(panelRaw, phrase('the only thing it could send is a WITHDRAWAL'));
  });

  test('the "recorded on" line does not appear beside an empty box', () => {
    // An empty checkbox above "recorded on the 3rd" is the screen
    // contradicting itself.
    assert.match(panel, /state\?\.granted && !state\.stale && state\.recorded_at/);
  });
});

describe('they are told why they are seeing it again', () => {
  test('IN SPECIFICS: what they agreed to, when, and what it is now', () => {
    assert.match(panel, /staleExplained/);
    assert.match(panel, /oldVersion: state\.policy_version/);
    assert.match(panel, /newVersion: consents\.current_versions/);
  });

  test('the copy says the old agreement is kept, not deleted', () => {
    // People assume being asked again means something was lost. The ledger is
    // append-only; say so.
    assert.match(en, phrase('it stays in your consent history'));
  });

  test('and says plainly that leaving it empty is allowed', () => {
    // A re-ask that reads as compulsory is not a free choice.
    assert.match(en, phrase('leaving it empty is a valid answer'));
    assert.match(en, phrase('The box above is empty on purpose'));
  });

  test('the generic message survives for a record with no date to quote', () => {
    assert.match(panel, /: t\('consent\.staleVersion'\)/);
  });
});

describe('the database agrees with the screen', () => {
  test('HAS_ACTIVE_CONSENT NOW REQUIRES THE CURRENT VERSION', () => {
    assert.match(migration, /c\.policy_version = \(/);
    assert.match(migration, /from public\.policy_versions v/);
  });

  test('and still orders by seq, because 0010 fixed that and 0027 rewrites it', () => {
    // now() is transaction start time: a grant and a withdrawal in one
    // transaction share a created_at and sort arbitrarily.
    assert.match(migration, /order by c\.seq desc/);
    assert.ok(!/order by c?\.?created_at/.test(migration));
  });

  test('it fails closed when there is no row for that policy', () => {
    assert.match(migration, /coalesce\(/);
    assert.match(migration, phrase('Fails CLOSED'));
  });

  test('EVERY CONSENT TYPE IS SEEDED AT THE VERSION JAVASCRIPT USES', () => {
    // The drift this codebase has been bitten by twice. A version bumped in
    // policyVersions.js and not seeded would leave the database gate open on a
    // policy nobody has agreed to.
    //
    // Scanned across ALL migrations rather than one, because a consent type
    // added later is seeded by the migration that adds it - 0028 introduced
    // leaderboard_publication, and pinning this to 0027 made a correct change
    // look like a regression.
    const allMigrations = readdirSync(new URL('../../supabase/migrations/', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readRaw(new URL(`../../supabase/migrations/${f}`, import.meta.url)))
      .join('\n');

    for (const type of CONSENT_TYPES) {
      const version = POLICY_VERSIONS[type];
      /**
       * Two shapes, because a version arrives two ways: seeded with the type
       * when the consent is introduced, and later BUMPED by an update when the
       * document changes. The first version of this test only understood the
       * insert form, so bumping the health policy in 0031 failed it - a
       * correct change, flagged as a regression.
       */
      const seeded = new RegExp(`'${type}'\\s*,\\s*'${version}'`).test(allMigrations);
      const bumped = new RegExp(
        `set version = '${version}'[\\s\\S]{0,200}?consent_type = '${type}'`,
      ).test(allMigrations);
      assert.ok(
        seeded || bumped,
        `no migration seeds or bumps public.policy_versions to ${version} for ${type}`,
      );
    }
  });

  test('and the consent_type CHECK constraint knows every type', () => {
    // The constraint enumerates them, so a type added in JavaScript alone
    // fails at INSERT with a constraint violation the user sees as a 502.
    const constraint = readRaw(new URL('../../supabase/migrations/0028_leaderboard_consent.sql', import.meta.url));
    for (const type of CONSENT_TYPES) {
      assert.ok(constraint.includes(`'${type}'`), `the CHECK constraint omits ${type}`);
    }
  });

  test('and an invariant checks it against the deployed database, not the file', () => {
    assert.match(invariants, /HAS_ACTIVE_CONSENT REQUIRES THE CURRENT POLICY VERSION/);
    assert.match(invariants, /still orders by seq, not created_at/);
  });

  test('the policy_versions table is readable but not writable by users', () => {
    assert.match(migration, /grant select on public\.policy_versions to authenticated;/);
    assert.ok(!/grant[^;]*\b(insert|update|delete)\b[^;]*policy_versions[^;]*authenticated/i.test(migration));
    assert.match(migration, /revoke all on public\.policy_versions from anon;/);
  });
});
