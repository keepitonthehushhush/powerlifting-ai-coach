import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { recommendPhase } from '../src/lib/phase.js';
import { describePhase, buildSystemPrompt } from '../src/prompts/systemPrompt.js';

const phaseRaw = readRaw(new URL('../src/lib/phase.js', import.meta.url));
const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const ex = (lift) => ({ [lift]: { action: 'exhausted' } });
const fine = (lift) => ({ [lift]: { action: 'increase' } });

describe('recommendPhase', () => {
  test('a novice who is still progressing stays a novice', () => {
    const d = recommendPhase({ profile: {}, prescriptions: { ...fine('squat'), ...fine('bench') } });
    assert.equal(d.phase, 'novice');
    assert.equal(d.changed, false);
  });

  test('THE SQUAT IS THE BELLWETHER', () => {
    // Trained most often, drives the program, and running out of squat
    // resets is the classic signal to move on.
    const d = recommendPhase({ profile: {}, prescriptions: { ...ex('squat'), ...fine('bench') } });
    assert.equal(d.phase, 'intermediate');
    assert.equal(d.changed, true);
    assert.equal(d.basis, 'logs');
  });

  test('THE DEADLIFT STALLING ALONE IS NOT A TRAINING-AGE CHANGE', () => {
    // Its reset budget is 1 on purpose - trained least often, recovers
    // slowest, so it is EXPECTED to stall long before linear progression is
    // finished everywhere else. Promoting on it would move most novices to
    // intermediate weeks early.
    const d = recommendPhase({ profile: {}, prescriptions: { ...ex('deadlift'), ...fine('squat') } });
    assert.equal(d.phase, 'novice');
    assert.equal(d.changed, false);
    assert.match(d.reason, /expected to stall first/);
    // And it still says something useful rather than nothing.
    assert.match(d.reason, /Change the scheme on that lift/);
  });

  test('two of the supporting lifts is enough without the squat', () => {
    const d = recommendPhase({ profile: {}, prescriptions: { ...ex('bench'), ...ex('press') } });
    assert.equal(d.phase, 'intermediate');
    assert.equal(d.changed, true);
  });

  test('one supporting lift is not', () => {
    assert.equal(recommendPhase({ profile: {}, prescriptions: ex('bench') }).changed, false);
  });

  test('an athlete who arrives already stalled is not made to prove it', () => {
    // Handing a novice program to somebody who reported months of no
    // progress means watching them fail reps for three weeks to establish
    // something they already told us at intake.
    const d = recommendPhase({ profile: { progress_cadence: 'stalled' }, prescriptions: {} });
    assert.equal(d.phase, 'intermediate');
    assert.equal(d.basis, 'intake');
  });

  test('but what they LOGGED outranks what they remembered', () => {
    // Once there is history, the self-report stops being the evidence.
    const d = recommendPhase({
      profile: { progress_cadence: 'stalled' },
      prescriptions: fine('squat'),
    });
    assert.equal(d.phase, 'novice');
    assert.equal(d.changed, false);
    assert.equal(d.basis, 'logs', 'the decision should say it was based on the logs');
  });

  test('a fast-progressing intake answer does not promote anybody', () => {
    for (const cadence of ['every_session', 'every_week', 'no_history']) {
      assert.equal(recommendPhase({ profile: { progress_cadence: cadence }, prescriptions: {} }).changed, false);
    }
  });

  test('IT NEVER DEMOTES', () => {
    // Detraining genuinely restores linear progression, so novice programming
    // after a layoff is correct - but automating it needs to tell a layoff
    // from a deload from a holiday from somebody who stopped logging, and
    // getting it wrong resets a working program.
    const d = recommendPhase({ profile: {}, prescriptions: fine('squat'), currentPhase: 'intermediate' });
    assert.equal(d.phase, 'intermediate');
    assert.equal(d.changed, false);
    assert.match(phaseRaw, phrase('AND IT NEVER DEMOTES'));
  });

  test('peaking is left alone entirely', () => {
    const d = recommendPhase({ profile: {}, prescriptions: ex('squat'), currentPhase: 'peaking' });
    assert.equal(d.phase, 'peaking');
    assert.equal(d.changed, false);
  });

  test('it survives junk', () => {
    assert.doesNotThrow(() => recommendPhase());
    assert.doesNotThrow(() => recommendPhase({ prescriptions: null, profile: null }));
    assert.equal(recommendPhase({}).phase, 'novice');
  });
});

describe('THE TRANSITION IS A GRADUATION, NOT A STALL', () => {
  const d = describePhase({ profile: {}, prescriptions: ex('squat'), currentPhase: 'novice' });

  test('the coach is told to say so, and told how', () => {
    // The single most motivating moment in a beginner's first year, and the
    // easiest one to deliver as bad news by accident.
    assert.match(d, phrase('It is a graduation and it should read like one'));
    assert.match(d, phrase('Do not present it as a'));
    assert.match(d, phrase('stall, a plateau, a failure'));
  });

  test('and told not to imply they underperformed', () => {
    assert.match(d, phrase('do not imply they could'));
    assert.match(d, phrase('They finished it'));
  });

  test('it explains what actually changes about the programme', () => {
    // Otherwise "you are intermediate now" is a label rather than a plan.
    assert.match(d, phrase('the load varying across the week instead of climbing'));
    assert.match(d, phrase('the week rather than the'));
  });

  test('it tells the coach to record the phase, not just mention it', () => {
    assert.match(d, phrase('set phase to "intermediate" in the'));
  });

  test('nothing is said when nothing has changed', () => {
    assert.equal(describePhase({ profile: {}, prescriptions: fine('squat'), currentPhase: 'novice' }), null);
  });

  test('it reaches the built prompt, from real logs', () => {
    // A realistic history: progress, a reset, more progress, a second reset,
    // then three misses. Two resets is the squat's whole budget, so the
    // engine returns `exhausted` and the phase directive fires.
    //
    // The first version of this fixture was twelve straight misses at one
    // weight, which produces a DELOAD rather than exhaustion - a reset is a
    // drop in working weight, and a log with no drops in it contains no
    // resets however many misses it holds. Worth knowing: exhaustion is a
    // statement about the shape of the history, not the count of failures.
    const recentLogs = [
      { lift: 'squat', weight: 300, reps: 5, completed: true, date: '2026-07-01' },
      { lift: 'squat', weight: 315, reps: 5, completed: false, date: '2026-07-03' },
      { lift: 'squat', weight: 275, reps: 5, completed: true, date: '2026-07-06' },
      { lift: 'squat', weight: 295, reps: 5, completed: false, date: '2026-07-20' },
      { lift: 'squat', weight: 260, reps: 5, completed: true, date: '2026-07-24' },
      { lift: 'squat', weight: 285, reps: 5, completed: false, date: '2026-08-10' },
      { lift: 'squat', weight: 285, reps: 5, completed: false, date: '2026-08-12' },
      { lift: 'squat', weight: 285, reps: 5, completed: false, date: '2026-08-14' },
    ].reverse(); // the route hands these over newest-first

    const built = buildSystemPrompt({
      profile: { units: 'lb', bodyweight: 200 },
      recentLogs,
    });
    assert.match(built, /PHASE CHANGE, AND IT IS COMPUTED/);
    assert.match(built, /INTERMEDIATE/);
  });

  test('THE ROUTE READS THE HISTORY THE SAME WAY THE PROMPT DOES', () => {
    // buildSystemBlocks reverses recentLogs before prescribing, because the
    // engine walks history forwards and counts a reset as a drop in working
    // weight. The phase check in chat.js did not, so it saw every reset as an
    // increase. Caught by the test above failing for the wrong reason.
    const raw = readRaw(new URL('../src/routes/chat.js', import.meta.url));
    assert.match(raw, /logs: \[\.\.\.context\.recentLogs\]\.reverse\(\)/);
    assert.match(raw, phrase('makes every reset look like an increase'));
  });

  test('it is suppressed under the clearance gate', () => {
    const gated = buildSystemPrompt({
      profile: {
        units: 'lb', health_restrictions: 'sharp back pain', cleared_to_train: false,
        progress_cadence: 'stalled',
      },
    });
    assert.doesNotMatch(gated, /PHASE CHANGE/);
  });
});

describe('it recommends rather than enforcing, deliberately', () => {
  test('the route logs a disagreement instead of overriding it', () => {
    assert.match(chat, /program\.phase_disagreed/);
    assert.match(chat, /recommended\.changed && storable\.phase !== recommended\.phase/);
  });

  test('THE REASONING FOR NOT OVERRIDING IS WRITTEN DOWN', () => {
    // The clearance gate IS overridden in code. The difference is what a wrong
    // answer costs - a gated athlete with a program is a safety failure, a
    // wrong phase is a worse program. Conflating those would either make
    // this too weak or the gate too soft.
    const raw = readRaw(new URL('../src/routes/chat.js', import.meta.url));
    assert.match(raw, phrase('VISIBILITY, NOT ENFORCEMENT'));
    assert.match(raw, phrase('That is bad coaching, not'));
    assert.match(raw, phrase('make the record disagree with'));
  });

  test('the check can never cost somebody their program', () => {
    const block = chat.slice(chat.indexOf('const recommended = recommendPhase'));
    assert.match(block.slice(0, 900), /catch \{/);
  });
});
