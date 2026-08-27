/**
 * Checks a password against Have I Been Pwned's corpus of breached passwords,
 * without ever sending the password or its full hash anywhere.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Supabase Auth has this built in - it checks new passwords against HIBP - but
 * it is a paid-plan feature, and this project is on the free tier until it has
 * revenue to justify otherwise. The protection matters more than where it
 * comes from, and the same corpus is available to anyone for free, so it is
 * implemented here instead.
 *
 * This is the highest-value password control there is, and it is worth being
 * clear about why. Password RULES - length, mixed case, a symbol - defend
 * against somebody guessing. They do nothing at all against the attack that
 * actually succeeds, which is an attacker taking a password from somebody
 * else's breach and trying it here. `Tr0ub4dor&3` satisfies every rule in
 * passwordPolicy.js and appears in breach corpora hundreds of thousands of
 * times. A rules check calls it strong. This calls it what it is.
 *
 * ── HOW k-ANONYMITY WORKS, AND WHY THIS IS NOT A PRIVACY REGRESSION ───────
 *
 * The password is SHA-1'd in the browser. Only the FIRST FIVE hex characters
 * of that hash are sent. The service returns roughly 800 hash suffixes that
 * share that prefix, and the comparison happens locally. The service therefore
 * learns five hex characters - one of 1,048,576 buckets - and nothing else. It
 * never sees the password, never sees the full hash, never sees an email
 * address, and is sent no cookie or identifier of any kind.
 *
 * That distinction is load-bearing for this codebase. We refused to embed a
 * third-party video player on privacy grounds, on a product that holds health
 * data, and it would be inconsistent to then wave through any outbound request
 * at all. So the reasoning is written down rather than assumed: an embed loads
 * executing code, sets cookies, and identifies the reader across the web. This
 * sends five characters and receives a list of hashes. They are not the same
 * category of thing, and the second one is what makes the first one's refusal
 * credible rather than reflexive.
 *
 * `Add-Padding: true` is sent so every response contains a random 800-1000
 * records. Without it the SIZE of the response is itself a weak signal about
 * which prefix was requested. Padding entries come back with a count of 0 and
 * are filtered out below.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * This runs in the browser, because sign-up goes from the browser straight to
 * Supabase Auth and our own API is not in that path. So it is ADVISORY: an
 * attacker scripting against the Auth endpoint bypasses it entirely.
 *
 * That is the correct trade rather than a shortcut. The threat this addresses
 * is not "an attacker chooses a weak password for an account they control" -
 * that harms nobody but them. It is "an honest person reuses a password that
 * is already in a breach corpus, and gets credential-stuffed six months
 * later". A browser-side check meets that threat completely. Moving it
 * server-side would mean routing sign-up through our Express API, which adds a
 * failure mode to the one flow that must never break, in exchange for
 * defending against an attacker who is only attacking themselves.
 *
 * ── FAILING OPEN, DELIBERATELY ────────────────────────────────────────────
 *
 * If the network call fails, this returns `unknown` and sign-up proceeds. A
 * third party being down must never be the reason somebody cannot create an
 * account. But `unknown` is distinct from `safe`, and the caller is expected
 * to say "could not check" rather than quietly implying a pass - the same
 * reasoning as the rate limiter, which also fails open and says so.
 */

const ENDPOINT = 'https://api.pwnedpasswords.com/range/';

/** Beyond this many appearances, "seen in breaches" understates it. */
export const VERY_COMMON_THRESHOLD = 1000;

/**
 * SHA-1 via the Web Crypto API, uppercase hex.
 *
 * SHA-1 is the right algorithm here and its brokenness is irrelevant: it is
 * not protecting anything, it is an index into a public corpus that is keyed
 * by SHA-1. Using something stronger would simply fail to match.
 */
export async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Splits a hash into the part that is sent and the part that never is.
 * Exported so a test can assert the boundary rather than trusting it.
 */
export function splitHash(hash) {
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

/** Parses the `SUFFIX:COUNT` lines, dropping the zero-count padding rows. */
export function parseRanges(body) {
  const counts = new Map();
  for (const line of body.split('\n')) {
    const [suffix, rawCount] = line.trim().split(':');
    if (!suffix) continue;
    const count = Number.parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    counts.set(suffix.toUpperCase(), count);
  }
  return counts;
}

/**
 * @param {string} password
 * @param {typeof fetch} [fetchImpl] injectable so tests never touch the network
 * @returns {Promise<{status: 'safe'|'breached'|'unknown', count: number}>}
 */
export async function checkPwned(password, fetchImpl = globalThis.fetch) {
  if (typeof password !== 'string' || password.length === 0) {
    return { status: 'unknown', count: 0 };
  }

  try {
    const { prefix, suffix } = splitHash(await sha1Hex(password));
    const response = await fetchImpl(`${ENDPOINT}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      // No credentials, ever. There is nothing here to authenticate and a
      // cookie would defeat the entire point of the k-anonymity model.
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'unknown', count: 0 };

    const count = parseRanges(await response.text()).get(suffix) ?? 0;
    return count > 0 ? { status: 'breached', count } : { status: 'safe', count: 0 };
  } catch {
    // Offline, blocked, DNS failure, a corporate proxy. None of those are the
    // person's fault and none of them should stop them signing up.
    return { status: 'unknown', count: 0 };
  }
}
