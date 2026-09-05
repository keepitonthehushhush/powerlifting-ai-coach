import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
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
    /*
     * The TTL is part of the assertion, not incidental. The default is five
     * minutes, and on a product where somebody reads a program and thinks
     * before answering, five minutes expires MID-CONVERSATION - the next turn
     * then rewrites the whole prefix. Priced on claude-sonnet-5: the longer
     * TTL costs $0.033 more once and saves $0.051 on every turn that would
     * have re-written, so it pays for itself on the second message.
     */
    assert.deepEqual(role.cache_control, { type: 'ephemeral', ttl: '1h' });
    // Exactly one breakpoint IN THE SYSTEM BLOCKS. A second on the varying
    // block would write a fresh entry every request and cost 25% more than not
    // caching at all. (The conversation carries its own, on the history rather
    // than on the newest message - see lib/conversationCache.js.)
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
     * cannot tell the difference, which is the correct behavior for it and
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

describe('THE UNEXPLAINED EIGHT THOUSAND TOKENS', () => {
  /*
   * The first unit-economics measurement put uncached input at 46% of what a
   * reply costs - more than the output. The cached block measures ~12,300
   * tokens and matches cache_creation_input_tokens exactly; the athlete-state
   * block measures under 2,000 even loaded with five sessions, sixty logs and
   * an active program. Production still reports 11,000-13,000 uncached input
   * tokens on turn one, when the only uncached content is that block plus one
   * user message.
   *
   * Nothing in this repository accounts for the difference, so chat.js now
   * logs the lengths of the exact strings it sent. These tests pin the shape
   * of that instrumentation - that it exists, and that it stayed lengths.
   *
   * ── AND THE INSTRUMENTATION ANSWERED IT ───────────────────────────────
   *
   * It was the conversation. The window replays up to thirty messages, and on
   * the longest live conversation that is about 9,800 tokens - re-sent at full
   * input price on every single turn, because only the SYSTEM prompt was ever
   * cached. That is the missing eight thousand, near enough, and it was never
   * a mystery about the prompt at all.
   *
   * It is now cached too, with a breakpoint on the last message of the history
   * rather than the newest one. See lib/conversationCache.js.
   */
  const chat = readRaw(new URL('../src/routes/chat.js', import.meta.url));

  test('the prompt reports its own size next to what it cost', () => {
    for (const key of ['cachedBlockChars', 'athleteStateChars', 'messagesChars']) {
      assert.match(chat, new RegExp(key), `${key} is not logged`);
    }
    // Without these two the log line cannot tell a cache hit from a miss, and
    // a miss is the more expensive turn by a factor of 1.7.
    assert.match(chat, /cacheReadTokens: reply\.usage\?\.cache_read_input_tokens/);
    assert.match(chat, /cacheWriteTokens: reply\.usage\?\.cache_creation_input_tokens/);
  });

  test('IT LOGS LENGTHS, NEVER THE STRINGS THEMSELVES', () => {
    // The athlete-state block is the densest health data in the product -
    // injuries, restrictions, GLP-1 status, every logged set. Its length is a
    // fact about our prompt. Its contents are not ours to write down.
    /*
     * The whole call, found by its own closing brace rather than by a
     * character count. The previous version sliced a fixed 400 characters
     * past `historyReplayed` and silently stopped covering the end of the log
     * line the moment a comment was added inside it - so the assertions below
     * would have passed while no longer reading the thing they name.
     */
    const start = chat.indexOf("logger.info('chat.completed'");
    const end = chat.indexOf('\n    });', start);
    assert.ok(start > -1 && end > start, 'the completion log line has moved');
    const line = chat.slice(start, end);
    assert.match(line, /system\[0\]\?\.text\?\.length/);
    assert.match(line, /system\[1\]\?\.text\?\.length/);
    assert.doesNotMatch(line, /system\[1\]\?\.text[,\s}]/, 'the athlete-state block itself is being logged');
    assert.doesNotMatch(line, /content:\s*m\.content[,\s}]/, 'message bodies are being logged');
    /*
     * Lengths, via a helper rather than inline, because one message now
     * carries its text in a block array - that is where the cache breakpoint
     * attaches - and `m.content?.length` on an array counts BLOCKS. The old
     * expression would have reported the entire history as a single character
     * and shown a huge improvement that never happened.
     *
     * The privacy property is unchanged and is what this test is really for:
     * messageChars() reads `block.text.length` and never the text.
     */
    assert.match(line, /messageChars\(m\)/);
    const helper = chat.slice(chat.indexOf('function messageChars'), chat.indexOf('export const chatRouter'));
    assert.match(helper, /block\.text\.length/);
    // Written first as a lookahead for "return content not followed by
    // .reduce", which fired on the perfectly correct `return content.length`.
    // The property is simpler than the clever version: it never hands back
    // the content itself.
    assert.doesNotMatch(helper, /return content;/, 'the helper returns content rather than a length');
  });
});
