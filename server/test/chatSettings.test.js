import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import {
  DEFAULTS,
  UNDO_CHOICES,
  SEND_KEY_CHOICES,
  isSendKey,
} from '../../web/src/lib/chatSettings.js';

const chatPage = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const panel = readSource(new URL('../../web/src/components/ChatSettings.jsx', import.meta.url));
const account = readSource(new URL('../../web/src/pages/Account.jsx', import.meta.url));

describe('THE UNDO WINDOW IS OFF UNLESS SOMEBODY ASKS FOR IT', () => {
  test('the default is off', () => {
    // It shipped on and the first person to use it in anger said the cure was
    // worse than the disease: a five-second delay paid by everybody on every
    // message, to serve the occasional typo.
    assert.equal(DEFAULTS.undoWindowSeconds, 0);
  });

  test('off means dispatched immediately, not held for zero seconds', () => {
    // A zero-length hold would still route through the timer, still render the
    // "Sending in 0…" row, and still cost a frame of confusion for nothing.
    assert.match(chatPage, /if \(windowMs <= 0\) \{\s*dispatch\(text, optimistic\);\s*return;\s*\}/);
  });

  test('turning it on is possible, and off is one of the choices', () => {
    assert.ok(UNDO_CHOICES.includes(0), 'there is no way to turn it off');
    assert.ok(UNDO_CHOICES.some((s) => s > 0), 'there is no way to turn it on');
  });

  test('the hold length comes from the setting, not from a constant', () => {
    assert.match(chatPage, /settings\.undoWindowSeconds \* 1000/);
  });
});

describe('the send key is a preference, because a phone and a laptop disagree', () => {
  const key = (over = {}) => ({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, ...over });

  test('Enter sends under the default', () => {
    assert.equal(DEFAULTS.sendKey, 'enter');
    assert.equal(isSendKey(key(), 'enter'), true);
  });

  test('under the modifier setting, plain Enter does not send', () => {
    assert.equal(isSendKey(key(), 'modifier'), false);
    assert.equal(isSendKey(key({ metaKey: true }), 'modifier'), true);
    assert.equal(isSendKey(key({ ctrlKey: true }), 'modifier'), true);
  });

  test('SHIFT+ENTER IS ALWAYS A NEW LINE', () => {
    // Older than this app. Breaking it would surprise everybody, under either
    // setting, and no preference should be able to.
    for (const mode of SEND_KEY_CHOICES) {
      assert.equal(isSendKey(key({ shiftKey: true }), mode), false, mode);
      assert.equal(isSendKey(key({ shiftKey: true, metaKey: true }), mode), false, mode);
    }
  });

  test('a modifier does not send under the Enter setting either', () => {
    // Otherwise Cmd+Enter would send twice as fast as the athlete expects on
    // the setting where Enter already sent.
    assert.equal(isSendKey(key({ metaKey: true }), 'enter'), false);
  });

  test('any other key never sends', () => {
    assert.equal(isSendKey({ key: 'a', shiftKey: false }, 'enter'), false);
    assert.equal(isSendKey({ key: 'Tab', shiftKey: false }, 'modifier'), false);
  });

  test('the page asks the helper rather than testing the event itself', () => {
    assert.match(chatPage, /isSendKey\(e, settings\.sendKey\)/);
    assert.doesNotMatch(chatPage, /e\.key === 'Enter'/, 'the old hardcoded check is back');
  });
});

describe('STORAGE THAT REFUSES MUST NOT BREAK THE PAGE', () => {
  const settings = readSource(new URL('../../web/src/lib/chatSettings.js', import.meta.url));

  test('every read and write is guarded', () => {
    // Private browsing and disabled storage both throw on access, and a
    // settings module that can stop the app rendering is worse than none.
    const reads = settings.match(/localStorage\.(getItem|setItem)/g) ?? [];
    assert.ok(reads.length >= 2, 'expected a read and a write to guard');
    assert.equal((settings.match(/try \{/g) ?? []).length, reads.length);
  });

  test('a hostile stored value becomes the default, never a broken hold', () => {
    // User-writable storage. A string where a number goes must not produce a
    // hold of NaN seconds, which would never elapse and never send.
    assert.match(settings, /UNDO_CHOICES\.includes\(raw\.undoWindowSeconds\)/);
    assert.match(settings, /SEND_KEY_CHOICES\.includes\(raw\.sendKey\)/);
  });
});

describe('the settings are reachable', () => {
  test('the panel is mounted on the account page', () => {
    assert.match(account, /<ChatSettings \/>/);
    assert.match(account, /from '\.\.\/components\/ChatSettings\.jsx'/);
  });

  test('every control is labelled and grouped', () => {
    // A bare radio with text beside it is not a label, and a group of radios
    // without a legend is a list of unexplained choices to a screen reader.
    assert.match(panel, /<fieldset/);
    assert.match(panel, /<legend>/);
    assert.equal((panel.match(/<label/g) ?? []).length >= 2, true);
  });

  test('a change saves itself, with no button to forget to press', () => {
    assert.match(panel, /writeChatSettings\(\{ \.\.\.settings, \.\.\.patch \}\)/);
    assert.doesNotMatch(panel, /type="submit"/);
  });
});
