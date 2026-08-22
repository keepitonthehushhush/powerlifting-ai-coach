#!/usr/bin/env node
/**
 * Verify that no server-side secret reached the browser bundle.
 *
 * The constraint "the Anthropic key must never reach the browser" is only
 * worth anything if it is checked against the artefact that actually ships.
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

const BUNDLE_DIR = new URL('../web/dist/', import.meta.url).pathname;

const PATTERNS = [
  { name: 'Anthropic API key',        re: /sk-ant-[A-Za-z0-9_\-]{16,}/g },
  { name: 'Supabase service role JWT', re: /"?role"?\s*:\s*"service_role"/g },
  { name: 'Supabase secret key',      re: /sb_secret_[A-Za-z0-9_\-]{8,}/g },
  { name: 'Generic private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

// The literal value from the environment, if present - catches a key that does
// not match the shape patterns above.
const literalSecrets = ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']
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

  for (const { name, re } of PATTERNS) {
    if (re.test(contents)) findings.push({ file: relative(BUNDLE_DIR, file), what: name });
    re.lastIndex = 0;
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
