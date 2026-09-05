import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import {
  CONVERSATION_CACHE_TTL,
  withHistoryCacheBreakpoint,
} from '../src/lib/conversationCache.js';
import { cacheTtlHonored, costInMicrodollars } from '../src/lib/pricing.js';
import { buildSystemBlocks } from '../src/prompts/systemPrompt.js';

/**
 * ── WHAT THIS COSTS AND WHY IT WAS WORTH BUILDING ─────────────────────────
 *
 * Measured on production usage, not estimated. The longest live conversation
 * replays a 30-message window of about 9,800 tokens on EVERY turn, at full
 * input price - roughly $0.020 a reply against claude-sonnet-5, about half of
 * what a warm reply costs, spent re-sending words the model was shown a
 * minute earlier.
 *
 * And the owner's own observation, which the data supports: use is
 * front-loaded. Day one of the busiest account was 38 replies; the five days
 * after it totalled 19. So the money is concentrated in exactly the sitting
 * where caching pays most.
 */
const line = (n) => 'x'.repeat(n);
const history = (turns = 4, size = 1500) =>
  Array.from({ length: turns }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: line(size),
  }));

describe('the breakpoint goes where it can actually be read back', () => {
  test('it lands on the last message of the history, not the newest one', () => {
    /*
     * THE WHOLE POINT. The newest message changes every turn, so a breakpoint
     * there would write a fresh entry each time and read nothing - the
     * expensive half of caching with none of the benefit. The same mistake as
     * putting the system breakpoint on the varying block, which this project
     * made once and measured.
     */
    const messages = [...history(), { role: 'user', content: 'what do I do today?' }];
    const out = withHistoryCacheBreakpoint(messages);

    const marked = out.filter((m) => Array.isArray(m.content));
    assert.equal(marked.length, 1, 'expected exactly one breakpoint');
    assert.equal(out.indexOf(marked[0]), out.length - 2, 'the breakpoint is not on the last history message');
    assert.equal(typeof out.at(-1).content, 'string', 'the newest message was marked');
  });

  test('it asks for the same TTL as the system prompt', () => {
    // Two entries with different lifetimes means the shorter one expires and
    // the turn pays to rewrite half its prefix for no reason.
    const out = withHistoryCacheBreakpoint([...history(), { role: 'user', content: 'q' }]);
    const [block] = out.at(-2).content;
    assert.deepEqual(block.cache_control, { type: 'ephemeral', ttl: CONVERSATION_CACHE_TTL });
    assert.equal(buildSystemBlocks({ profile: {} })[0].cache_control.ttl, CONVERSATION_CACHE_TTL);
  });

  test('the text survives the wrapping, exactly', () => {
    const messages = [...history(), { role: 'user', content: 'q' }];
    const original = messages.at(-2).content;
    const out = withHistoryCacheBreakpoint(messages);
    assert.equal(out.at(-2).content[0].text, original);
    assert.equal(out.at(-2).content[0].type, 'text');
    assert.equal(out.at(-2).role, messages.at(-2).role);
  });

  test('it does not mutate what the caller handed it', () => {
    // The caller's array is what gets stored and logged. A cache marker is a
    // fact about one request and has no business in either.
    const messages = [...history(), { role: 'user', content: 'q' }];
    withHistoryCacheBreakpoint(messages);
    assert.ok(messages.every((m) => typeof m.content === 'string'));
  });
});

describe('it declines to mark what cannot be cached', () => {
  test('a short conversation is left alone', () => {
    // Below Anthropic's minimum the marker is ignored rather than refused, so
    // asking for it would be noise that looks like a working control.
    const out = withHistoryCacheBreakpoint([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'squats?' },
    ]);
    assert.ok(out.every((m) => typeof m.content === 'string'));
  });

  test('the threshold sits well above the documented floor', () => {
    // 1,024 tokens at the ~2.9 characters per token measured on this prompt is
    // about 3,000 characters. The threshold is higher so an unusually dense
    // conversation cannot slip under it.
    const source = readSource(new URL('../src/lib/conversationCache.js', import.meta.url));
    const found = source.match(/const MIN_CACHEABLE_CHARS = (\d+);/);
    assert.ok(found, 'the threshold moved');
    assert.ok(Number(found[1]) >= 3500, `threshold ${found[1]} is under the caching floor`);
  });

  test('a single message, an empty list, or junk is returned unharmed', () => {
    assert.deepEqual(withHistoryCacheBreakpoint([]), []);
    assert.deepEqual(withHistoryCacheBreakpoint([{ role: 'user', content: 'q' }]), [
      { role: 'user', content: 'q' },
    ]);
    assert.deepEqual(withHistoryCacheBreakpoint(null), []);
    assert.deepEqual(withHistoryCacheBreakpoint(undefined), []);
  });

  test('a message that already carries blocks is not rewritten', () => {
    // It was built by something else, and quietly reshaping it here is how a
    // caller's structure gets lost.
    const messages = [
      { role: 'user', content: line(3000) },
      { role: 'assistant', content: [{ type: 'text', text: line(3000) }] },
      { role: 'user', content: 'q' },
    ];
    assert.deepEqual(withHistoryCacheBreakpoint(messages), messages);
  });
});

describe('THE COST LINE CAN TELL THE TWO WRITE PRICES APART', () => {
  const model = 'claude-sonnet-5';
  const usage = (creation) => ({
    input_tokens: 9766,
    output_tokens: 1400,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 22133,
    cache_creation: creation,
  });

  test('a one-hour write costs more than a five-minute one, and is priced as such', () => {
    /*
     * This used to charge every write at the five-minute rate, which was
     * correct while that was the only kind being made and became a 38%
     * understatement of the largest line in a cold reply the moment a
     * one-hour breakpoint was used. An understated cost is the direction that
     * flatters us, which is the direction this project distrusts.
     */
    const oneHour = costInMicrodollars(usage({ ephemeral_1h_input_tokens: 22133, ephemeral_5m_input_tokens: 0 }), model);
    const fiveMin = costInMicrodollars(usage({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 22133 }), model);
    assert.ok(oneHour > fiveMin, 'the two write prices are being treated as one');
    assert.equal(oneHour - fiveMin, 33199); // $0.0332, the premium on this prefix
  });

  test('with no breakdown it falls back to the cheaper rate rather than guessing', () => {
    const legacy = { ...usage(undefined) };
    delete legacy.cache_creation;
    const fiveMin = costInMicrodollars(usage({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 22133 }), model);
    assert.equal(costInMicrodollars(legacy, model), fiveMin);
  });
});

describe('AND IT NOTICES IF THE TTL IS QUIETLY IGNORED', () => {
  /*
   * `extended-cache-ttl-2025-04-11` is still a named beta in the installed
   * SDK even though `ttl` sits on the stable type. If the field is ignored
   * rather than refused, nothing fails: the request succeeds, a five-minute
   * entry is written, the cache keeps missing and the bill does not improve.
   *
   * That is this project's entire defect pattern - a control that stops
   * working and produces no failure - so the request is not trusted and the
   * response is read.
   */
  test('it says yes when the asked-for entry was made', () => {
    assert.equal(cacheTtlHonored({ cache_creation: { ephemeral_1h_input_tokens: 22133, ephemeral_5m_input_tokens: 0 } }, '1h'), true);
  });

  test('and NO when a write happened and it was the other kind', () => {
    assert.equal(cacheTtlHonored({ cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 22133 } }, '1h'), false);
  });

  test('a pure cache hit says nothing, and says so rather than claiming success', () => {
    // No write happened, so there is no evidence either way. Returning true
    // here would report a working control on a request that did not test it.
    assert.equal(cacheTtlHonored({ cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } }, '1h'), null);
    assert.equal(cacheTtlHonored({}, '1h'), null);
    assert.equal(cacheTtlHonored(null, '1h'), null);
  });

  test('and the route records it, so a silent downgrade is visible', () => {
    const route = readSource(new URL('../src/routes/chat.js', import.meta.url));
    assert.match(route, /cacheTtlHonored: cacheTtlHonored\(reply\.usage, '1h'\)/);
  });
});

describe('the prompt size line still measures the prompt', () => {
  test('a message carrying blocks is counted by its text, not its array length', () => {
    /*
     * The trap this closes: `m.content?.length` on a block array returns the
     * NUMBER OF BLOCKS. One message became blocks when it gained the
     * breakpoint, so the line that exists to watch prompt size would have
     * quietly dropped the entire history from its own measurement - reporting
     * a large improvement that never happened.
     */
    const route = readSource(new URL('../src/routes/chat.js', import.meta.url));
    assert.match(route, /messagesChars: apiMessages\.reduce\(\(n, m\) => n \+ messageChars\(m\), 0\)/);
    assert.match(route, /function messageChars\(message\)/);
    assert.doesNotMatch(route, /n \+ \(m\.content\?\.length \?\? 0\)/);
  });
});
