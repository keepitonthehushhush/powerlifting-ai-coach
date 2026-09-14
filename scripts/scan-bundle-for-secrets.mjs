#!/usr/bin/env node
/**
 * Verify that no server-side secret reached the browser bundle.
 *
 * The constraint "the Anthropic key must never reach the browser" is only
 * worth anything if it is checked against the artifact that actually ships.
 * Reasoning about which variables have a VITE_ prefix is how people convince
 * themselves a bundle is clean; reading the compiled output is how they find
 * out. This script does the second one.
 *
 * Run after `npm run build`. Exits non-zero on a finding, so it can gate a
 * deploy in CI.
 *
 * ── AND IT HAS TO BE THE BUILD OF THIS SOURCE ─────────────────────────────
 *
 * On 2026-09-14 this printed "Scanned 24 files in web/dist" and PASSED over a
 * bundle built two days earlier. The feature under review had been built to a
 * directory outside the mount - the device VM refuses to unlink, so `vite
 * build` cannot empty web/dist - and this script's path is hardcoded, so it
 * read whatever happened to be sitting there.
 *
 * Nothing failed. "No secrets in the bundle" and "no secrets in a bundle from
 * before your change" are the same sentence from outside, forever, which is
 * the shape every serious defect in this project has had. So the staleness is
 * now the first thing checked, before a byte is scanned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import 'dotenv/config';
// Shared with scripts/verify-deployment.mjs, which asks the same question of
// the deployed artifact. One list, so the two cannot drift apart.
import { findSecrets } from './lib/secretPatterns.mjs';

const BUNDLE_DIR = new URL('../web/dist/', import.meta.url).pathname;

/**
 * The literal value from the environment, if present - catches a key that does
 * not match the shape patterns above.
 *
 * SMTP_PASSWORD joined the list on 2026-08-30, the day before the credential
 * first existed rather than the day after it leaked. It holds a Postmark server
 * token, which is a bare UUID: there is no shape pattern that could catch it
 * without matching every React key in the bundle, so the literal value is the
 * only thing that can. A credential whose only protection is that nobody has
 * prefixed it VITE_ yet is one refactor from the browser.
 */
const literalSecrets = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SMTP_PASSWORD',
  // Found by the test below on the day SMTP_PASSWORD was added: Stripe's secret
  // key has been in the environment since billing was built and was never
  // scanned for. `sk_live_` has a recognizable shape, but the shape patterns
  // live in secretPatterns.mjs and did not have it either - so nothing looked.
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]
  .map((name) => ({ name, value: process.env[name] }))
  .filter((s) => s.value && s.value.length >= 12);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

let files;
try {
  files = walk(BUNDLE_DIR);
} catch {
  console.error(`No build output at ${BUNDLE_DIR}. Run \`npm run build\` first.`);
  process.exit(2);
}

/**
 * Refuse to scan a bundle older than the source it claims to be a build of.
 *
 * Compares the NEWEST file under web/src, plus the two build inputs that live
 * outside it, against the OLDEST file in the bundle - the strict comparison in
 * both directions, so a partially-refreshed dist (the copy-over-the-top that
 * the no-unlink mount forces) is caught rather than averaged away.
 *
 * Two seconds of slack, because a build writes its own outputs over a span and
 * some filesystems round mtimes to the second. Any real staleness is minutes.
 */
const SOURCE_DIRS = [new URL('../web/src/', import.meta.url).pathname];
const SOURCE_FILES = [
  new URL('../web/index.html', import.meta.url).pathname,
  new URL('../web/vite.config.js', import.meta.url).pathname,
];

function newestSourceMtime() {
  let newest = { at: 0, file: null };
  const consider = (file) => {
    let at;
    try {
      at = statSync(file).mtimeMs;
    } catch {
      return; // An optional input that does not exist here. Not a finding.
    }
    if (at > newest.at) newest = { at, file };
  };
  for (const dir of SOURCE_DIRS) for (const file of walk(dir)) consider(file);
  for (const file of SOURCE_FILES) consider(file);
  return newest;
}

const source = newestSourceMtime();
const oldest = files.reduce(
  (worst, file) => {
    const at = statSync(file).mtimeMs;
    return at < worst.at ? { at, file } : worst;
  },
  { at: Infinity, file: null },
);

if (source.file && oldest.file && source.at > oldest.at + 2000) {
  console.error(
    `STALE - ${relative(BUNDLE_DIR, oldest.file)} in the bundle is older than ` +
      `${relative(process.cwd(), source.file)}.\n` +
      'This scan would have reported on a build that predates your change, and ' +
      'passing it would have meant nothing. Run `npm run build` first.',
  );
  process.exit(2);
}

const findings = [];

for (const file of files) {
  if (!/\.(js|mjs|cjs|css|html|json|map)$/.test(file)) continue;
  const contents = readFileSync(file, 'utf8');

  for (const what of findSecrets(contents)) {
    findings.push({ file: relative(BUNDLE_DIR, file), what });
  }
  for (const { name, value } of literalSecrets) {
    if (contents.includes(value)) findings.push({ file: relative(BUNDLE_DIR, file), what: `literal ${name}` });
  }
}

console.log(`Scanned ${files.length} files in web/dist for server-side secrets.`);

if (findings.length) {
  console.error('\nFAIL - secrets found in the browser bundle:');
  for (const f of findings) console.error(`  ${f.file}: ${f.what}`);
  console.error('\nA secret in the bundle is readable by every visitor. Do not deploy.');
  process.exit(1);
}

console.log('PASS - no server-side secrets found in the browser bundle.');
