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
import { execFileSync } from 'node:child_process';
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
  '.env': {
    mode: 'untracked',
    why: 'holds secrets and must never be committed. .env.example is the committed template.',
  },
  '.env.local': {
    mode: 'untracked',
    why: 'Vercel-generated, and also secret-bearing.',
  },
  'server/.env': {
    mode: 'absent',
    why: 'DOES NOT EXIST, and the runbook says so on purpose. Referencing it was the bug that produced this checker.',
  },
};

/**
 * ── WHY THERE ARE TWO MODES ─────────────────────────────────────────────────
 *
 * The first version of this map had one, and it was the wrong one. It asserted
 * that an expected-absent path does not exist ON DISK, and the comment beneath
 * it claimed that "a .env committed by accident would be caught here". It would
 * not have been. existsSync tells you about the disk; being committed is a fact
 * about git.
 *
 * The two are not the same thing, and for `.env` they are close to opposite:
 * the file SHOULD exist on a working machine - that is where the keys live -
 * and must never be in a commit. So the disk check failed on every developer
 * machine that was set up correctly, and passed in CI and in any fresh clone,
 * where no .env exists. A check that fails only where the thing is right, and
 * passes everywhere the thing is missing, is worse than no check: it is a
 * check that teaches you to ignore it.
 *
 *   - 'untracked' asks git, not the filesystem. The file may exist locally;
 *     it must not be tracked, and it must be ignored. Asserting the ignore
 *     rule too means removing the .gitignore line fails HERE, before the file
 *     is ever staged - which is the only moment the failure is still cheap.
 *
 *   - 'absent' means what it says: no such path, anywhere. `server/.env` is
 *     the only one, and it exists to keep a corrected document corrected.
 */

const migrations = existsSync(join(root, 'supabase/migrations'))
  ? readdirSync(join(root, 'supabase/migrations'))
  : [];

/**
 * What git actually tracks, and what it actually ignores.
 *
 * Shelling out rather than parsing .gitignore ourselves: git's ignore rules
 * have precedence, negation and directory semantics, and a hand-rolled parser
 * that gets one of them wrong would be a check that is confidently incorrect
 * about a security property. Ask the tool that owns the answer.
 */
function gitTrackedFiles() {
  try {
    return new Set(
      execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    );
  } catch {
    return null; // not a git checkout, or git is unavailable
  }
}

function isIgnored(path) {
  try {
    // check-ignore exits 0 when the path IS ignored, 1 when it is not.
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const tracked = gitTrackedFiles();

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

// The counterpart check, in the direction each entry actually cares about.
for (const [path, { mode, why }] of Object.entries(EXPECTED_ABSENT)) {
  if (mode === 'absent') {
    if (existsSync(join(root, path))) {
      problems.push(`${path} is documented as not existing (${why}) but EXISTS on disk`);
    }
    continue;
  }

  // mode === 'untracked'. This is the "never commit secrets" rule, asserted
  // rather than trusted, and it is the whole reason this branch exists.
  if (tracked === null) continue; // not a git checkout - nothing to assert against

  if (tracked.has(path)) {
    problems.push(
      `${path} IS TRACKED BY GIT and must not be: it ${why}\n` +
        `      Remove it from the index with \`git rm --cached ${path}\` and rotate anything it held.`,
    );
  } else if (!isIgnored(path)) {
    problems.push(
      `${path} is not tracked, but git is no longer ignoring it, so the next ` +
        `\`git add -A\` would commit it. It ${why}\n` +
        `      Restore the .gitignore entry.`,
    );
  }
}

const untrackedCount = Object.values(EXPECTED_ABSENT).filter((e) => e.mode === 'untracked').length;
const absentCount = Object.values(EXPECTED_ABSENT).filter((e) => e.mode === 'absent').length;

if (problems.length === 0) {
  console.log(
    `PASS - ${FILES.length} documents check out: every path, script and migration exists, ` +
      `${untrackedCount} secret-bearing file(s) are still untracked and still ignored, ` +
      `and ${absentCount} documented absence(s) are still absent.`
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
