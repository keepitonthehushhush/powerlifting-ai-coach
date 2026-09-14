import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';
import { firstWeekSteps, firstWeekComplete, MAX_STEPS, STEP_IDS } from '../src/lib/onboarding.js';

/**
 * ── WHY THIS FEATURE EXISTS ───────────────────────────────────────────────
 *
 * The funnel on 2026-09-14, seven accounts, five of them real people rather
 * than the owner's two: two never finished the intake form, one finished it
 * and sent nothing and never came back, and two talked to the coach and have
 * no program. Three different places to stop; the openers address one of them.
 *
 * The panel this module feeds is the only thing in the product that says what
 * the week is supposed to look like and where the output comes out.
 */

/** Facts with nothing done yet, so each test can set exactly one thing. */
const NOTHING = {
  intakeComplete: false,
  hasSentMessage: false,
  hasProgram: false,
  hasSession: false,
  awaitingClearance: false,
};

const idsOf = (steps) => steps.map((s) => s.id);
const doneOf = (steps, id) => steps.find((s) => s.id === id)?.done;

describe('the ordinary first week', () => {
  test('is the four stages in the order they happen', () => {
    assert.deepEqual(idsOf(firstWeekSteps(NOTHING)), [
      'profile',
      'firstMessage',
      'program',
      'logSession',
    ]);
  });

  test('is never longer than MAX_STEPS', () => {
    // Every combination, not a sample: the cap is worth nothing if some
    // branch nobody thought about returns five.
    for (let mask = 0; mask < 32; mask += 1) {
      const steps = firstWeekSteps({
        intakeComplete: Boolean(mask & 1),
        hasSentMessage: Boolean(mask & 2),
        hasProgram: Boolean(mask & 4),
        hasSession: Boolean(mask & 8),
        awaitingClearance: Boolean(mask & 16),
      });
      assert.ok(steps.length <= MAX_STEPS, `mask ${mask} returned ${steps.length} steps`);
      assert.ok(steps.length > 0, `mask ${mask} returned nothing to render`);
    }
  });

  test('starts with everything undone when the account is new', () => {
    assert.deepEqual(
      firstWeekSteps(NOTHING).map((s) => s.done),
      [false, false, false, false],
    );
  });

  test('called with no argument at all does not throw', () => {
    // The route derives these from four reads. A read that comes back empty
    // must produce an undone list, not a crash on the page somebody is
    // looking at for the first time.
    assert.deepEqual(idsOf(firstWeekSteps()), ['profile', 'firstMessage', 'program', 'logSession']);
  });
});

describe('each tick comes from its own fact and no other', () => {
  /*
   * One test per stage, each setting exactly one fact. Written this way on
   * purpose: a single test that sets all four and asserts all four passes
   * just as happily when the function ignores its arguments and returns a
   * constant, which is the defect this file exists to catch.
   */
  const cases = [
    ['profile', 'intakeComplete'],
    ['firstMessage', 'hasSentMessage'],
    ['program', 'hasProgram'],
    ['logSession', 'hasSession'],
  ];

  for (const [id, fact] of cases) {
    test(`${id} is done when ${fact} is true, and only then`, () => {
      const off = firstWeekSteps(NOTHING);
      assert.equal(doneOf(off, id), false, `${id} was done before ${fact} was set`);

      const on = firstWeekSteps({ ...NOTHING, [fact]: true });
      assert.equal(doneOf(on, id), true, `${fact} did not tick ${id}`);

      // And it ticked nothing else. A step marked done by somebody else's
      // fact is a false claim about this athlete's account.
      for (const [otherId] of cases) {
        if (otherId === id) continue;
        assert.equal(doneOf(on, otherId), false, `${fact} also ticked ${otherId}`);
      }
    });
  }
});

describe('an athlete waiting on medical clearance', () => {
  const gated = { ...NOTHING, awaitingClearance: true };

  test('is never offered the program step', () => {
    assert.ok(!idsOf(firstWeekSteps(gated)).includes('program'));
  });

  test('is not offered it even if a program row somehow exists', () => {
    // The gate is re-checked here rather than inferred from the absence of a
    // row, for the reason the chat route gives about its own copy of this
    // gate: a guard that depends on another guard having been correct is not
    // a second line of defense.
    const steps = firstWeekSteps({ ...gated, hasProgram: true, hasSession: true });
    assert.ok(!idsOf(steps).includes('program'));
    assert.ok(!idsOf(steps).includes('logSession'));
  });

  test('gets the profile step and the conversation that is actually available', () => {
    assert.deepEqual(idsOf(firstWeekSteps(gated)), ['profile', 'clearanceAsk']);
  });

  test('can finish the list, because every step it contains is derived', () => {
    // The first draft gave them a third step - the library - whose `done`
    // could only ever be the literal false. That list could never complete,
    // so the panel could never stop rendering. This is that regression.
    const finished = firstWeekSteps({
      ...gated,
      intakeComplete: true,
      hasSentMessage: true,
    });
    assert.equal(firstWeekComplete(finished), true);
  });

  test('no step in any branch carries a hardcoded done', () => {
    /*
     * The rule, asserted rather than trusted: for every step id this module
     * can emit, there is SOME set of facts that makes it done. An id that is
     * false under all thirty-two combinations is a checkbox pretending to be
     * a fact, and it silently makes the list uncompletable.
     */
    const everDone = new Set();
    for (let mask = 0; mask < 32; mask += 1) {
      const steps = firstWeekSteps({
        intakeComplete: Boolean(mask & 1),
        hasSentMessage: Boolean(mask & 2),
        hasProgram: Boolean(mask & 4),
        hasSession: Boolean(mask & 8),
        awaitingClearance: Boolean(mask & 16),
      });
      for (const step of steps) if (step.done) everDone.add(step.id);
    }
    for (const id of STEP_IDS) {
      assert.ok(everDone.has(id), `${id} is never done for any input - it cannot be a step`);
    }
  });
});

describe('firstWeekComplete', () => {
  test('is true only when every step is done', () => {
    const all = firstWeekSteps({
      intakeComplete: true,
      hasSentMessage: true,
      hasProgram: true,
      hasSession: true,
    });
    assert.equal(firstWeekComplete(all), true);
  });

  test('is false while any step is outstanding', () => {
    const nearly = firstWeekSteps({
      intakeComplete: true,
      hasSentMessage: true,
      hasProgram: true,
      hasSession: false,
    });
    assert.equal(firstWeekComplete(nearly), false);
  });

  test('is false for an empty list, not true', () => {
    /*
     * `[].every()` is true, and the route uses this to stamp a WRITE-ONCE
     * column. An empty list means the derivation was skipped or a read
     * failed - recording that as "they finished their first week" is a write
     * that cannot be taken back, on the strength of a question nobody
     * answered.
     */
    assert.equal(firstWeekComplete([]), false);
  });

  test('is false for anything that is not a list of steps', () => {
    assert.equal(firstWeekComplete(null), false);
    assert.equal(firstWeekComplete(undefined), false);
  });

  test('does not accept a truthy value in place of done', () => {
    // `done` crosses the wire as JSON and comes back as a boolean or not at
    // all. A loose check here would let a string through as completion.
    assert.equal(firstWeekComplete([{ id: 'profile', done: 'yes' }]), false);
  });
});

describe('the copy exists in both languages', () => {
  /*
   * A missing key renders as `onboarding.steps.program` on an athlete's first
   * screen. This is the only check that can catch it, because nothing else in
   * the repository enumerates these ids.
   *
   * It reads the CATALOGS, not the file text. A regex over en.js finds
   * `profile:` in the nav block and reports success for a key that does not
   * exist under `onboarding.steps` - this repository has shipped that kind of
   * test three times, and each one agreed with anything.
   */
  for (const id of STEP_IDS) {
    test(`${id} has English copy`, () => {
      const step = en.onboarding?.steps?.[id];
      assert.ok(step, `onboarding.steps.${id} is missing from en.js`);
      assert.equal(typeof step.title, 'string');
      assert.ok(step.title.length > 0, `onboarding.steps.${id}.title is empty in en.js`);
    });

    test(`${id} has Spanish copy`, () => {
      const step = es.onboarding?.steps?.[id];
      assert.ok(step, `onboarding.steps.${id} is missing from es.js`);
      assert.equal(typeof step.title, 'string');
      assert.ok(step.title.length > 0, `onboarding.steps.${id}.title is empty in es.js`);
    });

    test(`${id} says the same things in both`, () => {
      // Not a translation check - a SHAPE check. A step that has a `go` link
      // in English and not in Spanish renders a dead end for half the users,
      // and the missing half is the half nobody on this project reads first.
      assert.deepEqual(
        Object.keys(es.onboarding.steps[id]).sort(),
        Object.keys(en.onboarding.steps[id]).sort(),
        `onboarding.steps.${id} has different fields in the two locales`,
      );
    });
  }

  test('the panel chrome exists in both', () => {
    for (const key of ['title', 'subtitle', 'subtitleClearance', 'hide', 'stepDone', 'stepTodo']) {
      assert.ok(en.onboarding?.[key], `onboarding.${key} is missing from en.js`);
      assert.ok(es.onboarding?.[key], `onboarding.${key} is missing from es.js`);
    }
  });

  test('no locale carries copy for a step that cannot be shown', () => {
    // The other direction. A step id removed from onboarding.js leaves dead
    // copy behind, and dead copy is what the next person edits by mistake.
    for (const [name, catalog] of [['en', en], ['es', es]]) {
      for (const id of Object.keys(catalog.onboarding.steps)) {
        assert.ok(STEP_IDS.includes(id), `${name}.js has copy for '${id}', which onboarding.js never emits`);
      }
    }
  });
});
