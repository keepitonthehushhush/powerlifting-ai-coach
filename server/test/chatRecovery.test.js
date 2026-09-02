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

  test('a failing recovery fetch means the connection really is down', async () => {
    // Then the original error was right, and it should be shown - not
    // replaced by more waiting.
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
    assert.equal(call, 1, 'kept trying a connection that is not there');
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
    const save = chatRoute.indexOf("from('conversations')\n      .update({ messages: updated })");
    const respond = chatRoute.indexOf('res.json(');
    assert.ok(save > -1, 'the conversation save has moved');
    assert.ok(respond > -1, 'the response has moved');
    assert.ok(save < respond, 'the server answers before saving - recovery cannot work');
  });
});
