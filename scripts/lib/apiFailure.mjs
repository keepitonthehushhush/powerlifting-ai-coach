/**
 * What an Anthropic API failure MEANS for a safety evaluation.
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────
 *
 * On 2026-09-01 the account ran out of credit mid-project and the eval printed
 * this:
 *
 *   FAIL  Active injury must trigger the clearance gate, not a workaround
 *   FAIL  Unsafe request: rapid extreme weight cut before a meet
 *   ... twenty-one more ...
 *   0/23 scenario runs passed.
 *
 * Nothing had been tested. Every one of those lines is a billing message, and
 * the summary - the part anybody reads after a long run - says the coach
 * failed twenty-three safety scenarios. A run in which the model was never
 * asked anything is not distinguishable, at a glance, from a total safety
 * regression, and the second reading is the one that costs a day.
 *
 * The harness already knew this shape. It stops on 401/403 with a written
 * explanation, because "a rejected key rejects every call" - the same
 * sentence is true of an empty balance, a bad model name, and a malformed
 * request, and none of those were classified. The rule was written for one
 * status code instead of for the category.
 *
 * It is the defect this project keeps finding, one layer lower than usual: a
 * check that answers confidently without looking. Here it answers "the coach
 * failed" without having asked the coach anything.
 *
 * So classification is a pure function, in its own file, with tests that need
 * no API key and no credit - which matters, because the day this was written
 * neither was available.
 */

/**
 * @param {number} status  HTTP status from the Anthropic API
 * @param {string} body    the response body, for the sub-kind
 * @returns {{retryable: boolean, unrunnable: boolean, kind: string}}
 *
 * `unrunnable` is the load-bearing one: it means the evaluation did not
 * happen, so nothing may be reported as a scenario result. `kind` only
 * chooses which explanation to print.
 */
export function classifyApiFailure(status, body = '') {
  const text = String(body ?? '');

  // 429 and 5xx are the transient ones. Everything else in 4xx will reject
  // every remaining call in exactly the same way.
  if (status === 429 || status >= 500) {
    return { retryable: true, unrunnable: false, kind: 'transient' };
  }

  if (status === 401 || status === 403) {
    return { retryable: false, unrunnable: true, kind: 'auth' };
  }

  /*
   * Matched on the message rather than the status, because billing arrives as
   * a 400 invalid_request_error - the same status as a genuinely malformed
   * request, and the two need different sentences. Both are unrunnable
   * either way, so a miss here degrades to the generic explanation rather
   * than to a wrong verdict.
   */
  if (/credit balance|billing|purchase credits|quota/i.test(text)) {
    return { retryable: false, unrunnable: true, kind: 'billing' };
  }

  if (status >= 400 && status < 500) {
    return { retryable: false, unrunnable: true, kind: 'request' };
  }

  // Anything else - a status nobody expected - is treated as unrunnable
  // rather than as a scenario failure, which is the safe direction: it says
  // "we do not know" instead of "the coach did this".
  return { retryable: false, unrunnable: true, kind: 'unknown' };
}

/** What to tell somebody who just hit this, per kind. */
export const UNRUNNABLE_ADVICE = {
  auth:
    'The API key was rejected, so every remaining scenario would be too.\n\n' +
    'This is a key problem, not a prompt problem. To be sure, send a key you KNOW is\n' +
    'invalid and compare - identical responses mean the real one is genuinely\n' +
    'unrecognized rather than mis-sent:\n\n' +
    '  curl -s -o /dev/null -w "%{http_code}\\n" https://api.anthropic.com/v1/models \\\n' +
    '    -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"\n\n' +
    'Where a working key comes from:\n' +
    '  - locally, .env, from https://console.anthropic.com/settings/keys\n' +
    '  - in CI, the ANTHROPIC_API_KEY repository secret\n' +
    '  - in production, the Vercel environment variable - which is marked sensitive\n' +
    '    and CANNOT be read back out, so a local .env copy drifts silently and this\n' +
    '    is how you find out.',
  billing:
    'The account has no credit, so every remaining scenario would fail the same way.\n\n' +
    'NOTHING WAS TESTED. This is not a result about the coach - whichever call ran\n' +
    'out of credit, the coach or the judge, nothing was graded, so the last real\n' +
    'verdict stands unchanged until this runs again.\n\n' +
    '  https://console.anthropic.com/settings/billing\n\n' +
    'A full run is 23 scenarios plus 62 judged assertions against a cheaper model.\n' +
    '`npm run safety:dry` checks every scenario builds and every deterministic check\n' +
    'runs, for free, and is worth doing before spending on a run.',
  request:
    'The API rejected the request itself, so every remaining scenario would be too.\n\n' +
    'NOTHING WAS TESTED. Check SAFETY_EVAL_MODEL and SAFETY_EVAL_JUDGE_MODEL against\n' +
    'the current model list - a retired or misspelled name arrives as a 400, and\n' +
    'reads exactly like this.',
  unknown:
    'The API returned a status this harness does not classify, so it stopped rather\n' +
    'than guess.\n\n' +
    'NOTHING WAS TESTED. Treat the message above as the finding, not the scenarios.',
};
