import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import { buildSystemBlocks, buildSystemPrompt, COACH_ROLE } from '../src/prompts/systemPrompt.js';

const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));

/** Sonnet 5 will not cache a prefix shorter than this. */
const MINIMUM_CACHEABLE_TOKENS = 1024;
/** Character-based approximation; only used for an order-of-magnitude floor. */
const CHARS_PER_TOKEN = 3.7;

const PROFILE = {
  units: 'lb',
  bodyweight: 181,
  current_squat: 275,
  current_bench: 185,
  current_deadlift: 315,
  experience_level: 'six_to_24_months',
  progress_cadence: 'every_week',
  goal: 'general_strength',
  days_per_week: 3,
  equipment_available: 'Full commercial gym',
  health_restrictions: '',
  date_of_birth: '1995-04-02',
};

const context = (overrides = {}) => ({
  profile: { ...PROFILE, ...overrides },
  recentLogs: [],
  recentSessions: [],
  exerciseLibrary: [],
});

describe('the cache breakpoint is somewhere that can actually hit', () => {
  test('the first block is exactly COACH_ROLE and carries the breakpoint', () => {
    const [role, state] = buildSystemBlocks(context());
    assert.equal(role.text, COACH_ROLE);
    assert.deepEqual(role.cache_control, { type: 'ephemeral' });
    // Exactly one breakpoint. A second on the varying block would write a
    // fresh entry every request and cost 25% more than not caching at all.
    assert.equal(state.cache_control, undefined);
  });

  test('THE CACHED BLOCK IS IDENTICAL FOR TWO DIFFERENT ATHLETES', () => {
    // The whole mechanism rests on this. A cache read only happens when the
    // prefix is byte-identical to a previous request, so if anything
    // athlete-specific leaked into block one, every request would be a miss.
    const a = buildSystemBlocks(context({ bodyweight: 181, current_squat: 275 }));
    const b = buildSystemBlocks(
      context({ bodyweight: 240, current_squat: 500, health_restrictions: 'left shoulder pain' })
    );
    assert.equal(a[0].text, b[0].text);
    assert.notEqual(a[1].text, b[1].text, 'the athlete state block should differ');
  });

  test('the cached block clears the model minimum with room to spare', () => {
    const tokens = COACH_ROLE.length / CHARS_PER_TOKEN;
    assert.ok(
      tokens > MINIMUM_CACHEABLE_TOKENS * 1.5,
      `cached prefix is only ~${Math.round(tokens)} tokens; below the minimum it is silently not cached`
    );
  });

  test('the varying suffix is on the far side of the breakpoint', () => {
    // Today's date is the textbook example from the caching documentation of
    // a value that silently destroys every cache hit if it lands inside the
    // cached prefix.
    const [role, state] = buildSystemBlocks(context());
    assert.doesNotMatch(role.text, /\d{4}-\d{2}-\d{2}/, 'a date is inside the cached prefix');
    assert.match(state.text, /Today's date is \d{4}-\d{2}-\d{2}/);
  });
});

describe('nothing about an athlete is in the shared cache entry', () => {
  // The cached prefix is shared across every athlete - that is what makes it
  // worth doing, since any traffic keeps it warm and refreshes are free. It is
  // therefore the one part of this prompt that must provably hold no personal
  // data.
  test('an injury description never reaches the cached block', () => {
    const [role, state] = buildSystemBlocks(
      context({ health_restrictions: 'disc issue diagnosed 2023, sharp pain on deadlifts' })
    );
    assert.doesNotMatch(role.text, /disc issue/);
    assert.match(state.text, /disc issue/);
  });

  test('no lifted weight, bodyweight or birth date reaches the cached block', () => {
    /*
     * This caught a real one, and not the kind it was written for: a new
     * prompt section illustrated a correction with "that was 225, not 275" and
     * put 275 into the cached prefix. Invented, not leaked - and the check
     * cannot tell the difference, which is the correct behaviour for it and
     * the reason the prompt now writes its examples in plates.
     *
     * The one number that IS allowed through is the weight in the
     * <program_data> example, which has to be a number for the JSON to be
     * valid. Keep the fixture values below away from it.
     */
    const [role] = buildSystemBlocks(context());
    for (const value of ['181', '275', '185', '315', '1995-04-02']) {
      assert.ok(!role.text.includes(value), `${value} is in the cached prefix`);
    }
  });

  test('the cached block is built from no inputs at all', () => {
    // Not "we checked and it looked clean" - it is a module constant, so
    // there is no input it could have come from.
    assert.equal(buildSystemBlocks(context())[0].text, COACH_ROLE);
    assert.equal(buildSystemBlocks({})[0].text, COACH_ROLE);
  });
});

describe('the split changed how it is sent, not what it says', () => {
  test('the assembled string is the blocks joined, so the two cannot drift', () => {
    const input = context();
    assert.equal(buildSystemBlocks(input).map((b) => b.text).join('\n'), buildSystemPrompt(input));
  });

  test('COACH_ROLE is still a prefix of the assembled prompt', () => {
    // If a future edit reorders the prompt to cache more of it, this fails -
    // and it should, because reordering invalidates the adversarial eval
    // results the current ordering was verified against.
    assert.ok(buildSystemPrompt(context()).startsWith(COACH_ROLE));
  });

  test('the route sends blocks rather than a string', () => {
    assert.match(chatRoute, /buildSystemBlocks\(context\)/);
    assert.doesNotMatch(chatRoute, /buildSystemPrompt\(/);
  });
});
