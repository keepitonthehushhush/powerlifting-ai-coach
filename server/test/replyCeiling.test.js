import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';
import { RECORDABLE_STOP_REASONS, recordableStopReason } from '../src/lib/coachOutcome.js';
import { DEFAULT_MAX_TOKENS } from '../src/lib/modelBudget.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

/**
 * ── THE MEASUREMENT THIS FILE EXISTS FOR ──────────────────────────────────
 *
 * usage_events on 2026-09-14: 5 of the 101 replies this product has ever
 * produced came back at exactly 8192 output tokens, and 7 were at or above
 * 7000. Landing exactly on max_tokens is the definition of truncation, and
 * the tail of a coaching reply is where the cool-down, the accessory work and
 * the machine-readable program block all are.
 *
 * The athlete was already being told. Nobody could count it.
 */
const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));
const page = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const prompt = readFileSync(new URL('../src/prompts/systemPrompt.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../supabase/migrations/0073_how_the_reply_ended_belongs_next_to_what_it_cost.sql', import.meta.url),
  'utf8',
);

describe('the stop reason is recorded, from a closed set of our own', () => {
  test('a reason we recognize is stored as itself', () => {
    for (const reason of RECORDABLE_STOP_REASONS) {
      assert.equal(recordableStopReason(reason), reason);
    }
  });

  test('a reason we do not recognize becomes other, never passes through', () => {
    // A vendor is free to add a stop reason tomorrow. It is not free to start
    // writing values into our table.
    assert.equal(recordableStopReason('some_new_vendor_reason'), 'other');
    assert.equal(recordableStopReason('DROP TABLE'), 'other');
  });

  test('absent stays absent, and does not become other', () => {
    // "The reply carried no stop reason" and "it stopped for a reason we have
    // no name for" are different facts. Collapsing them would turn a silence
    // into a finding.
    assert.equal(recordableStopReason(null), null);
    assert.equal(recordableStopReason(undefined), null);
  });

  test('THE CODE AND THE DATABASE AGREE ABOUT THE SET', () => {
    /*
     * Two lists for one rule is how this repository has been bitten before:
     * a CHECK constraint widened without the code that feeds it produced an
     * integration that worked and audited nothing. The pairing is asserted,
     * not remembered.
     */
    const check = migration.slice(migration.indexOf('usage_events_stop_reason_check', migration.indexOf('add constraint')));
    assert.ok(check.length > 0, 'the constraint is gone - this check did not run');
    const inDb = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(inDb.length >= 7, `only found ${inDb.length} values in the CHECK - this check did not run`);
    assert.deepEqual(
      [...inDb].sort(),
      [...RECORDABLE_STOP_REASONS, 'other'].sort(),
      'the CHECK and RECORDABLE_STOP_REASONS have drifted apart',
    );
  });

  test('the usage row carries it, mapped rather than raw', () => {
    const from = chatRoute.indexOf("from('usage_events').insert({");
    const to = chatRoute.indexOf('});', from);
    assert.notEqual(from, -1, 'the usage write is gone - this check did not run');
    const insert = chatRoute.slice(from, to);
    assert.match(insert, /cost_microdollars/, 'the wrong block was sliced - this check did not run');
    assert.match(insert, /stop_reason: recordableStopReason\(reply\.stopReason\)/);
    assert.ok(
      !/stop_reason: reply\.stopReason/.test(insert),
      'the vendor string is being written straight into the table',
    );
  });
});

describe('the ceiling', () => {
  test('is above the value that was being hit', () => {
    // Not a magic number for its own sake: 8192 is the value five real replies
    // landed on exactly.
    assert.ok(DEFAULT_MAX_TOKENS > 8192, `the ceiling is still ${DEFAULT_MAX_TOKENS}`);
  });

  test('is below the point where a full reply outruns the client', () => {
    /*
     * Not a model limit - Sonnet 5 permits 128K of output, checked against the
     * documentation rather than remembered. What limits this is a person
     * holding a phone, and the fix for a reply that needs more room is the
     * prompt rule, not another doubling.
     */
    assert.ok(DEFAULT_MAX_TOKENS <= 16384, 'raising this past 16384 needs the client timeout raised first');
  });

  test('AND THE TIME CEILING MOVED WITH IT', () => {
    /*
     * The mistake this catches was made in the first draft of this very
     * change: max_tokens raised alone, with a comment claiming 150 seconds was
     * a bound to stay under.
     *
     * error_events says otherwise - two client_request_timed_out rows on
     * 2026-09-11, at 18:22 and 21:04, alongside the truncation at 18:31. The
     * 150-second wall was already being hit AT the old token ceiling. Raising
     * one ceiling and not the other turns a reply that was cut short and
     * delivered into a reply that never arrives, which is strictly worse: no
     * words at all, and no notice, because a timeout has nothing to attach one
     * to.
     *
     * So the two numbers are pinned to each other here rather than in a
     * comment. A comment saying they move together is not a control.
     */
    const api = readFileSync(new URL('../../web/src/lib/api.js', import.meta.url), 'utf8');
    const chatTimeout = Number(api.match(/chat: (\d+)_000/)?.[1]);
    assert.ok(Number.isFinite(chatTimeout), 'the chat timeout is no longer readable - this check did not run');
    assert.ok(
      chatTimeout > 150,
      `the output ceiling is ${DEFAULT_MAX_TOKENS} and the browser still gives up at ${chatTimeout}s - ` +
        'replies were already timing out at 8192, so this converts truncations into timeouts',
    );

    // And the browser must still give up before the platform does, or a
    // timeout reaches the page as a connection dying rather than a message.
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    assert.ok(
      chatTimeout < vercel.functions['api/index.js'].maxDuration,
      'the server would give up before the browser',
    );
  });

  test('and the reassurance shown during a long wait does not promise a duration', () => {
    /*
     * It said "a full training week takes a minute or so" while real replies
     * were running past 150 seconds and timing out. A reassurance that is
     * wrong is worse than none: it tells the person something has broken at
     * the exact moment nothing has.
     */
    for (const [name, catalog] of [['en', en], ['es', es]]) {
      assert.ok(catalog.chat.thinkingLong, `chat.thinkingLong is missing from ${name}.js`);
      assert.ok(
        !/\bminut/i.test(catalog.chat.thinkingLong),
        `${name}.js still promises a duration during a wait that can run to four minutes`,
      );
    }
  });

  test('AND .env.example CARRIES THE SAME NUMBER', () => {
    /*
     * The env var overrides the constant, and `.env.example` is what gets
     * copied into a deployment's environment. So a constant raised here while
     * the example file still says 8192 changes nothing in production, and the
     * symptom is the feature quietly not working while every test passes -
     * this project's recurring defect, one line away from being shipped again.
     *
     * env.test.js has a comment saying the two move together. A comment is not
     * a control; this is.
     */
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const match = example.match(/^ANTHROPIC_MAX_TOKENS=(\d+)$/m);
    assert.ok(match, 'ANTHROPIC_MAX_TOKENS is gone from .env.example - this check did not run');
    assert.equal(
      Number(match[1]),
      DEFAULT_MAX_TOKENS,
      'the documented default and the code default have drifted - a deployment copying .env.example would override the constant',
    );
  });

  test('and the reason it was raised is recorded next to it', () => {
    const source = readFileSync(new URL('../src/lib/modelBudget.js', import.meta.url), 'utf8');
    assert.match(source, /TIMEOUTS\.chat/, 'nothing points the next reader at the client timeout');
    assert.match(source, /0073/, 'nothing points at the column that makes this countable');
  });
});

describe('the prompt stops the coach saying the week three times', () => {
  test('the rule is present', () => {
    assert.match(prompt, /SAY EACH THING ONCE/);
  });

  test('and it does not contradict the rule that the block carries every day', () => {
    /*
     * "A contradiction left in a prompt is resolved by the model, not by you."
     * A rule that says "say each thing once" sitting above a rule that says
     * "restate every day of the current program in the block" is exactly that
     * shape, and the model would pick a side per reply. The reconciliation has
     * to be IN the text.
     */
    const at = prompt.indexOf('SAY EACH THING ONCE');
    const section = prompt.slice(at, prompt.indexOf('## THE BLOCK IS THE WHOLE PROGRAM', at));
    assert.ok(section.length > 200, 'the section is gone - this check did not run');
    assert.match(section, /PROSE AND NOT ABOUT THE BLOCK/, 'the rule does not say which case it governs');
  });
});

describe('the athlete can ask for the rest in one tap', () => {
  test('the page learns it from a boolean, not from matching the prose', () => {
    /*
     * The reply carries a sentence saying it was cut off, and that sentence is
     * stored with the conversation where it belongs. Recognizing it by string
     * match would stop working the first time somebody reworded it, silently.
     */
    assert.match(chatRoute, /\.\.\.\(outcome\.truncated \? \{ truncated: true \} : \{\}\)/);
    assert.match(page, /setReplyTruncated\(result\.truncated === true\)/);
    assert.ok(
      !/includes\('ran out of room'\)|indexOf\('ran out of room'\)/.test(page),
      'the page is string-matching the truncation notice',
    );
  });

  test('the button FILLS the composer and sends nothing', () => {
    // Same rule the openers follow: the athlete sees the words going out under
    // their name before they go, a mis-tap costs nothing, and it sidesteps
    // whether finishing a cut-off reply should spend a trial reply.
    const at = page.indexOf('className="continue-cut"');
    assert.ok(at > 0, 'the control is gone - this check did not run');
    const block = page.slice(at, page.indexOf('</div>', at));
    assert.match(block, /setDraft\(t\('chat\.continueDraft'\)\)/);
    assert.ok(!/api\.|sendMessage|submit/.test(block), 'tapping it sends a message');
  });

  test('and the copy exists in both languages', () => {
    for (const key of ['truncated', 'continueCut', 'continueDraft']) {
      assert.ok(en.chat[key], `chat.${key} is missing from en.js`);
      assert.ok(es.chat[key], `chat.${key} is missing from es.js`);
      assert.notEqual(es.chat[key], en.chat[key], `chat.${key} was never translated`);
    }
  });
});
