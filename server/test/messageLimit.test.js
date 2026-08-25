import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildConfig } from '../src/lib/env.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const baseEnv = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

/**
 * A user pasted a long description of their training and got "Invalid
 * request." — a message that names nothing, suggests nothing, and reads as the
 * app being broken. It was a 4,000-character cap doing exactly what it was
 * told, silently.
 *
 * The cap is not the mistake; every character is replayed through the history
 * window on later turns and paid for again. Being tight enough to catch
 * ordinary use, and mute about it, was.
 */

describe('the message limit', () => {
  test('is generous enough for someone describing their training', () => {
    // Roughly two pages of prose. The old 4,000 was under one.
    assert.ok(buildConfig(baseEnv).chat.maxMessageLength >= 12000);
  });

  test('is still a deploy variable, so it can be tuned without a code change', () => {
    assert.equal(buildConfig({ ...baseEnv, CHAT_MAX_MESSAGE_LENGTH: '2500' }).chat.maxMessageLength, 2500);
  });
});

describe('a message that is too long says so', () => {
  const route = read('../src/routes/chat.js');

  test('length gets its own error rather than the generic one', () => {
    assert.match(route, /message_too_long/);
    assert.match(route, /the limit is/);
  });

  test('the error carries both numbers, so the person can judge the gap', () => {
    const block = route.slice(route.indexOf('message_too_long') - 700, route.indexOf('message_too_long') + 200);
    assert.match(block, /length\.toLocaleString/);
    assert.match(block, /maxMessageLength\.toLocaleString/);
  });
});

describe('client and server cannot disagree about the limit', () => {
  test('the server sends the limit with the conversation', () => {
    assert.match(read('../src/routes/chat.js'), /limits:\s*\{\s*maxMessageLength/);
  });

  test('the client takes the limit from the server rather than hardcoding one', () => {
    const chat = read('../../web/src/pages/Chat.jsx');
    assert.match(chat, /limits\?\.maxMessageLength/);
    // A literal 4000 or 12000 in the component would drift the moment the
    // deploy variable was tuned, reproducing the silent rejection.
    assert.ok(!/\b(4000|12000)\b/.test(chat), 'the client must not hardcode a limit');
  });

  test('the textarea stops the person before the server has to', () => {
    const chat = read('../../web/src/pages/Chat.jsx');
    assert.match(chat, /maxLength/);
    assert.match(chat, /characterCount/);
  });
});
