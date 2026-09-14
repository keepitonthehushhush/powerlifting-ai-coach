#!/usr/bin/env node
/**
 * Assert that every dependency declared in a package.json is actually pinned
 * in package-lock.json.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `stripe` was added to package.json on a machine with no registry access, so
 * the lockfile was never regenerated. Nothing local complained. `npm test`
 * passed, `npm run check:docs` passed, the billing code degrades gracefully
 * when the package is absent - and the first thing that would have said so was
 * `npm ci` in CI, after a push, with the message buried in an install log.
 *
 * That is the same shape as every other defect this project has had: the fact
 * was knowable locally and nothing local looked. So this looks.
 *
 * It compares declarations against the lock rather than against node_modules,
 * because node_modules is whatever happens to be on this machine and the lock
 * is what CI will actually install.
 *
 * ── AND THEN THE SECOND HALF, ADDED 2026-09-14 ──────────────────────────────
 *
 * That paragraph is right and it left a hole exactly its own shape. CI failed
 * on `npm audit --omit=dev --audit-level=high`: a high-severity advisory
 * against nodemailer, CVSS 7.5, plus three others. Every one of them was fixed
 * in a version this Mac already had installed - 9.1.1 on disk - while the
 * lockfile still pinned 9.0.6.
 *
 * So `npm audit` locally read node_modules and said nothing, and CI ran
 * `npm ci`, installed exactly what the lockfile pinned, and found four
 * advisories. The machine the code is written on had quietly stopped being the
 * machine the code is built on, and the gap is invisible from either side
 * alone: the lockfile is internally consistent, and the installed tree is
 * clean.
 *
 * So this now checks BOTH directions. The lock is still what CI installs and
 * still the authority. But when node_modules exists, a version on disk that
 * differs from the pin is reported here - once, locally, by name - rather than
 * discovered as a security finding after a push.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'package-lock.json');

if (!existsSync(lockPath)) {
  // Only reachable on a checkout without the lockfile. Loud rather than
  // silent: a check that skips quietly is a check nobody can trust.
  console.log('SKIP - package-lock.json is not present in this checkout, so there is nothing to compare against.');
  process.exit(0);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

/** Workspaces are keyed by their path in the lock; the root is the empty key. */
const MANIFESTS = [
  { file: 'package.json', lockKey: '' },
  { file: 'web/package.json', lockKey: 'web' },
];

const problems = [];
let checked = 0;

for (const { file, lockKey } of MANIFESTS) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const entry = lock.packages?.[lockKey];

  if (!entry) {
    problems.push(`${file} is not represented in package-lock.json at all (key "${lockKey}").`);
    continue;
  }

  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      checked += 1;

      // The workspace's own record of what it declares...
      if (entry[field]?.[name] !== range) {
        problems.push(
          `${file} declares ${field}.${name}@${range}, but package-lock.json records ` +
            `${entry[field]?.[name] ?? 'nothing'} for it.`,
        );
        continue;
      }

      // ...and an actual resolved package for it to install. A declaration the
      // lock acknowledges but never resolves still fails `npm ci`.
      const resolved =
        lock.packages?.[`node_modules/${name}`] ??
        lock.packages?.[`${lockKey}/node_modules/${name}`];
      if (!resolved) {
        problems.push(
          `${file} declares ${name}@${range}, but package-lock.json has no resolved entry for it. ` +
            `\`npm ci\` will refuse to install. Run \`npm install\` and commit the lockfile.`,
        );
      }
    }
  }
}

/**
 * What is actually installed, where that differs from what is pinned.
 *
 * Skipped entirely when node_modules is absent - a fresh checkout or CI before
 * install, where there is nothing to compare and an absence is not a finding.
 * That is a deliberate skip and it is safe in a way most skips are not: CI's
 * own `npm ci` and `npm audit` are what catch the drift from the other side,
 * so nothing here is the only thing standing between a bad pin and a deploy.
 */
const drifted = [];
if (existsSync(join(root, 'node_modules'))) {
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || !entry?.version) continue;
    const installedManifest = join(root, key, 'package.json');
    if (!existsSync(installedManifest)) continue;
    let installed;
    try {
      installed = JSON.parse(readFileSync(installedManifest, 'utf8')).version;
    } catch {
      continue; // Unreadable manifest is not this check's business.
    }
    if (installed && installed !== entry.version) {
      drifted.push(`${key.replace('node_modules/', '')}: lockfile pins ${entry.version}, installed is ${installed}`);
    }
  }
}

if (drifted.length > 0) {
  console.error('FAIL - the installed tree has drifted from the lockfile:\n');
  for (const d of drifted) console.error(`  - ${d}`);
  console.error(
    '\nCI runs `npm ci`, which installs exactly what the lockfile pins - so every local\n' +
      'check (npm audit included) has been reading a different set of packages from the\n' +
      'ones that get built and deployed. This is how a high-severity advisory sat green\n' +
      'locally and red in CI on 2026-09-14.\n' +
      'Fix: run `npm install` and commit package-lock.json, or `npm ci` to match the pin.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error('FAIL - package.json and package-lock.json disagree:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\n`npm ci` installs exactly what the lockfile pins and refuses to run when the two ' +
      'disagree, so this would have failed in CI after a push.\n' +
      'Fix: run `npm install` on a machine with registry access and commit package-lock.json.',
  );
  process.exit(1);
}

console.log(`PASS - ${checked} declared dependencies are all pinned and resolved in package-lock.json.`);
