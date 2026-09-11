import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

/**
 * A single shared client. The Anthropic SDK is stateless and holds a keep-alive
 * connection pool, so reusing one instance across warm serverless invocations
 * saves a TLS handshake per request.
 *
 * This module is the ONLY place in the codebase that holds the API key, and it
 * is only ever imported by server-side code. Nothing under web/ imports it, and
 * nothing under web/ can - the key is not a VITE_ variable, so it does not
 * exist in the browser build at all. scripts/scan-bundle-for-secrets.mjs
 * verifies that claim against the actual compiled output rather than trusting
 * it.
 */
const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * @param {Array<{type:'text',text:string,cache_control?:object}>} system
 *   The system prompt as content blocks. An array rather than a string so the
 *   static prefix can carry a cache breakpoint - see buildSystemBlocks().
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @returns {Promise<{text:string, usage:object, stopReason:string}>}
 */
export async function createCoachReply(system, messages, { thinking = null } = {}) {
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens,
    /*
     * ── EFFORT IS SET, NOT LEFT TO THE DEFAULT ────────────────────────────
     *
     * Claude Sonnet 5 runs ADAPTIVE THINKING ON BY DEFAULT - a request with no
     * `thinking` field thinks, where the same request on Sonnet 4.6 did not -
     * and `max_tokens` is a hard limit on thinking PLUS text together. The API
     * default effort is `high`.
     *
     * Which is how 2026-09-11 happened. Five of nine replies that evening
     * ended at exactly 8192 tokens, and one spent the ENTIRE budget thinking
     * and produced no text at all: stop_reason max_tokens, blockTypes
     * ["thinking"], hadText false. The athlete got an error and was billed for
     * it. Nothing in this codebase had asked for any of that; it arrived with
     * the model.
     *
     * `low` is what the effort documentation recommends for latency-sensitive
     * chat, and it is the right level here for a reason specific to this
     * product: ADR-2. The progression, the deload rule, the warm-up ramp, the
     * plate math, the fueling ranges and the adherence cross-reference are all
     * computed in ordinary code and handed to the model as ANSWERS. The model
     * is not being asked to work anything out. It is being asked to explain a
     * decision that has already been made, in the athlete's language, kindly.
     * Paying `high` for reasoning that has already happened elsewhere buys
     * latency and truncation and nothing else.
     */
    output_config: { effort: config.anthropic.effort },
    /*
     * Omitted on the normal path so adaptive thinking decides for itself, at
     * the effort above. Passed as `{ type: 'disabled' }` on the ONE retry that
     * follows a budget exhausted by thinking - see routes/chat.js. Manual
     * budgets (`{type:'enabled', budget_tokens}`) are rejected with a 400 on
     * this model and must never be reintroduced.
     */
    ...(thinking ? { thinking } : {}),
    system,
    messages,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return {
    text,
    usage: response.usage,
    stopReason: response.stop_reason,
    /**
     * ── WHY THESE TWO ARE RETURNED ────────────────────────────────────────
     *
     * A reply came back with no text and the route threw "The coach returned
     * an empty response", which is a description of the symptom and contains
     * no information. The response was carrying the reason the whole time and
     * this function dropped it on the floor.
     *
     * `stop_reason: "refusal"` arrives as a normal HTTP 200 with no usable
     * text - Anthropic's safety classifiers return it that way deliberately -
     * so a refusal and a genuine blank are indistinguishable downstream unless
     * the stop reason travels with them. `stop_details` names the policy
     * category when there is one.
     *
     * `blockTypes` is the other half: it separates "the model said nothing"
     * from "the model produced only blocks we do not read", which is what a
     * truncated response looks like when the tokens went somewhere other than
     * text. Types only - never the contents, which is the athlete's
     * conversation.
     */
    stopDetails: response.stop_details ?? null,
    blockTypes: response.content.map((block) => block.type),
    model: response.model,
  };
}
