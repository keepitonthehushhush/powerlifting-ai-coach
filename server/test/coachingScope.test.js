import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { restBetweenSets, restBetweenReps } from '../src/lib/rest.js';
import { COACH_ROLE, buildSystemPrompt } from '../src/prompts/systemPrompt.js';

const restRaw = readRaw(new URL('../src/lib/rest.js', import.meta.url));
const prompt = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));
const nutrition = readSource(new URL('../src/lib/nutrition.js', import.meta.url));

describe('rest between sets is computed, not left to the athlete to guess', () => {
  test('the three competition lifts at low reps get the long rest', () => {
    const r = restBetweenSets({ reps: 5, lift: 'squat' });
    assert.equal(r.minSeconds, 180);
    assert.equal(r.maxSeconds, 300);
    assert.equal(r.label, '3-5 min');
  });

  test('THE BOTTOM OF THE NSCA RANGE IS DELIBERATELY NOT OFFERED', () => {
    // NSCA gives 2-5 minutes for maximal strength. The 2 exists for trained
    // athletes managing session length; this product's users are mostly
    // novices whose limiting factor is not time. Told "2 to 5" a nervous
    // beginner hears 2, which is the rest that turns set three into a
    // different exercise from set one.
    assert.ok(restBetweenSets({ reps: 3, lift: 'bench press' }).minSeconds >= 180);
    assert.match(restRaw, phrase('a nervous beginner hears 2'));
  });

  test('rest scales down with the rep range, not up', () => {
    const heavy = restBetweenSets({ reps: 5, lift: 'deadlift' }).minSeconds;
    const moderate = restBetweenSets({ reps: 10, lift: 'barbell row' }).minSeconds;
    const light = restBetweenSets({ reps: 20, lift: 'lateral raise' }).minSeconds;
    assert.ok(heavy > moderate && moderate > light);
  });

  test('jumps rest like power work, whatever the reps say', () => {
    const r = restBetweenSets({ reps: 5, isPlyometric: true });
    assert.equal(r.label, '2-3 min');
    assert.match(r.why, /tired jump is a slower jump/);
  });

  test('it returns a range, because a rest interval is one', () => {
    // A single number would be the arithmetic pretending to know something it
    // does not.
    for (const input of [{ reps: 5, lift: 'squat' }, { reps: 12 }, { reps: 20 }]) {
      const r = restBetweenSets(input);
      assert.ok(r.maxSeconds > r.minSeconds, `${JSON.stringify(input)} collapsed to a point`);
    }
  });

  test('rest BETWEEN REPS is answered honestly, including when the answer is "you do not"', () => {
    assert.match(restBetweenReps({ isPlyometric: true }), /5-10 seconds between individual jumps/);
    assert.match(restBetweenReps({ reps: 1 }), /Singles in a top set/);
    assert.equal(restBetweenReps({ reps: 8 }), null);
  });

  test('the figure reaches the athlete with the sets and reps', () => {
    const built = buildSystemPrompt({
      profile: { units: 'lb', current_squat: 225, experience_level: 'six_to_24_months' },
      recentLogs: [{ lift: 'squat', weight: 200, reps: 5, completed: true, date: '2026-08-20' }],
    });
    assert.match(built, /Rest \d/);
    assert.match(built, phrase('The rest figures are part of the prescription, not a footnote'));
  });

  test('and holding the rack for four minutes is named as correct, not rude', () => {
    assert.match(prompt, phrase('rather than something to apologize for'));
  });
});

describe('meals, without crossing into medical nutrition therapy', () => {
  test('THE CALORIE PROHIBITION SURVIVED THE MEAL FEATURE', () => {
    // The whole risk of this addition. "Suggest meals" is one short step from
    // "here is your 2,400 kcal day", and that step is the line between general
    // nutrition information and medical nutrition therapy.
    assert.match(COACH_ROLE, phrase('Give a calorie target. Not a number, not a range'));
    assert.match(COACH_ROLE, phrase('not worked backwards'));
    assert.match(COACH_ROLE, phrase('and not if the athlete asks repeatedly'));
    // And the module it points at still holds the same line.
    assert.doesNotMatch(nutrition, /calorie(s)?:/i);
  });

  test('no prescriptive plan, no weighing, no elimination', () => {
    assert.match(COACH_ROLE, phrase('as something the athlete is to follow'));
    assert.match(COACH_ROLE, phrase('Tell somebody to weigh their food'));
    assert.match(COACH_ROLE, phrase('eliminate a food group'));
  });

  test('no moralising, which is the failure mode that hurts people', () => {
    assert.match(COACH_ROLE, phrase('There is no clean and dirty, no good and bad, no'));
    assert.match(COACH_ROLE, phrase('nothing to earn or burn off'));
  });

  test('diagnosed conditions go to a dietitian and the coaching continues', () => {
    // Both halves. Referring is right; dropping the person is not.
    assert.match(COACH_ROLE, phrase('needs a registered'));
    assert.match(COACH_ROLE, phrase('and then keep helping with the training'));
  });

  test('the disordered-eating rule outranks all of it', () => {
    assert.match(COACH_ROLE, phrase('takes precedence over everything in this one'));
  });

  test('it is allowed to name actual food, which is the point', () => {
    assert.match(COACH_ROLE, phrase('Name the food'));
    assert.match(COACH_ROLE, phrase('Ranges are not dinner'));
    assert.match(COACH_ROLE, phrase('Most people fail on logistics, not knowledge'));
  });
});

describe('jumps, throws and sprints', () => {
  test('the volume and rest figures are stated, not left vague', () => {
    assert.match(COACH_ROLE, phrase('80-100 foot contacts in a session'));
    assert.match(COACH_ROLE, phrase('2-3 minutes between sets'));
    assert.match(COACH_ROLE, phrase('5-10 seconds between individual jumps'));
    assert.match(COACH_ROLE, phrase('2-3 days between sessions'));
  });

  test('THEY GO BEFORE THE HEAVY WORK, NEVER AFTER', () => {
    // The single most common way this is programmed wrong, and it inverts the
    // adaptation being trained.
    assert.match(COACH_ROLE, phrase('BEFORE the heavy lifting, never after'));
    assert.match(COACH_ROLE, phrase('teaches the nervous system the opposite of the point'));
  });

  test('the clearance gate is an absolute bar, with the loophole named', () => {
    // "Light plyos" is exactly the phrasing that would otherwise get through,
    // the same way "a modified program" did on the clearance gate itself.
    assert.match(COACH_ROLE, phrase('this is not a partial'));
    assert.match(COACH_ROLE, phrase('no jumps, no sprints, no "light plyos"'));
  });

  test('injury, novices and meet weeks are all excluded', () => {
    assert.match(COACH_ROLE, phrase('knee, ankle, hip, foot or back problem'));
    assert.match(COACH_ROLE, phrase('A first training block'));
    assert.match(COACH_ROLE, phrase('Within two weeks of a competition'));
  });

  test('the strength guideline is a caution, not a gate somebody must pass', () => {
    // 1.5x bodyweight is a real convention and a bad hard rule: applied
    // literally it forbids a pogo hop to most beginners, which is absurd.
    assert.match(COACH_ROLE, phrase('Treat these as reasons to be'));
    assert.match(COACH_ROLE, phrase('not as a test somebody has to pass before doing a pogo hop'));
  });

  test('it is not conditioning and not a way to burn calories', () => {
    assert.match(COACH_ROLE, phrase('It is not conditioning, it is not a finisher'));
    assert.match(COACH_ROLE, phrase('never a way to burn calories'));
  });

  test('landing is named as the limiting skill', () => {
    assert.match(COACH_ROLE, phrase('cannot land quietly and in control is not ready'));
  });
});

describe('the additions did not loosen anything that was tight', () => {
  test('the clearance gate is untouched, and still bars the new sections too', () => {
    // SCOPE THE INJURY lives in the per-turn directive rather than in
    // COACH_ROLE, so this asserts against a built prompt with the gate up -
    // which is the more meaningful check in any case, because what matters is
    // what a gated athlete's request actually produces.
    const gated = buildSystemPrompt({
      profile: { units: 'lb', health_restrictions: 'sharp knee pain on landing', cleared_to_train: false },
    });
    assert.match(gated, /SCOPE THE INJURY/);
    assert.match(gated, /YOU MAY NOT/);
    // And the jump section's own bar is in the same prompt, so a gated athlete
    // asking for "light plyos" meets it twice.
    assert.match(gated, phrase('no jumps, no sprints, no "light plyos"'));
  });

  test('the coach still has no tools', () => {
    const client = readSource(new URL('../src/lib/anthropic.js', import.meta.url));
    assert.ok(!/\btools\s*:/.test(client));
  });

  test('all of this is in the cached prefix, so it costs nothing per message', () => {
    // Four new sections is a lot of tokens. They are static, so they sit
    // behind the cache breakpoint and are read at cache-read rates rather
    // than being re-sent at full price on every turn.
    for (const heading of ['# SUPPLEMENTS', '# JUMPS, THROWS AND SPRINTS', '# FOOD, AND ACTUALLY EATING IT']) {
      assert.ok(COACH_ROLE.includes(heading), `${heading} is not in the cached block`);
    }
  });
});

/**
 * ── MUSIC, AND WHY IT IS A COACHING ANSWER RATHER THAN A FEATURE ───────────
 *
 * "Should we also add music suggestions that can help motivate the enduser?
 * Also mention if its explicit or not?"
 *
 * The research pointed somewhere other than a recommendation engine. A scoping
 * review of 32 studies found the benefit belongs to music the athlete CHOSE -
 * the great majority of resistance-exercise studies improved on at least one
 * outcome with self-selected music - and that the effects land on repetition
 * volume, power output and perceived effort. Maximal strength, which is the
 * entire point of powerlifting, is the outcome that barely moves.
 *
 * So a curated playlist would have been the weak version of the intervention,
 * with a licensing surface attached and a track database to maintain. The
 * strong version is one section of prompt telling the coach to send them to
 * their own music and to be honest about where it does and does not help.
 */
describe('music is answered honestly rather than sold', () => {
  const SECTION = COACH_ROLE.slice(
    COACH_ROLE.indexOf('# MUSIC'),
    COACH_ROLE.indexOf('# JUMPS, THROWS AND SPRINTS')
  );

  test('the section is there to read', () => {
    // The floor. A slice that finds nothing passes everything below it.
    assert.ok(SECTION.length > 600, 'the music section is missing or truncated');
  });

  test('THEIR OWN MUSIC, NOT A PLAYLIST WE PICKED', () => {
    assert.match(SECTION, phrase('Music that the athlete CHOSE beats anything chosen for them'));
    assert.match(SECTION, phrase('ask what they already like'));
  });

  test('AND IT IS NOT SOLD AS A STRENGTH AID', () => {
    // The claim the evidence does not support, named explicitly so it cannot
    // be reworded into the prompt later.
    assert.match(SECTION, phrase('Maximal strength is the outcome'));
    assert.match(SECTION, phrase('Do not promise somebody that a track will add weight'));
  });

  test('lifting in silence is not treated as a gap', () => {
    assert.match(SECTION, phrase('Never prescribe music'));
  });

  test('EXPLICIT CONTENT IS FLAGGED, WHICH IS WHAT WAS ASKED FOR', () => {
    assert.match(SECTION, phrase('SAY IF IT IS EXPLICIT'));
  });

  test('and nothing copyrighted is reproduced or linked', () => {
    // The standing rule, which reaches lyrics as squarely as it reaches video.
    assert.match(SECTION, phrase('never reproduce lyrics'));
    assert.match(SECTION, phrase('Never link to anywhere a track can be downloaded'));
  });

  test('THE ONLY RULE CLAIM IT MAKES IS ONE THAT WAS CHECKED', () => {
    /*
     * The first draft of this section was going to say that federations do not
     * allow headphones on the platform. The 2026 IPF technical rulebook does
     * not mention headphones anywhere, so the prompt says that instead and
     * sends the athlete to the meet director. An invented rule in a coaching
     * product is worse than no rule, because it will be repeated.
     */
    assert.match(SECTION, phrase('does not mention headphones at all'));
    assert.match(SECTION, phrase('ask the meet director'));
    assert.doesNotMatch(SECTION, /federations (do not|don't) allow/i);
  });
});
