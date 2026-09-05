/**
 * What a model call actually cost, in money.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Every fixed cost in this product is currently zero - Supabase and Vercel are
 * both on free tiers. The ONLY variable cost is this: tokens, charged per
 * conversation. That single number decides whether a subscription price is
 * viable, what a free tier can contain without bleeding, and whether the thing
 * can be a business at all. Until it is measured, every pricing decision is a
 * guess wearing a spreadsheet.
 *
 * It is also the number that rules out advertising, and it is worth being able
 * to show that rather than assert it: ad revenue is earned per pageview while
 * this cost is incurred per conversation, so under an ad model the most
 * engaged athletes are the most expensive ones. That is a structural
 * inversion, not a tuning problem, and it is visible the moment you have this
 * figure per user.
 *
 * ── MICRODOLLARS, NOT FLOATS ──────────────────────────────────────────────
 *
 * Costs are returned and stored as integer MICRODOLLARS - millionths of a US
 * dollar. A single reply can cost a fraction of a cent, and summing thousands
 * of IEEE-754 doubles to answer "what did last month cost" accumulates error
 * in exactly the digit you care about. Postgres stores a bigint, JavaScript
 * does integer arithmetic, and the division into dollars happens once, at the
 * point of display.
 *
 * ── UNKNOWN MODELS RETURN NULL, NEVER ZERO ────────────────────────────────
 *
 * ANTHROPIC_MODEL is a deploy variable precisely so the model can change
 * without a code change. That means this table WILL go stale, and the failure
 * mode has to be safe. A missing entry returns null, and a null is rendered as
 * "unknown" and excluded from totals. Returning 0 would silently under-report
 * spend and the first sign of trouble would be the invoice.
 *
 * Prices are per MILLION tokens, in USD, from the published Anthropic pricing
 * page. They are checked in with a date because a hardcoded price is a fact
 * about a moment, and the next person needs to know how old this is.
 */

/** When this table was last checked against the published prices. */
export const PRICES_VERIFIED_ON = '2026-08-27';

/** USD per million tokens. */
export const MODEL_PRICES = {
  'claude-opus-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
};

const MICRODOLLARS_PER_DOLLAR = 1_000_000;
const TOKENS_PER_PRICED_UNIT = 1_000_000;

/**
 * The API returns dated model ids - `claude-sonnet-5-20260115` - while the
 * table above is keyed by family. Longest matching prefix wins, so a new dated
 * release of a known family prices correctly without an edit here, and a
 * genuinely new family still falls through to null.
 */
export function priceFor(model) {
  if (typeof model !== 'string' || model.length === 0) return null;
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];

  let best = null;
  let bestLength = 0;
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(key) && key.length > bestLength) {
      best = price;
      bestLength = key.length;
    }
  }
  return best;
}

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * @param {object} usage the Anthropic response's usage object
 * @param {string} model
 * @returns {number|null} integer microdollars, or null if the model is unpriced
 */
export function costInMicrodollars(usage, model) {
  const price = priceFor(model);
  if (!price || !usage) return null;

  // Cache writes are billed at a premium and cache reads at a fraction of
  // input. Both are folded in here rather than ignored, because ignoring them
  // would make the measured cost wrong in the direction that flatters us.
  //
  // ── THE TWO WRITE PRICES ARE NOT THE SAME PRICE ───────────────────────────
  //
  // A 1-hour cache entry costs more to write than a 5-minute one - for
  // claude-sonnet-5, $4 against $2.50 per million. This used to charge every
  // write at the 5-minute rate, which was correct while that was the only kind
  // being made and became a 38% understatement of the largest single line in a
  // cold reply the moment a 1-hour breakpoint was used.
  //
  // `usage.cache_creation` splits them. It is not always present - an older
  // API version, or a response shape that changes under us - so the total in
  // `cache_creation_input_tokens` remains the fallback, priced at the CHEAPER
  // rate. Understating on a missing field is the wrong direction, and it is
  // chosen deliberately: the alternative is a cost line that jumps when a
  // field disappears, which reads as a price change rather than a data gap.
  // `cacheTtlHonored()` below is what actually notices.
  const creation = usage.cache_creation;
  const writeDollars = creation
    ? count(creation.ephemeral_1h_input_tokens) * price.cacheWrite1h +
      count(creation.ephemeral_5m_input_tokens) * price.cacheWrite5m
    : count(usage.cache_creation_input_tokens) * price.cacheWrite5m;

  const dollars =
    (count(usage.input_tokens) * price.input +
      count(usage.output_tokens) * price.output +
      writeDollars +
      count(usage.cache_read_input_tokens) * price.cacheRead) /
    TOKENS_PER_PRICED_UNIT;

  return Math.round(dollars * MICRODOLLARS_PER_DOLLAR);
}

/** For display only. Never sum these; sum the microdollars. */
export function formatMicrodollars(micro, { locale = 'en-US' } = {}) {
  if (!Number.isFinite(micro)) return null;
  const dollars = micro / MICRODOLLARS_PER_DOLLAR;
  return dollars.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dollars < 0.01 ? 6 : 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Did the cache entry we ASKED for actually get made?
 *
 * ── WHY THIS IS NOT PARANOIA ──────────────────────────────────────────────
 *
 * The 1-hour TTL has lived behind a beta header (`extended-cache-ttl-2025-04-11`
 * is still a named beta in the installed SDK) even though `ttl` sits on the
 * stable `CacheControlEphemeral` type. If the field is ignored rather than
 * refused, nothing fails: the request succeeds, a 5-minute entry is written,
 * and the only symptom is a cache that keeps missing and a bill that does not
 * improve. That is this project's whole defect pattern - a control that stops
 * working and produces no failure - so the request is not trusted, the
 * RESPONSE is read.
 *
 * @param {object} usage - the usage block from the API response.
 * @param {'5m'|'1h'} requested - the TTL the request asked for.
 * @returns {boolean|null} true when an entry of the requested kind was made,
 *   false when a write happened and it was the other kind, and null when
 *   there was no write at all (a pure cache hit, which says nothing) or the
 *   breakdown is absent.
 */
export function cacheTtlHonored(usage, requested = '1h') {
  const creation = usage?.cache_creation;
  if (!creation) return null;

  const oneHour = count(creation.ephemeral_1h_input_tokens);
  const fiveMinute = count(creation.ephemeral_5m_input_tokens);
  if (oneHour === 0 && fiveMinute === 0) return null;

  return requested === '1h' ? oneHour > 0 : fiveMinute > 0;
}
