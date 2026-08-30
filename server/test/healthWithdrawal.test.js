import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { readSource, readRaw, phrase, latestDefinition } from './helpers/source.js';
import { redact } from '../src/lib/logger.js';

/**
 * Withdrawing health-data consent must actually erase the health data.
 *
 * ── THE BUG THIS FILE EXISTS FOR ──────────────────────────────────────────
 *
 * The consumer health data policy says, in as many words: "Withdrawing consent
 * for health data collection also erases the health information already
 * stored." For every athlete who had answered the gender question or the GLP-1
 * question, that was false, and the failure was total rather than partial.
 *
 * private.require_health_data_consent() permits a write when the new row's
 * fingerprint is NULL - "everything cleared" - or identical to the old one -
 * "nothing about health changed". The withdrawal path cleared six columns and
 * left three, so the new fingerprint was neither: it still read `nonbinary` or
 * `using`. The trigger correctly classified that as storing health data,
 * correctly found no active consent - it had just been withdrawn - and refused
 * the statement. One UPDATE, so the other columns rolled back with it. The
 * ledger recorded the withdrawal, the injury note stayed on the profile, and
 * the athlete was told to contact support.
 *
 * Reproduced against the preview database, then fixed, then re-run:
 *
 *   before   1. withdrawal recorded on the ledger  OK - consent reads WITHDRAWN
 *            2. erasure of stored health data      FAILED: health data cannot
 *                                                  be stored without active
 *                                                  health_data_collection consent
 *            3. still stored afterwards            gender=nonbinary,
 *                                                  glp1_status=using,
 *                                                  health_restrictions=left
 *                                                  shoulder impingement, sleep=6.0
 *
 *   after    erasure succeeds, residue: gender=null, self_described=null,
 *            glp1=null, injury=(empty)
 *
 * ── WHY THE EXPECTATION IS DERIVED AND NOT LISTED ─────────────────────────
 *
 * Because a listed one would have passed. Migration 0024 added gender and
 * migration 0033 added glp1_status; both were added to the fingerprint, and
 * the withdrawal path was not touched either time. A test naming the six
 * columns that were cleared would have agreed with the code for four months.
 *
 * So the expected set is read out of the migrations - every user_profile column
 * whose own COMMENT declares it health data - and out of the live fingerprint
 * definition. Adding a health column now breaks this test until the withdrawal
 * path learns about it, which is the only arrangement that survives the next
 * person who is not thinking about consent while adding a field.
 */

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

/** Every user_profile column the schema itself documents as health data. */
function documentedHealthColumns() {
  const sql = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(new URL(name, MIGRATIONS), 'utf8'))
    .join('\n');

  const columns = new Set();
  const declaration = /comment\s+on\s+column\s+public\.user_profile\.(\w+)\s+is\s+'((?:[^']|'')*)'/gi;
  for (const [, column, comment] of sql.matchAll(declaration)) {
    if (/^\s*health data[.:]/i.test(comment)) columns.add(column);
  }
  return columns;
}

/** The columns the withdrawal path in the consent route actually writes. */
function clearedOnWithdrawal() {
  const source = readSource(new URL('../src/routes/consent.js', import.meta.url));

  const table = source.indexOf(".from('user_profile')");
  assert.notEqual(table, -1, 'the consent route no longer updates user_profile on withdrawal');
  const open = source.indexOf('.update({', table);
  const close = source.indexOf('})', open);
  assert.ok(open !== -1 && close > open, 'could not read the withdrawal update');

  const body = source.slice(open, close);
  return {
    body,
    columns: new Set([...body.matchAll(/^\s*(\w+):/gm)].map(([, name]) => name)),
  };
}

test('withdrawing health-data consent', async (t) => {
  const documented = documentedHealthColumns();
  const { body, columns: cleared } = clearedOnWithdrawal();

  await t.test('the schema still documents which columns are health data', () => {
    // If this ever empties, every assertion below passes vacuously.
    assert.ok(documented.size >= 7, `only ${documented.size} health columns found`);
    for (const expected of ['gender', 'gender_self_described', 'glp1_status', 'nutrition_notes']) {
      assert.ok(documented.has(expected), `${expected} is no longer documented as health data`);
    }
  });

  await t.test('every documented health column is cleared', () => {
    const missing = [...documented].filter((column) => !cleared.has(column)).sort();
    assert.deepEqual(
      missing,
      [],
      `withdrawal leaves health data behind: ${missing.join(', ')}. ` +
        'A partial clear is not a partial erasure - the consent trigger rejects the ' +
        'whole UPDATE, so nothing is erased at all. See the header of this file.'
    );
  });

  await t.test('and the clear is a superset of the consent fingerprint', () => {
    // The trigger's own definition of health data. Read live rather than from
    // the migration that happened to define it when this was written, because
    // a migrations directory is append-only and an old file cannot fail.
    const { body: fingerprint } = latestDefinition('function private.health_fingerprint');
    const referenced = [...fingerprint.matchAll(/\bp\.(\w+)/g)].map(([, name]) => name);
    assert.ok(referenced.length > 0, 'could not read the fingerprint columns');

    const missing = [...new Set(referenced)].filter((column) => !cleared.has(column)).sort();
    assert.deepEqual(
      missing,
      [],
      `the fingerprint reads ${missing.join(', ')}, which withdrawal does not clear, ` +
        'so the cleared row still fingerprints non-null and the trigger refuses it'
    );
  });

  await t.test('cleared_to_train is set false, never null', () => {
    // NOT NULL since migration 0001. apply_retention() set it to null and the
    // sweep would have aborted on the first row old enough to matter; see 0035.
    assert.match(body, /cleared_to_train:\s*false/);
    assert.doesNotMatch(body, /cleared_to_train:\s*null/);
  });

  await t.test('pronouns are not touched, deliberately', () => {
    // Being addressed correctly must not be something a person trades privacy
    // for. Pinned here so a future broad fix cannot quietly take it away.
    assert.ok(!documented.has('pronouns'), 'pronouns must not be documented as health data');
    assert.ok(!cleared.has('pronouns'), 'withdrawal must not erase how to address somebody');
  });
});

test('the state the bug left behind is reconciled and then watched', async (t) => {
  const reconciliation = readRaw(
    new URL('../../supabase/migrations/0040_reconcile_withdrawals_that_erased_nothing.sql',
      import.meta.url)
  );
  const invariants = readRaw(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));

  await t.test('the one-time clear covers every documented health column', () => {
    // Same derivation as the withdrawal path above, for the same reason: a
    // reconciliation that misses a column leaves exactly the state it exists
    // to remove, and the trigger would refuse this UPDATE too if it ran as a
    // user rather than as a migration.
    const missing = [...documentedHealthColumns()]
      .filter((column) => !new RegExp(`\\b${column}\\s*=`).test(reconciliation))
      .sort();
    assert.deepEqual(missing, [], `0040 does not clear: ${missing.join(', ')}`);
  });

  await t.test('and it is idempotent, so a re-run moves nobody', () => {
    // Scoped to rows that still hold something. Without this, every deploy
    // rewrites clean rows and updated_at drifts for people nothing happened to.
    assert.match(reconciliation, /is not null\s*\)?\s*;?\s*$/m);
    assert.match(reconciliation, /or p\.glp1_status is not null/);
  });

  await t.test('the property becomes a standing check, not a one-off', () => {
    assert.match(invariants, /A WITHDRAWN HEALTH CONSENT MEANS NO HEALTH DATA IS STILL STORED/);
    assert.match(invariants, /private\.health_fingerprint\(p\) is not null/);
  });

  await t.test('and the migration says what it found, rather than implying a repair', () => {
    // It found nothing: production had four profiles and no withdrawals at all.
    // A cleanup migration that reads as though it rescued somebody is a worse
    // artifact than one that records the count it actually saw.
    assert.match(reconciliation, phrase('Nothing, and that is written down rather than implied'));
  });
});

test('health data cannot reach a log line', async (t) => {
  const documented = documentedHealthColumns();

  await t.test('every documented health column is redacted', () => {
    // Run the redactor rather than reading its key list: the list matches on
    // substrings, so whether a column is covered is a property of the function
    // and not of the array. `gender` was in neither for four months.
    const payload = Object.fromEntries([...documented].map((column) => [column, 'SENSITIVE']));
    const logged = redact(payload);

    const leaked = Object.entries(logged)
      .filter(([, value]) => value === 'SENSITIVE')
      .map(([column]) => column)
      .sort();

    assert.deepEqual(
      leaked,
      [],
      `these health columns are written to logs in the clear: ${leaked.join(', ')}`
    );
  });

  await t.test('pronouns still are not', () => {
    assert.equal(redact({ pronouns: 'they/them' }).pronouns, 'they/them');
  });
});
