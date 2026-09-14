/**
 * What, if anything, to record about an arrival at a public page.
 *
 * ── WHY THE DECISION IS A PURE FUNCTION ───────────────────────────────────
 *
 * Everything that decides whether a visit is recordable, and what it is
 * reduced to, happens here with no network and no React. The component that
 * calls it does nothing but call it, so the rules are testable by running them
 * rather than by reading them.
 *
 * ── AN ALLOW-LIST, NEVER A DENY-LIST ──────────────────────────────────────
 *
 * `routeFor` returns null for anything not on the list, which means every
 * route added to this app in future is invisible to this until somebody
 * deliberately adds it. A deny-list would have the opposite default, and the
 * first authenticated page somebody forgot would be the one that leaked.
 *
 * Two public routes are deliberately absent. /reset-password and
 * /guardian/consent both carry a token in the URL, and while the token is
 * never stored, "somebody was on the password reset page at 14:02" is a fact
 * about one identifiable person. The question this exists to answer does not
 * need them.
 */
const RECORDABLE_ROUTES = Object.freeze([
  '/',
  '/login',
  '/about',
  '/faq',
  '/policies/privacy',
  '/policies/terms',
  '/policies/ai-processing',
  '/policies/health-data',
  '/policies/leaderboard',
  '/policies/guardian-consent',
]);

/** Exported so a test can hold this list and the migration's CHECK together. */
export const VISIT_ROUTES = RECORDABLE_ROUTES;

/** The buckets a referrer is reduced to. Never a URL. */
export const VISIT_REFERRERS = Object.freeze(['direct', 'search', 'social', 'ai', 'other']);

/**
 * @param {string} pathname
 * @returns {string|null} the route to record, or null to record nothing.
 */
export function routeFor(pathname) {
  if (typeof pathname !== 'string') return null;
  // A trailing slash is the same page; anything else is not this route.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return RECORDABLE_ROUTES.includes(normalized) ? normalized : null;
}

/**
 * Hosts whose referrals are worth telling apart, by suffix.
 *
 * Suffix matching rather than equality, because `www.google.com`,
 * `google.co.uk` and `news.google.com` are all the same answer to the only
 * question being asked. The list is short on purpose: a taxonomy with thirty
 * entries is a fingerprint reassembled one bucket at a time.
 *
 * `ai` is its own bucket rather than part of `search` because in 2026 those
 * are different distribution channels with different fixes, and collapsing
 * them would answer the question with the one number that cannot act on it.
 */
const BUCKETS = Object.freeze([
  ['ai', ['chatgpt.com', 'claude.ai', 'perplexity.ai', 'copilot.microsoft.com', 'gemini.google.com']],
  ['search', ['google.', 'bing.com', 'duckduckgo.com', 'search.yahoo.', 'ecosia.org', 'brave.com']],
  ['social', ['reddit.com', 'instagram.com', 'facebook.com', 'youtube.com', 't.co', 'x.com', 'tiktok.com', 'linkedin.com', 'threads.net']],
]);

/**
 * @param {string} referrer  document.referrer, or ''
 * @param {string} selfHost  the site's own hostname, so internal navigation is not a referral
 * @returns {string} one of VISIT_REFERRERS
 */
export function referrerBucket(referrer, selfHost) {
  if (typeof referrer !== 'string' || referrer === '') return 'direct';

  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    // An unparseable referrer is not a finding and not worth a bucket of its
    // own - it is simply not a referral we can name.
    return 'other';
  }

  // Our own pages are not a referral. Without this, every internal link would
  // report as 'other' and drown the number that matters.
  if (typeof selfHost === 'string' && selfHost && host === selfHost.toLowerCase()) return 'direct';

  // `gemini.google.com` must reach the ai bucket before the search bucket sees
  // `google.`, so the order of BUCKETS is load-bearing and a test pins it.
  for (const [bucket, hosts] of BUCKETS) {
    if (hosts.some((h) => (h.endsWith('.') ? host.startsWith(h) || host.includes(`.${h}`) : host === h || host.endsWith(`.${h}`)))) {
      return bucket;
    }
  }
  return 'other';
}
