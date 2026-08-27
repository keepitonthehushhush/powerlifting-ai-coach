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
