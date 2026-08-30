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
