import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import { parseCoachMarkdown, parseInline } from '../../web/src/lib/coachMarkdown.js';

/*
 * Comments stripped, and that is not a detail. The first run of this file
 * failed because CoachMessage's own doc comment says the words "no
 * dangerouslySetInnerHTML", and an absence assertion matched the sentence
 * explaining the absence. That is the fourth time this codebase has made that
 * mistake, which is why helpers/source.js exists.
 */
const component = readSource(new URL('../../web/src/components/CoachMessage.jsx', import.meta.url));
const chatPage = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));

/** A real reply, copied verbatim out of the adversarial evaluation output. */
const REAL_REPLY = `Good, let's get you started. Here's what I've got already: brand new to training.

One thing before I write anything: is anything hurting, or has anything hurt recently?

**Day A**
- Squat: 3x5 @ 95
- Bench Press: 3x5 @ 75
- Deadlift: 1x5 @ 135

**Day B**
- Squat: 3x5 @ 100
- Overhead Press: 3x5 @ 45 (bar only to start)

Notes:
- Rest 2-3 minutes between working sets.
- Film your squat from the side if you can.

Log how each session feels and I'll adjust.`;

describe('A TRAINING WEEK COMES OUT AS A TRAINING WEEK', () => {
  const blocks = parseCoachMarkdown(REAL_REPLY);

  test('no asterisk survives into the rendered text', () => {
    // This is the whole complaint: `**Day A**` was reaching the screen with
    // its asterisks, and an athlete had to decode a program before following
    // it.
    const flatten = (bs) =>
      bs.flatMap((b) => {
        if (b.type === 'list') return b.items.flat();
        if (b.type === 'table') return [...b.header.flat(), ...b.rows.flat().flat()];
        return b.spans;
      });
    for (const span of flatten(blocks)) {
      assert.doesNotMatch(span.value, /\*\*/, `asterisks survived in: ${span.value}`);
    }
  });

  test('the day labels became headings', () => {
    const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.spans[0].value);
    assert.deepEqual(headings, ['Day A', 'Day B']);
  });

  test('the lifts became list items, in order, one per lift', () => {
    const lists = blocks.filter((b) => b.type === 'list');
    assert.equal(lists.length, 3, `expected three lists, found ${lists.length}`);
    assert.equal(lists[0].items.length, 3);
    assert.equal(lists[0].items[0][0].value, 'Squat: 3x5 @ 95');
    assert.equal(lists[1].items.length, 2);
  });

  test('prose stayed prose', () => {
    const paragraphs = blocks.filter((b) => b.type === 'paragraph');
    assert.ok(paragraphs.length >= 3);
    assert.match(paragraphs[0].spans[0].value, /^Good, let's get you started/);
  });
});

describe('the constructs the coach actually emits', () => {
  test('numbered lists keep their order and drop the numerals', () => {
    const [list] = parseCoachMarkdown('1. Check the weight class\n2. Call the meet director');
    assert.equal(list.type, 'list');
    assert.equal(list.ordering, 'ordered');
    assert.deepEqual(list.items.map((i) => i[0].value), ['Check the weight class', 'Call the meet director']);
  });

  test('a bullet list is not turned into a numbered one', () => {
    const [list] = parseCoachMarkdown('- one\n- two');
    assert.equal(list.ordering, 'unordered');
  });

  test('a meet-prep table parses into rows', () => {
    const [table] = parseCoachMarkdown(
      '| Block | Weeks | Focus |\n|---|---|---|\n| Volume | 1-4 | 70-80% |\n| Peak | 9-10 | Singles |'
    );
    assert.equal(table.type, 'table');
    assert.deepEqual(table.header.map((c) => c[0].value), ['Block', 'Weeks', 'Focus']);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[1][0][0].value, 'Peak');
  });

  test('a pipe in ordinary prose is not a table', () => {
    // Without the divider requirement, "squat | bench | deadlift" in a
    // sentence would silently become a one-row table.
    const [block] = parseCoachMarkdown('We can work squat | bench | deadlift in any order.');
    assert.equal(block.type, 'paragraph');
  });

  test('inline bold, italic and code inside a sentence', () => {
    const spans = parseInline('Add **5lb** to the _top_ set, logged as `3x5`.');
    assert.deepEqual(
      spans.map((s) => s.type),
      ['text', 'bold', 'text', 'italic', 'text', 'code', 'text']
    );
    assert.equal(spans[1].value, '5lb');
    assert.equal(spans[5].value, '3x5');
  });

  test('an underscore inside a word is not italics', () => {
    // `health_restrictions` and `program_data` appear in coaching prose.
    const spans = parseInline('the health_restrictions field');
    assert.equal(spans.length, 1);
    assert.equal(spans[0].value, 'the health_restrictions field');
  });

  test('empty and nullish input produce nothing, not a crash', () => {
    assert.deepEqual(parseCoachMarkdown(''), []);
    assert.deepEqual(parseCoachMarkdown(null), []);
    assert.deepEqual(parseCoachMarkdown(undefined), []);
  });

  test('an unsupported construct falls through as text rather than vanishing', () => {
    const blocks = parseCoachMarkdown('> a blockquote the coach has never sent');
    assert.equal(blocks.length, 1);
    assert.match(blocks[0].spans[0].value, /blockquote/);
  });
});

describe('MODEL OUTPUT NEVER BECOMES MARKUP', () => {
  test('the renderer has no HTML string anywhere in it', () => {
    // The coach quotes profile fields back, and an athlete types those. The
    // path from "a user typed it" to "the browser ran it" must not exist,
    // rather than exist behind a sanitiser that has to be right every time.
    assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(component, /innerHTML/);
    assert.doesNotMatch(chatPage, /dangerouslySetInnerHTML/);
  });

  test('a script tag in a reply stays text', () => {
    const [block] = parseCoachMarkdown('<script>alert(1)</script>');
    assert.equal(block.type, 'paragraph');
    assert.equal(block.spans[0].value, '<script>alert(1)</script>');
  });

  test('the athlete is not reformatted, only the coach', () => {
    // Turning somebody's own asterisks into bold is editing what they said.
    assert.match(chatPage, /message\.role === 'user' \? \(/);
    assert.match(chatPage, /<CoachMessage text=\{message\.content\} \/>/);
  });
});

describe('THE UNDO WINDOW IS REAL, NOT COSMETIC', () => {
  test('the pause happens before dispatch, not during it', () => {
    // Aborting mid-flight would not undo anything: the server saves the reply
    // before it answers, so a cancelled request still costs money and still
    // appears on the next load. Cancelling is only honest before the send.
    const sendFn = chatPage.slice(chatPage.indexOf('function send(event)'), chatPage.indexOf('function undoSend'));
    assert.doesNotMatch(sendFn, /api\.sendMessage/, 'send() dispatches immediately');
    assert.match(sendFn, /setHolding\(/);
    assert.match(chatPage, /async function dispatch\(text, optimistic\)/);
  });

  test('undoing restores the text and removes the optimistic message', () => {
    const undo = chatPage.slice(chatPage.indexOf('function undoSend'), chatPage.indexOf('return (\n    <div className="page chat-page">'));
    assert.match(undo, /clearTimeout/);
    assert.match(undo, /setDraft\(held\.text\)/);
    assert.match(undo, /prev\.filter\(\(m\) => m !== held\.optimistic\)/);
    assert.match(undo, /inputRef\.current\?\.focus\(\)/);
  });

  test('a second send cannot start while one is held', () => {
    assert.match(chatPage, /if \(!text \|\| busy \|\| holding !== null\) return;/);
    // Spelling-tolerant on purpose: `holding` and `holding !== null` are the
    // same guard, and pinning one of them makes the test about the source
    // rather than about the behaviour. What must hold is that the send button
    // is disabled while a message is held, and that `holding` is what does it.
    const disabled = chatPage.match(/<button type="submit"[^>]*disabled=\{([^}]*)\}/);
    assert.ok(disabled, 'the submit button could not be found - this check did not run');
    assert.match(disabled[1], /\bholding\b/, 'the button ignores a held message');
    assert.match(disabled[1], /\bbusy\b/);
  });

  test('a held message is abandoned if the page goes away', () => {
    assert.match(chatPage, /useEffect\(\(\) => \(\) => clearTimeout\(holdRef\.current\), \[\]\)/);
  });
});

describe('THE WAIT REPORTS A FACT, NOT A PREDICTION', () => {
  test('it counts up, because nothing here knows how long a reply takes', () => {
    // A countdown would have to invent a duration. One that reaches zero
    // while the athlete is still waiting is a confident answer from something
    // that never looked - the defect this project keeps finding.
    assert.match(chatPage, /setElapsed\(Math\.floor\(\(Date\.now\(\) - started\) \/ 1000\)\)/);
    assert.match(chatPage, /thinkingElapsed/);
  });

  test('a long wait says so rather than looking identical to a short one', () => {
    assert.match(chatPage, /elapsed >= LONG_WAIT_SECONDS/);
    assert.match(chatPage, /thinkingLong/);
  });
});
