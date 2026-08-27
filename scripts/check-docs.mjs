#!/usr/bin/env node
/**
 * Does the documentation describe a repository that exists?
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * Because `server/.env` was referenced in a script's error message and in
 * conversation, and there is no such file - the real one is `.env` at the
 * root. It was wrong for days, in a message whose entire job was to tell
 * somebody where to look. Nothing failed, because a wrong path in a comment
 * is not a syntax error.
 *
 * That is the same shape as every other defect this project has had: a claim
 * about the system that stopped being true, or never was, and nothing
 * checking. policyDisclosure.test.js holds the consent documents to the
 * schema; this holds the ENGINEERING documents to the filesystem.
 *
 * ── WHAT IT CHECKS ────────────────────────────────────────────────────────
 *
 *   - every `npm run <script>` named in the docs exists in package.json
 *   - every repository-relative path mentioned in backticks exists on disk
 *   - every migration referenced by number exists
 *
 * ── WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────
 *
 * Prose. It cannot tell whether "the coach refuses to do X" is true, and
 * pretending otherwise would make it a source of false confidence. It checks
 * the mechanical claims, which are the ones that rot silently.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));

/** Docs plus the comment-heavy source files that make the same kind of claim. */
const FILES = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/RUNBOOK.md',
  'docs/SECURITY.md',
  'docs/LEGAL_CONSIDERATIONS.md',
  '.env.example',
  'scripts/check-db-invariants.mjs',
  'scripts/check-contact-route.mjs',
  'scripts/run-sql-test.mjs',
].filter((f) => existsSync(join(root, f)));

/**
 * Backticked things that look like repository paths.
 *
 * Deliberately conservative: it wants a slash and a known top-level directory
 * or a dotfile, so `auth.uid()` and `customer.subscription.updated` are not
 * mistaken for filenames. Over-reporting would make this noise, and noisy
 * checks get switched off.
 */
const PATH_PATTERN = /`((?:server|web|docs|scripts|supabase|api)\/[A-Za-z0-9_./-]+|\.env(?:\.[a-z]+)?)`/g;
const SCRIPT_PATTERN = /npm run ([a-z][a-z0-9:-]*)/g;
const MIGRATION_PATTERN = /migration (\d{4})/gi;

/**
 * Paths that are legitimately absent, and why.
 *
 * An explicit map rather than a .gitignore parse, for the same reason the
 * disclosure test uses one: it forces whoever adds an entry to say WHY, and
 * "it is gitignored" and "it does not exist and the sentence says so" are
 * different reasons that should not be collapsed into one silent skip.
 *
 * The first run of this checker reported `.env` as a broken reference, which
 * is exactly the false positive that gets a check switched off. A checker that
 * cries wolf is worse than no checker.
 */
const EXPECTED_ABSENT = {
  '.env': 'gitignored - it holds secrets and must never be committed. .env.example is the committed template.',
  '.env.local': 'gitignored, Vercel-generated.',
  'server/.env': 'DOES NOT EXIST, and the runbook says so on purpose. Referencing it was the bug that produced this checker.',
};

const migrations = existsSync(join(root, 'supabase/migrations'))
  ? readdirSync(join(root, 'supabase/migrations'))
  : [];

const problems = [];

for (const file of FILES) {
  const text = readFileSync(join(root, file), 'utf8');

  for (const [, script] of text.matchAll(SCRIPT_PATTERN)) {
    if (!scripts.has(script)) {
      problems.push(`${file}: \`npm run ${script}\` is not a script in package.json`);
    }
  }

  for (const [, path] of text.matchAll(PATH_PATTERN)) {
    // A trailing slash means a directory; a wildcard is a description, not a path.
    if (path.includes('*') || path.includes('<')) continue;
    if (path in EXPECTED_ABSENT) continue;
    const target = join(root, path.replace(/\/$/, ''));
    if (!existsSync(target)) {
      problems.push(`${file}: \`${path}\` does not exist`);
    }
  }

  for (const [, number] of text.matchAll(MIGRATION_PATTERN)) {
    if (!migrations.some((m) => m.startsWith(number))) {
      problems.push(`${file}: migration ${number} is referenced and does not exist`);
    }
  }
}

// The counterpart check: an entry in EXPECTED_ABSENT that HAS appeared on disk
// means the reason is stale and somebody should look at it. A .env committed by
// accident would be caught here and nowhere else.
for (const [path, why] of Object.entries(EXPECTED_ABSENT)) {
  if (existsSync(join(root, path))) {
    problems.push(`${path} is listed as expected-absent (${why}) but EXISTS on disk`);
  }
}

if (problems.length === 0) {
  console.log(
    `PASS - ${FILES.length} documents check out: every path, script and migration exists, ` +
      `and the ${Object.keys(EXPECTED_ABSENT).length} deliberate absences are still absent.`
  );
  process.exit(0);
}

console.error(`${problems.length} claim(s) in the documentation are not true:\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(
  '\nA wrong path in a document is not a syntax error, so nothing else will ever\n' +
    'catch this. Fix the document, or fix the repository to match it.'
);
process.exit(1);
