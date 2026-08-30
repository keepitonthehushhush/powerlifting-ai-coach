/**
 * The shapes of things that must never appear in client-side JavaScript.
 *
 * Shared by the two scanners deliberately. `scan-bundle-for-secrets.mjs`
 * checks the build output on this machine; `verify-deployment.mjs` checks the
 * artifact the public actually downloads. Those are different questions, and
 * this project learned the hard way that a clean local build says nothing
 * about what a hosting provider compiled - but they must be judged against
 * one identical list, or "passes locally" and "passes in production" stop
 * meaning the same thing.
 */
export const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'Supabase service role JWT', re: /"?role"?\s*:\s*"service_role"/ },
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  /**
   * Stripe's live and test secret keys. Added 2026-08-30, alongside the literal
   * scan for STRIPE_SECRET_KEY - a shape pattern catches it in a bundle built
   * on a machine where the variable is not set, which is most CI runs.
   *
   * Restricted keys (rk_) too: they are narrower than a secret key and still
   * not public.
   */
  { name: 'Stripe secret key', re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'Stripe webhook signing secret', re: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { name: 'Generic private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** @returns {string[]} names of every pattern found in `contents`. */
export function findSecrets(contents) {
  return SECRET_PATTERNS.filter(({ re }) => re.test(contents)).map(({ name }) => name);
}
