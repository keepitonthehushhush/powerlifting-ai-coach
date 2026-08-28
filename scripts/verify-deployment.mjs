#!/usr/bin/env node
/**
 * Verify the deployed site, not the local build.
 *
 * WHY THIS EXISTS. `npm run verify:bundle` scans web/dist and passed on every
 * run while production served a black page. Both statements were true at once:
 * the build on this machine was correct, and the build Vercel produced was
 * not, because VITE_SUPABASE_URL had never been created: Vercel refuses a
 * public framework prefix combined with sensitive visibility, and every
 * attempt to add it was rejected. Vite therefore inlined `undefined`, the
 * Supabase client threw before React mounted, and the page rendered as an
 * empty body.
 *
 * The lesson is narrow and worth keeping: a local artefact is not evidence
 * about a remote one. This script asks the only question that matters after a
 * deploy - what is the public actually downloading? - and answers it by
 * downloading it.
 *
 * Two assertions, and they pull in opposite directions on purpose:
 *
 *   NEGATIVE  no server-side secret appears in any shipped asset.
 *   POSITIVE  the public configuration that is SUPPOSED to be there is there.
 *
 * A build with the environment missing passes the negative check trivially -
 * that is exactly the state that shipped the black page. Checking only for
 * secrets would have called that deploy healthy.
 *
 * Usage:  node scripts/verify-deployment.mjs [url]
 *         DEPLOY_URL=https://... npm run verify:deployment
 *
 * Exit codes: 0 pass, 1 finding, 2 could not check.
 */
import { findSecrets } from './lib/secretPatterns.mjs';

const target = process.argv[2] || process.env.DEPLOY_URL;

if (!target) {
  console.error('Usage: node scripts/verify-deployment.mjs <url>   (or set DEPLOY_URL)');
  process.exit(2);
}

const base = new URL(target);

/**
 * Configuration that MUST be inlined for the app to boot.
 *
 * Matched by shape rather than by literal value so this script needs no
 * secrets, no .env, and no coupling to a particular project - which means CI
 * can run it against a preview URL without being trusted with anything.
 */
const REQUIRED_CONFIG = [
  { name: 'VITE_SUPABASE_URL', re: /https:\/\/[a-z0-9]{16,}\.supabase\.co/ },
  { name: 'VITE_SUPABASE_PUBLISHABLE_KEY', re: /sb_publishable_[A-Za-z0-9_-]{16,}/ },
];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

let html;
try {
  html = await get(base.href);
} catch (err) {
  console.error(`Could not fetch ${base.href}: ${err.message}`);
  process.exit(2);
}

// Asset URLs are read out of the served HTML rather than guessed from
// web/dist, so this reflects what the host built - content hash included.
const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

if (assetPaths.length === 0) {
  console.error('No /assets/ references in the served HTML. Nothing to verify - is this the app?');
  process.exit(2);
}

const documents = [{ path: '/', body: html }];
for (const path of assetPaths) {
  try {
    documents.push({ path, body: await get(new URL(path, base).href) });
  } catch (err) {
    console.error(`Could not fetch asset ${path}: ${err.message}`);
    process.exit(2);
  }
}

const scripts = documents.filter((d) => d.path.endsWith('.js'));
const leaks = documents.flatMap((d) => findSecrets(d.body).map((what) => ({ path: d.path, what })));

// Any script may carry the config; Vite's chunking is not ours to predict.
const allScript = scripts.map((d) => d.body).join('\n');
const missing = REQUIRED_CONFIG.filter(({ re }) => !re.test(allScript)).map(({ name }) => name);

console.log(`Checked ${documents.length} documents from ${base.origin}:`);
for (const d of documents) console.log(`  ${d.path}  ${d.body.length.toLocaleString()} bytes`);

let failed = false;

if (leaks.length) {
  failed = true;
  console.error('\nFAIL - server-side secrets are being served to browsers:');
  for (const l of leaks) console.error(`  ${l.path}: ${l.what}`);
  console.error('Rotate the credential first, then fix the build. It is public until rotated.');
} else {
  console.log('\nPASS - no server-side secrets in any served asset.');
}

if (missing.length) {
  failed = true;
  console.error(`\nFAIL - required public configuration was not compiled in: ${missing.join(', ')}`);
  console.error(
    'The build ran without these set. On Vercel the usual cause is that the variable was\n' +
      'never created: a public framework prefix (VITE_) combined with sensitive visibility\n' +
      'is rejected on Production and Preview, and a rejected create is easy to miss.\n' +
      'See docs/DEPLOYMENT.md. Setting the variable is also not enough on its own -\n' +
      'build-time values are read once, so an existing deployment must be rebuilt.'
  );
} else {
  console.log('PASS - required public configuration is present in the served JavaScript.');
}

process.exit(failed ? 1 : 0);
