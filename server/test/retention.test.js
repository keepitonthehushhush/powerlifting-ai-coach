import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase, latestDefinition } from './helpers/source.js';
import { POLICY_VERSIONS } from '../src/lib/policyVersions.js';

/**
 * ── WHY RETENTION IS TIERED AND NOT ONE TTL ────────────────────────────────
 *
 * "Delete everything older than N" is the obvious design and it is wrong,
 * because the categories are not alike:
 *
 *   - A three-year training log is the ATHLETE'S ASSET. Deleting it because
 *     somebody took a year off destroys what the product exists to build.
 *   - A stale injury is a LIABILITY. "Torn rotator cuff" from two years ago
 *     still shaping programming is bad coaching before it is a privacy
 *     problem.
 *   - Old chat is NEITHER: past the replay window nothing reads it, and it is
 *     where people mention injuries, weight and home life.
 *
 * The tests below are mostly about the traps, not the periods.
 */

const migration = readRaw(new URL('../../supabase/migrations/0031_retention.sql', import.meta.url));

/**
 * The sweep AS IT STANDS, not as 0031 wrote it.
 *
 * Reading 0031 for the sweep's behaviour was a mistake this file made for a
 * week. Migration files are append-only: 0033 and 0034 both replaced
 * apply_retention() in full, and nothing they did could have made an assertion
 * about 0031's text fail. The most important assertion in this file - that the
 * sweep never touches training logs - was being made against a definition that
 * had been superseded twice.
 *
 * 0031 is still read below for its REASONING, which is where the reasoning
 * lives and where it cannot move.
 */
const sweep = latestDefinition('function private.apply_retention').body;
const policy = readSource(new URL('../../web/src/pages/HealthDataPolicy.jsx', import.meta.url));
const invariants = readRaw(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));

describe('what is never swept', () => {
  test('TRAINING LOGS ARE NOT TOUCHED BY ANY SWEEP', () => {
    // The single most important assertion in this file. progress_logs must not
    // appear in a delete or update inside apply_retention().
    assert.ok(!/delete from public\.progress_logs/.test(sweep), 'the sweep deletes training logs');
    assert.ok(!/update public\.progress_logs/.test(sweep), 'the sweep modifies training logs');
    assert.ok(!/workout_sessions|workout_programs/.test(sweep), 'the sweep touches sessions or programmes');
  });

  test('and the policy says so in those words', () => {
    assert.match(policy, phrase('Your logged training is never deleted automatically'));
    assert.match(policy, phrase('a year away from the gym'));
  });

  test('consent records are not swept either', () => {
    // They are the evidence that consent was obtained; deleting them on a
    // timer would undo 0028's whole argument.
    assert.ok(!/delete from public\.consent_records/.test(sweep));
  });
});

describe('THE TIMESTAMP TRAP', () => {
  test('health_restrictions gets its OWN timestamp, not user_profile.updated_at', () => {
    // updated_at moves when any field changes, so expiring on it would let
    // changing a bodyweight reset the injury clock - a restriction outliving
    // its period while appearing to be swept.
    assert.match(migration, /add column if not exists health_restrictions_updated_at timestamptz/);
    assert.match(migration, phrase('would reset the injury clock'));
  });

  test('the trigger moves it only when the field itself changes', () => {
    assert.match(migration, /new\.health_restrictions is distinct from old\.health_restrictions/);
    // `is distinct from`, not `<>`: null-to-value and value-to-null are both
    // changes and `<>` is null for either.
    assert.match(migration, phrase('both changes, and `<>` is null for either'));
  });

  test('and clearing the field clears its timestamp too', () => {
    assert.match(migration, /health_restrictions_updated_at :=\s*case when new\.health_restrictions is null then null/);
  });
});

describe('expiry must not quietly make the coaching less safe', () => {
  test('CLEARANCE IS RESET IN THE SAME STATEMENT AS THE INJURY', () => {
    // Clearing an injury alone would leave somebody looking unrestricted to a
    // coach that had been working around something. One statement, so there is
    // no window where they are cleared and unrestricted.
    const stmt = sweep
      .slice(sweep.indexOf('update public.user_profile\n     set health_restrictions = null'))
      .slice(0, 600);

    /*
     * `false`, and this assertion used to demand `null`.
     *
     * cleared_to_train has been `boolean not null default false` since 0001,
     * so the sweep could never have run: the first row to age past the health
     * retention period would raise 23502 and abort every other category with
     * it - conversations, audit, usage, Stripe and error events included.
     * Reproduced against the preview database, then fixed in 0035.
     *
     * plpgsql does not plan a statement until it executes, which is why the
     * function created cleanly and the nightly job reported success for as
     * long as it had nothing to do. The test asserted the bug, and reading
     * frozen file 0031 meant it would have gone on asserting it forever.
     *
     * `false` is what 0031 meant anyway: an athlete whose injury has expired
     * is "treated exactly as somebody who has not answered yet", and that
     * person's row says false.
     */
    assert.match(stmt, /cleared_to_train = false/);
    assert.doesNotMatch(stmt, /cleared_to_train = null/);
  });

  test('and nothing records that a restriction ever existed', () => {
    // A column saying "this person once had a health restriction" is an
    // inference about health - the thing being deleted.
    assert.ok(!/health_restrictions_expired|had_restrictions|restriction_history/i.test(migration));
    assert.match(migration, phrase('would be an inference about health'));
  });
});

describe('undateable chat messages', () => {
  test('are judged by the conversation, not deleted for being undateable', () => {
    // Messages written before `at` existed cannot be dated individually.
    // Deleting something because its date is unknown is the wrong default for
    // somebody's own record.
    assert.match(migration, /not \(msg \? 'at'\) and c\.created_at >= now\(\)/);
    assert.match(migration, phrase('deleting something because its date is unknown is the wrong default'));
  });
});

describe('the destructive one is built and not switched on', () => {
  test('DELETE_INACTIVE_ACCOUNTS IS DRY RUN BY DEFAULT', () => {
    // A destructive function whose default is to destroy is one keystroke from
    // a very bad afternoon.
    assert.match(migration, /p_dry_run boolean default true/);
  });

  test('it is never added to the cron schedule', () => {
    const schedule = migration.slice(migration.indexOf('cron.schedule'));
    assert.ok(!/delete_inactive_accounts/.test(schedule), 'the account deletion job is scheduled');
    assert.match(invariants, /AND ACCOUNT DELETION IS NOT/);
  });

  test('and the reason is the missing mailbox, written down', () => {
    assert.match(migration, phrase('there is no way to warn anybody first'));
    assert.match(migration, phrase('is hostile even where it is lawful'));
  });

  test('"inactive" uses every signal, not just last sign-in', () => {
    // A session that refreshes silently, or a device that stays signed in, is
    // not inactivity. Erring towards keeping is correct for something
    // irreversible.
    assert.match(migration, /greatest\(/);
    assert.match(migration, /max\(p\.created_at\) from public\.progress_logs/);
    assert.match(migration, phrase('a definition that missed that would delete active users'));
  });
});

describe('the periods in the policy and the periods in the database agree', () => {
  /**
   * The check where the fact lives. A privacy policy stating one number while
   * the sweep uses another is the documentation-drift failure this codebase
   * keeps building checks for - except this one is a published commitment
   * about health data.
   */
  const seeded = Object.fromEntries(
    [...migration.matchAll(/\('([a-z_]+)',\s*(\d+),/g)].map((m) => [m[1], Number(m[2])]),
  );

  test('every seeded period is a number the policy states', () => {
    assert.equal(seeded.health_restrictions, 12);
    assert.equal(seeded.conversation_messages, 12);
    assert.equal(seeded.audit_events, 24);
    assert.equal(seeded.usage_events, 24);
    assert.match(policy, /Injury and medical notes: 12 months/);
    assert.match(policy, /Conversation messages: 12 months/);
    assert.match(policy, /Account activity records: 24 months/);
    assert.match(policy, /Usage and cost records: 24 months/);
  });

  test('the periods live in a table, not as numbers buried in a function', () => {
    assert.match(migration, /create table if not exists public\.retention_periods/);
    assert.match(migration, /select rp\.months from public\.retention_periods rp/);
  });

  test('and the ambiguity that only running it revealed stays fixed', () => {
    // The OUT parameter is also called `category`; plpgsql resolves an
    // unqualified name to the variable, so the lookup raised 42702 and did
    // nothing. A test reading the file could not have found this.
    //
    // Scoped to the DECLARE block rather than the file: the comment above the
    // fix necessarily contains the broken form while explaining it, and an
    // absence assertion over the whole file matches the explanation of why the
    // thing is absent. That collision has now cost this suite four times.
    const declare = migration.slice(
      migration.indexOf('m_health int :='),
      migration.indexOf('n bigint;'),
    );
    assert.equal(
      (declare.match(/from public\.retention_periods rp where rp\.category/g) ?? []).length, 5,
      'not every period lookup is aliased - an unqualified `category` resolves to the OUT parameter',
    );
    assert.ok(!/where category = '/.test(declare), 'an unqualified category lookup is back');
    assert.match(migration, phrase('Found by running it'));
  });
});

describe('the policy version moved, so people are asked again', () => {
  test('retention is a term somebody consents to', () => {
    assert.match(POLICY_VERSIONS.health_data_collection, /^chd-2026-08-28[a-z]$/);
    assert.ok(policy.includes(POLICY_VERSIONS.health_data_collection));
    assert.match(policy, phrase('we are asking you to agree again'));
  });

  test('and the database was updated to match', () => {
    // The version moves whenever the document changes; this asserts the
    // migration bumps it, not which letter it landed on.
    assert.match(migration, /set version = 'chd-2026-08-28[a-z]'/);
  });
});

describe('the sweep runs whether or not anybody visits', () => {
  test('it is scheduled in the database, and an invariant checks it', () => {
    // A retention policy that is written down and never runs is worse than
    // none: the policy states periods the database does not honour.
    assert.match(migration, /cron\.schedule\('apply-retention'/);
    assert.match(invariants, /THE RETENTION SWEEP IS ACTUALLY SCHEDULED/);
  });
});
