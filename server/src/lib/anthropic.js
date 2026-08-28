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
export async function createCoachReply(system, messages) {
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens,
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
