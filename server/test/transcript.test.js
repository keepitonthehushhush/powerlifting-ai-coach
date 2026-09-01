import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTurns } from '../../scripts/lib/transcript.mjs';

/**
 * Tests for the transcript the safety eval sends.
 *
 * A scenario's turns decide what conversation the coach is actually replying
 * to. Get that wrong and the eval still runs, still prints a reply, and still
 * grades it - against a conversation nobody wrote. The grader is tested for
 * the same reason; this is the input side of it.
 *
 * The rule these encode: a scripted assistant turn is a PREMISE the scenario
 * asserts, never evidence about the model. So it may sit in the middle, and
 * it may not be the first or the last thing in the transcript.
 */
describe('normalizeTurns', () => {
  test('a bare string is a message from the athlete', () => {
    assert.deepEqual(normalizeTurns(['Ready when you are.']), [
      { role: 'user', content: 'Ready when you are.' },
    ]);
  });

  test('a scripted assistant turn is carried through in place', () => {
    const messages = normalizeTurns([
      'my back grabs on squat day',
      { role: 'assistant', content: 'Is that pain, or tightness without pain?' },
      "It's pain.",
    ]);
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'user'],
    );
    assert.equal(messages[1].content, 'Is that pain, or tightness without pain?');
  });

  test('the transcript may not end on words we wrote', () => {
    // This is the one that matters. Ending on an assistant turn is a prefill:
    // the model continues OUR sentence, and the judge then grades a reply we
    // are half the author of. It would pass, and it would mean nothing.
    assert.throws(
      () => normalizeTurns(['what should I do?', { role: 'assistant', content: 'Here is week one:' }]),
      /continue our own words/,
    );
  });

  test('the transcript may not open on the coach speaking first', () => {
    assert.throws(
      () => normalizeTurns([{ role: 'assistant', content: 'Hello!' }, 'hi']),
      /does not speak first/,
    );
  });

  test('a misspelled role is refused rather than silently becoming a user turn', () => {
    // The failure this prevents: 'coach' quietly treated as the athlete, so a
    // scenario grades the coach's answer to a question the coach itself was
    // recorded as asking. Nothing about the output would look wrong.
    assert.throws(() => normalizeTurns(['hi', { role: 'coach', content: 'x' }, 'y']), /not "user" or "assistant"/);
    assert.throws(() => normalizeTurns(['hi', { role: 'system', content: 'x' }, 'y']), /not "user" or "assistant"/);
  });

  test('empty and malformed turns are refused', () => {
    assert.throws(() => normalizeTurns([]), /no turns to send/);
    assert.throws(() => normalizeTurns('not an array'), /no turns to send/);
    assert.throws(() => normalizeTurns(['   ']), /turn 1 is empty/);
    assert.throws(() => normalizeTurns(['hi', { role: 'user' }]), /turn 2 has no content/);
    assert.throws(() => normalizeTurns(['hi', null, 'y']), /neither a string nor/);
    assert.throws(() => normalizeTurns(['hi', 42, 'y']), /neither a string nor/);
  });

  test('the error names which turn is wrong', () => {
    // A scenario has up to a handful of turns and the message is read by
    // somebody who just broke one. "turn 3" beats "a turn".
    assert.throws(() => normalizeTurns(['a', 'b', { role: 'nope', content: 'c' }, 'd']), /turn 3/);
  });
});
