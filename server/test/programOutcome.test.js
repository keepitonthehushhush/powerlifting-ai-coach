import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';
import { RECORDABLE_PROGRAM_OUTCOMES, recordableProgramOutcome } from '../src/lib/coachOutcome.js';

/**
 * ── THE QUESTION THIS MAKES ANSWERABLE ────────────────────────────────────
 *
 * workout_programs holds rows for exactly one account - the owner's - and has
 * for the life of the product. One athlete sent ten messages, logged a
 * session, and has no program.
 *
 * The route has known why every single time. It computes a one-word outcome
 * for the program block on every reply and writes it to a logger.info, on a
 * platform that keeps runtime logs for about a day. The comment where that
 * word is computed calls it "the thing that says which fix to build".
 */
const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));
const repair = readSource(new URL('../src/lib/programRepair.js', import.meta.url));
const migration = readFileSync(
  new URL('../../supabase/migrations/0075_whether_the_week_reached_the_program_page.sql', import.meta.url),
  'utf8',
);

describe('the outcome is recorded, from a closed set of our own', () => {
  test('a value we recognize is stored as itself', () => {
    for (const outcome of RECORDABLE_PROGRAM_OUTCOMES) {
      assert.equal(recordableProgramOutcome(outcome), outcome);
    }
  });

  test('an unrecognized one becomes other rather than failing the insert', () => {
    /*
     * Every value here is computed by our own code, so 'other' should be
     * unreachable. It exists because the route builds two of these by string
     * concatenation - `repair_${outcome}` - and a new outcome added to
     * programRepair.js would otherwise reach the database as a value the CHECK
     * refuses, turning a new diagnostic into a failed insert on somebody's
     * coaching turn.
     *
     * A row that reads 'other' is a bug report. A swallowed write is not.
     */
    assert.equal(recordableProgramOutcome('repair_something_new'), 'other');
    assert.equal(recordableProgramOutcome('STORABLE'), 'other');
  });

  test('absent stays absent, and null stays null', () => {
    // 'absent' is a real outcome and the commonest one: no block, and no
    // session that wanted one. Null means the reply never reached the point
    // where an outcome is computed. Collapsing them would turn most of this
    // product's traffic into a finding.
    assert.equal(recordableProgramOutcome('absent'), 'absent');
    assert.equal(recordableProgramOutcome(null), null);
    assert.equal(recordableProgramOutcome(undefined), null);
  });

  test('THE CODE AND THE DATABASE AGREE ABOUT THE SET', () => {
    const from = migration.indexOf('usage_events_program_outcome_check', migration.indexOf('add constraint'));
    assert.notEqual(from, -1, 'the constraint is gone - this check did not run');
    const check = migration.slice(from, migration.indexOf(');', from));
    const inDb = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(inDb.length >= 10, `only found ${inDb.length} values in the CHECK - this check did not run`);
    assert.deepEqual(
      [...inDb].sort(),
      [...RECORDABLE_PROGRAM_OUTCOMES, 'other'].sort(),
      'the CHECK and RECORDABLE_PROGRAM_OUTCOMES have drifted apart',
    );
  });

  test('AND THE SET COVERS EVERY OUTCOME THE REPAIR CAN RETURN', () => {
    /*
     * The third list. programRepair.js returns its own vocabulary, the route
     * prefixes it with `repair_`, and this file has to carry the result. A
     * value added there and not here is the exact defect 'other' exists to
     * soften - this is what stops it being needed.
     */
    const returned = new Set([...repair.matchAll(/outcome:\s*'([a-z_]+)'/g)].map((m) => m[1]));
    assert.ok(returned.size >= 4, `only found ${returned.size} repair outcomes - this check did not run`);
    for (const outcome of returned) {
      assert.ok(
        RECORDABLE_PROGRAM_OUTCOMES.includes(`repair_${outcome}`) || outcome === 'repaired',
        `programRepair.js can return '${outcome}' and repair_${outcome} is not a recordable outcome`,
      );
    }
  });

  test('including the one the ROUTE invents rather than the repair', () => {
    // `skipped_slow` is set in the route, not returned by the repair, so the
    // sweep above cannot see it. It is the outcome for a request that had
    // already spent most of the client's timeout before the repair could run.
    assert.match(chatRoute, /repairOutcome = 'skipped_slow'/);
    assert.ok(RECORDABLE_PROGRAM_OUTCOMES.includes('repair_skipped_slow'));
  });
});

describe('the usage row carries it', () => {
  test('mapped rather than raw, beside the stop reason', () => {
    const from = chatRoute.indexOf("from('usage_events').insert({");
    const to = chatRoute.indexOf('});', from);
    assert.notEqual(from, -1, 'the usage write is gone - this check did not run');
    const insert = chatRoute.slice(from, to);
    assert.match(insert, /cost_microdollars/, 'the wrong block was sliced - this check did not run');
    assert.match(insert, /program_outcome: recordableProgramOutcome\(programOutcome\)/);
    assert.ok(
      !/program_outcome: programOutcome/.test(insert),
      'the computed string is being written straight into the table',
    );
  });

  test('and the word still goes to the log as well, not instead', () => {
    // The log line is what somebody reads while a request is in flight. The
    // column is what somebody reads a week later. Neither replaces the other,
    // and removing the log to "avoid duplication" would take away the only
    // one that is live.
    assert.match(chatRoute, /programOutcome,/);
  });
});
