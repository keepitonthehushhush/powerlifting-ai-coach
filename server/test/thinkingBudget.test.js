import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';
import { DEFAULT_EFFORT, EFFORT_LEVELS, resolveEffort } from '../src/lib/modelBudget.js';
import { describeCoachReply } from '../src/lib/coachOutcome.js';

const anthropic = readSource(new URL('../src/lib/anthropic.js', import.meta.url));
const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

/**
 * THE BUDGET IS SHARED WITH THINKING, AND NOBODY HAD BEEN TOLD.
 *
 * ── WHAT HAPPENED ─────────────────────────────────────────────────────────
 *
 * On 2026-09-11, in one evening: five of nine replies ended at EXACTLY 8192
 * output tokens, one request was abandoned by the browser after 150 seconds,
 * and one came back with `stop_reason: max_tokens`, `blockTypes: ["thinking"]`
 * and NO TEXT - the model had spent the entire budget thinking and written
 * nothing. The athlete saw an error and was billed $0.09 for it.
 *
 * Nothing in this codebase had asked for any of that. Claude Sonnet 5 runs
 * adaptive thinking ON by default where Sonnet 4.6 did not, `max_tokens` is a
 * hard limit on thinking plus text together, and the API's default effort is
 * `high`. The model changed underneath a configuration that was correct when
 * it was written.
 */

describe('effort is chosen rather than inherited', () => {
  test('the request sets it explicitly', () => {
    // Leaving it unset means `high` on a model that thinks by default, out of
    // the same budget the reply needs.
    assert.match(anthropic, /output_config: \{ effort: config\.anthropic\.effort \}/);
  });

  test('the default is low, and the reason is ADR-2', () => {
    /*
     * Not cost-cutting dressed as design. The progression, the deload rule,
     * the phase transition, the warm-up ramp, the plate math, the fueling
     * band and the program-versus-log comparison are all computed in ordinary
     * code and handed over as answers. The model is explaining a decision, not
     * making one - which is the case the effort documentation names for `low`.
     */
    assert.equal(DEFAULT_EFFORT, 'low');
    // readFileSync, not readSource: the justification lives in a comment, and
    // readSource strips those. An absence check against stripped source would
    // have passed whether or not the reasoning was ever written down.
    const budget = readFileSync(new URL('../src/lib/modelBudget.js', import.meta.url), 'utf8');
    assert.match(budget, /ADR-2/);
  });

  test('an unrecognized value falls back instead of reaching the API', () => {
    /*
     * The API rejects an unknown effort with a 400, so a typo in a deploy
     * variable would fail EVERY coaching reply. This project has shipped that
     * exact shape once already - CAPTCHA was switched on in a dashboard while
     * the deployed bundle carried no site key, and every signup was refused.
     */
    assert.equal(resolveEffort({ ANTHROPIC_EFFORT: 'enormous' }), DEFAULT_EFFORT);
    assert.equal(resolveEffort({ ANTHROPIC_EFFORT: '' }), DEFAULT_EFFORT);
    assert.equal(resolveEffort({}), DEFAULT_EFFORT);
    assert.equal(resolveEffort(), DEFAULT_EFFORT);
  });

  test('a recognized value is honored, in any case', () => {
    assert.equal(resolveEffort({ ANTHROPIC_EFFORT: 'medium' }), 'medium');
    assert.equal(resolveEffort({ ANTHROPIC_EFFORT: '  HIGH  ' }), 'high');
    for (const level of EFFORT_LEVELS) {
      assert.equal(resolveEffort({ ANTHROPIC_EFFORT: level }), level);
    }
  });

  test('the five levels are the five the API accepts', () => {
    assert.deepEqual([...EFFORT_LEVELS], ['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('a budget spent on thinking is retried without it', () => {
  const reply = (over) => ({
    text: '',
    stopReason: 'max_tokens',
    blockTypes: ['thinking'],
    usage: {},
    ...over,
  });

  test('no text and a thinking block asks for a retry with thinking off', () => {
    const outcome = describeCoachReply(reply());
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'coach_cut_short');
    assert.equal(outcome.retryWithoutThinking, true);
  });

  test('and NOT for an identical retry, which cannot work', () => {
    /*
     * The two flags mean opposite things about the same request. `retry` says
     * the identical call may succeed; `retryWithoutThinking` says it cannot,
     * and names the one change that makes it a different call. Setting both
     * would spend a call proving the first one wrong.
     */
    assert.equal(describeCoachReply(reply()).retry, false);
  });

  test('a truncated reply that DID produce text is still delivered, not retried', () => {
    // The athlete gets the words and is told they stop early. Retrying would
    // throw away a usable answer and charge for the privilege.
    const outcome = describeCoachReply(reply({ text: 'Squat 3x5 at 225.' }));
    assert.equal(outcome.ok, true);
    assert.equal(outcome.truncated, true);
    assert.ok(!outcome.retryWithoutThinking);
  });

  test('the route actually disables thinking on that retry', () => {
    assert.match(chat, /outcome\.retryWithoutThinking/);
    assert.match(chat, /ask\(\{ thinking: \{ type: 'disabled' \} \}\)/);
  });

  test('it is still exactly one retry', () => {
    // Two is how a bad afternoon at the API becomes a bill. The two branches
    // are exclusive - an else-if, not a second block that can also run.
    assert.match(chat, /\} else if \(!outcome\.ok && outcome\.retryWithoutThinking\) \{/);
    // Three call sites: the first attempt, and two retry branches that an
    // else-if makes mutually exclusive. So at most one retry ever runs.
    const callSites = (chat.match(/(?:let )?reply = await ask\(/g) ?? []).length;
    assert.equal(callSites, 3, `${callSites} ask() call sites - a third retry path has appeared`);
    assert.equal((chat.match(/let reply = await ask\(/g) ?? []).length, 1);
  });

  test('the retry is recorded under its own name', () => {
    // "The coach returned nothing" and "the coach thought until there was no
    // room left to answer" are different mornings and must not share a line.
    assert.match(chat, /coach\.thinking_exhausted_budget/);
  });
});

describe('the suite grades the coach that is deployed', () => {
  test('the safety evaluation sends the same effort production sends', () => {
    /*
     * modelBudget.js exists because this suite once graded at max_tokens 2048
     * while production served 8192, and turned three cut-off replies into
     * three safety findings. Effort is the same hazard with a newer name: it
     * changes how much the model thinks, how long the answer runs, and how
     * much budget is left for text.
     */
    const evalScript = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));
    assert.match(evalScript, /resolveEffort/);
    assert.match(evalScript, /output_config: \{ effort: EFFORT \}/);
    assert.doesNotMatch(evalScript, /effort: '(low|medium|high|xhigh|max)'/, 'the suite hardcodes its own effort');
  });

  test('and neither side hardcodes a token budget either', () => {
    const evalScript = readSource(new URL('../../scripts/safety-eval.mjs', import.meta.url));
    assert.match(evalScript, /resolveMaxTokens/);
    assert.doesNotMatch(evalScript, /max_tokens: \d+/);
  });
});

describe('a manual thinking budget is never reintroduced', () => {
  test('nothing asks for the parameter the model rejects', () => {
    // `{type:'enabled', budget_tokens:N}` is no longer supported on this model
    // and returns a 400 - which is one of the two shapes a 400 can take here.
    assert.doesNotMatch(anthropic, /budget_tokens/);
    assert.doesNotMatch(chat, /budget_tokens/);
  });

  test('thinking is omitted on the normal path so adaptive decides', () => {
    // Passing `{type:'adaptive'}` explicitly would be the same thing with more
    // to keep in step; effort is the lever, and it is set.
    assert.match(anthropic, /\.\.\.\(thinking \? \{ thinking \} : \{\}\)/);
  });
});

describe('the platform is given room the browser will not wait for anyway', () => {
  test('the function duration is pinned rather than inherited', () => {
    /*
     * Vercel's default is 300 seconds today and defaults are somebody else's
     * decision. Pinned so a platform change cannot quietly shorten it - and
     * pinned at the ceiling because the constraint that actually bites is the
     * browser's 150-second abort, not the server's.
     */
    assert.equal(vercel.functions['api/index.js'].maxDuration, 300);
  });

  test('the browser gives up first, and that is deliberate', () => {
    const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
    const chatTimeout = Number(api.match(/chat: (\d+)_000/)?.[1]);
    assert.ok(Number.isFinite(chatTimeout), 'the chat timeout is no longer readable');
    assert.ok(
      chatTimeout * 1000 < vercel.functions['api/index.js'].maxDuration * 1000,
      'the server would give up before the browser, so a timeout would look like a crash'
    );
  });
});
