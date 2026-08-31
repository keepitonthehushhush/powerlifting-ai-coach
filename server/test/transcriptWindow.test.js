import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { windowTranscript, RECENT_MESSAGE_LIMIT } from '../../web/src/lib/transcriptWindow.js';

/**
 * What the coach page mounts.
 *
 * The bug this guards against is not subtle in production and is very easy to
 * reintroduce in an edit: an off-by-one that offers "Show 0 earlier messages",
 * or a slice from the wrong end that shows somebody the oldest twenty messages
 * of a four-month conversation and calls it their chat.
 */

const conversation = (n) =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

describe('the transcript window', () => {
  test('a short conversation is shown whole, with nothing held back', () => {
    const messages = conversation(6);
    assert.deepEqual(windowTranscript(messages), { visible: messages, hidden: 0 });
  });

  test('exactly at the limit is still whole - the boundary that produces "Show 0 earlier"', () => {
    const messages = conversation(RECENT_MESSAGE_LIMIT);
    const { visible, hidden } = windowTranscript(messages);
    assert.equal(hidden, 0);
    assert.equal(visible.length, RECENT_MESSAGE_LIMIT);
  });

  test('one past the limit holds back exactly one', () => {
    const { visible, hidden } = windowTranscript(conversation(RECENT_MESSAGE_LIMIT + 1));
    assert.equal(hidden, 1);
    assert.equal(visible.length, RECENT_MESSAGE_LIMIT);
  });

  test('it keeps the END of the conversation, not the beginning', () => {
    const { visible } = windowTranscript(conversation(50));
    assert.equal(visible.at(-1).content, 'm49', 'the newest message must be on screen');
    assert.equal(visible[0].content, `m${50 - RECENT_MESSAGE_LIMIT}`);
  });

  test('the production conversation that crashed a phone', () => {
    // 126 messages, measured 2026-08-31.
    const { visible, hidden } = windowTranscript(conversation(126));
    assert.equal(visible.length, RECENT_MESSAGE_LIMIT);
    assert.equal(hidden, 106);
    assert.equal(visible.length + hidden, 126, 'nothing may be lost, only held back');
  });

  test('expanded mounts everything, because the athlete asked for it', () => {
    const messages = conversation(126);
    assert.deepEqual(windowTranscript(messages, { expanded: true }), { visible: messages, hidden: 0 });
  });

  test('a nonsense limit falls back rather than rendering an empty conversation', () => {
    // An empty transcript is indistinguishable from a failed load, which is
    // the worst thing this function could produce.
    for (const limit of [0, -5, 1.5, null, undefined, 'twenty']) {
      const { visible } = windowTranscript(conversation(30), { limit });
      assert.equal(visible.length, RECENT_MESSAGE_LIMIT, `limit ${String(limit)} emptied the screen`);
    }
  });

  test('missing or malformed input is empty, not a throw', () => {
    for (const bad of [undefined, null, 'nope', 42, {}]) {
      assert.deepEqual(windowTranscript(bad), { visible: [], hidden: 0 });
    }
  });
});
