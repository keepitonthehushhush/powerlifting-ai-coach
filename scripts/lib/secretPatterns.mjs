/**
 * The shapes of things that must never appear in client-side JavaScript.
 *
 * Shared by the two scanners deliberately. `scan-bundle-for-secrets.mjs`
 * checks the build output on this machine; `verify-deployment.mjs` checks the
 * artefact the public actually downloads. Those are different questions, and
 * this project learned the hard way that a clean local build says nothing
 * about what a hosting provider compiled - but they must be judged against
 * one identical list, or "passes locally" and "passes in production" stop
 * meaning the same thing.
 */
export const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'Supabase service role JWT', re: /"?role"?\s*:\s*"service_role"/ },
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'Generic private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** @returns {string[]} names of every pattern found in `contents`. */
export function findSecrets(contents) {
  return SECRET_PATTERNS.filter(({ re }) => re.test(contents)).map(({ name }) => name);
}
