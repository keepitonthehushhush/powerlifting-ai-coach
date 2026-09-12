import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isTransportFailure, recoverExchange } from '../../web/src/lib/chatRecovery.js';
import { readSource } from './helpers/source.js';

const chatPage = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));

/**
 * ── THE FIRST BUG REPORTED FROM ACTUALLY USING THE APP ────────────────────
 *
 * "When exiting the Coach Diaz app to do other things while the coach is
 * thinking, and I go back into the app, it says 'could not reach the server'.
 * But it only fails because I exited the app."
 *
 * Exactly right, and the message was a lie in the worst direction. Mobile
 * browsers freeze or discard an in-flight fetch when the page is
 * backgrounded, so the request dies HERE while the server carries on - and
 * the server writes both messages into `conversations` before it responds.
 * The exchange was already saved. The client rolled it back off the screen
 * and handed the draft back, telling somebody their message never arrived
 * while the coach's answer sat in the database.
 *
 * The recovery asks whether it already happened. It is deliberately not a
 * retry: a retry sends the message twice.
 */
describe('recovering an exchange the browser stopped listening for', () => {
  const BASE = [
    { role: 'user', content: 'hello', at: '2026-09-01T10:00:00Z' },
    { role: 'assistant', content: 'hi', at: '2026-09-01T10:00:01Z' },
  ];
  const AFTER = [
    ...BASE,
    { role: 'user', content: 'what should I squat today?', at: '2026-09-01T10:05:00Z' },
    { role: 'assistant', content: 'Work up to 185 for 3 sets of 5.', at: '2026-09-01T10:05:30Z' },
  ];
  const now = () => Promise.resolve();

  test('only transport failures are recoverable', () => {
    // A 400, 429 or 500 is the server ANSWERING. Re-asking would be asking a
    // question that already has an answer, and hiding it from the person.
    assert.equal(isTransportFailure({ status: 0 }), true, 'a dead fetch');
    assert.equal(isTransportFailure({ status: 408 }), true, 'our own timeout');
    for (const status of [400, 401, 402, 429, 500, 502]) {
      assert.equal(isTransportFailure({ status }), false, `${status} is an answer`);
    }
  });

  test('adopts the reply that landed while the app was in the background', async () => {
    const outcome = await recoverExchange({
      fetchConversation: async () => ({ conversation: { id: 'c1', messages: AFTER } }),
      baselineCount: BASE.length,
      sentText: 'what should I squat today?',
      wait: now,
    });

    assert.equal(outcome.recovered, true);
    assert.equal(outcome.conversationId, 'c1');
    assert.deepEqual(outcome.messages, AFTER);
  });

  test('waits for a reply still being generated, rather than declaring it lost', async () => {
    // Coming back after eight seconds is different from coming back after
    // ninety. A single check would find nothing mid-generation and give the
    // same wrong answer with extra steps.
    let call = 0;
    const outcome = await recoverExchange({
      fetchConversation: async () => {
        call += 1;
        return { conversation: { id: 'c1', messages: call < 3 ? BASE : AFTER } };
      },
      baselineCount: BASE.length,
      sentText: 'what should I squat today?',
      wait: now,
    });

    assert.equal(outcome.recovered, true);
    assert.equal(call, 3, 'gave up before the reply arrived');
  });

  test('gives up rather than polling forever', async () => {
    let call = 0;
    const outcome = await recoverExchange({
      fetchConversation: async () => {
        call += 1;
        return { conversation: { id: 'c1', messages: BASE } };
      },
      baselineCount: BASE.length,
      sentText: 'what should I squat today?',
      attempts: 3,
      wait: now,
    });

    assert.equal(outcome.recovered, false);
    assert.equal(call, 3);
  });

  test('A FAILED CHECK COSTS AN ATTEMPT, NOT THE WHOLE LOOP', async () => {
    /*
     * ── THIS TEST USED TO ASSERT THE OPPOSITE ──────────────────────────────
     *
     * It pinned `call === 1` with the comment "kept trying a connection that
     * is not there", on the reasoning that a failed check proved the
     * connection was down and the original error had been right.
     *
     * Production falsified that on 2026-09-11, on a phone:
     *
     *   21:04:11  client_request_timed_out   /api/chat
     *   21:04:52  client_request_failed      /api/chat/conversation  <- check
     *   21:04:53  the exchange is in the database
     *
     * One second. The athlete was told their message had not gone through
     * while the coach's reply was already saved. A single failed request is
     * not evidence of a dead connection - it is the same evidence that
     * started the recovery, on the same flaky link.
     */
    let call = 0;
    const outcome = await recoverExchange({
      fetchConversation: async () => {
        call += 1;
        throw new Error('offline');
      },
      baselineCount: BASE.length,
      sentText: 'x',
      wait: now,
    });

    assert.equal(outcome.recovered, false);
    assert.equal(call, 3, 'one transient failure still collapses three attempts to one');
    assert.equal(outcome.reason, 'unreachable');
  });

  test('and the check that succeeds after one that threw still recovers', async () => {
    // The exact production sequence: the first check dies on a link that is
    // coming back, and the reply is there a moment later.
    let call = 0;
    const outcome = await recoverExchange({
      fetchConversation: async () => {
        call += 1;
        if (call === 1) throw new Error('offline');
        return { conversation: { id: 'c1', messages: AFTER } };
      },
      baselineCount: BASE.length,
      sentText: 'what should I squat today?',
      wait: now,
    });

    assert.equal(outcome.recovered, true, 'the reply was in the database and was reported lost');
    assert.equal(call, 2, 'it did not try again after the first check threw');
    assert.equal(outcome.conversationId, 'c1');
  });

  test('the checks are SPACED, or polling is not polling', async () => {
    /*
     * Every test here injects a no-op `wait`, so the delays are invisible
     * unless something looks at them - and a mutant that fired all three
     * checks in the same millisecond survived the whole file.
     *
     * The spacing is the entire mechanism. "Coming back after eight seconds is
     * different from coming back after ninety": three instant checks answer
     * the same question three times and declare a reply lost that is still
     * being written.
     */
    const waited = [];
    await recoverExchange({
      fetchConversation: async () => ({ conversation: { id: 'c1', messages: BASE } }),
      baselineCount: BASE.length,
      sentText: 'x',
      wait: (ms) => { waited.push(ms); return Promise.resolve(); },
    });

    // Nothing before the first check: the common case is that the reply is
    // already saved, and waiting two seconds to say so is its own bug.
    assert.deepEqual(waited, [2000, 4000]);
  });

  test('checks that are answered and find nothing are a different fact', () => {
    // "Nobody answered" and "the answer was no" should not reach whoever reads
    // this next as one sentence.
    return recoverExchange({
      fetchConversation: async () => ({ conversation: { id: 'c1', messages: BASE } }),
      baselineCount: BASE.length,
      sentText: 'x',
      wait: now,
    }).then((outcome) => {
      assert.equal(outcome.recovered, false);
      assert.equal(outcome.reason, 'not_found');
    });
  });

  test('a longer conversation alone is not the exchange landing', async () => {
    /*
     * The same account open in another tab, or a message sent from another
     * device, grows the conversation without our send having succeeded.
     * Adopting that would show somebody a reply to a question they did not
     * ask and quietly drop the one they did.
     */
    const somebodyElse = [
      ...BASE,
      { role: 'user', content: 'unrelated', at: '2026-09-01T10:04:00Z' },
      { role: 'assistant', content: 'also unrelated', at: '2026-09-01T10:04:10Z' },
    ];
    const outcome = await recoverExchange({
      fetchConversation: async () => ({ conversation: { id: 'c1', messages: somebodyElse } }),
      baselineCount: BASE.length,
      sentText: 'what should I squat today?',
      attempts: 1,
      wait: now,
    });

    assert.equal(outcome.recovered, false);
  });

  test('a saved user message with no reply yet does not count as landed', async () => {
    // Not a state this server produces - it writes both in one update - but
    // the recovery must not depend on that staying true.
    const halfway = [...BASE, { role: 'user', content: 'what should I squat today?' }];
    const outcome = await recoverExchange({
      fetchConversation: async () => ({ conversation: { id: 'c1', messages: halfway } }),
      baselineCount: BASE.length,
      sentText: 'what should I squat today?',
      attempts: 1,
      wait: now,
    });

    assert.equal(outcome.recovered, false);
  });

  test('an empty or missing conversation is handled, not thrown on', async () => {
    for (const conversation of [null, undefined, { id: 'c1' }]) {
      const outcome = await recoverExchange({
        fetchConversation: async () => ({ conversation }),
        baselineCount: 0,
        sentText: 'x',
        attempts: 1,
        wait: now,
      });
      assert.equal(outcome.recovered, false);
    }
  });
});

describe('the recovery is wired in, and rests on the server saving first', () => {
  test('the chat page attempts recovery before rolling the message back', () => {
    const dispatch = chatPage.slice(chatPage.indexOf('async function dispatch'));
    const body = dispatch.slice(0, dispatch.indexOf('\n  }'));

    const recoverAt = body.indexOf('recoverExchange');
    const rollbackAt = body.indexOf('prev.filter((m) => m !== optimistic)');
    assert.ok(recoverAt > -1, 'the chat page no longer attempts recovery');
    assert.ok(rollbackAt > -1, 'the rollback has moved - this test is looking at the wrong thing');
    assert.ok(recoverAt < rollbackAt, 'the message is rolled back before asking whether it landed');
  });

  test('the baseline excludes the optimistic message', () => {
    // It exists only in this browser. Counting it would make a recovered
    // exchange look like no growth at all, and nothing would ever recover.
    assert.match(chatPage, /messages\.filter\(\(m\) => m !== optimistic\)\.length/);
  });

  test('and the server really does save before it answers', () => {
    /*
     * The whole recovery rests on this. If the server ever moves the save
     * after the response, a backgrounded request would lose the exchange for
     * real and this recovery would poll for something that is not coming.
     */
    const save = chatRoute.indexOf("rpc('append_conversation_turn'");
    const respond = chatRoute.indexOf('res.json(');
    assert.ok(save > -1, 'the conversation save has moved - it no longer appends through the RPC');
    assert.ok(respond > -1, 'the response has moved');
    assert.ok(save < respond, 'the server answers before saving - recovery cannot work');
  });
});
