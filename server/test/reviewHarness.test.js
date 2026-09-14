import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw } from './helpers/source.js';

/**
 * ── THE CHECK THAT COULD ONLY SEE TWO SCREENS ─────────────────────────────
 *
 * scripts/check-computed-styles.mjs is this repository's only guard against a
 * stylesheet change quietly moving something on the page. Until 2026-09-14 it
 * watched `/` and `/login` - four snapshot entries - because the browser it
 * drives has no network and therefore no session. The program table, the coach
 * transcript, the charts, the log form and every account screen were on the
 * other side of that login and had never been measured by anything.
 *
 * docs/DESIGN_REVIEW_2026-09-09.md says exactly this about itself, and the
 * token migration that follows moves spacing on every one of those screens.
 *
 * web/harness/ closed it. What this file guards is that it STAYS closed: the
 * failure mode of a harness is not that it breaks loudly, it is that somebody
 * drops a page from one list and the coverage silently halves while everything
 * still passes.
 */
const harness = readSource(new URL('../../web/harness/main.jsx', import.meta.url));
const checker = readSource(new URL('../../scripts/check-computed-styles.mjs', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(new URL('../../scripts/computed-styles.snapshot.json', import.meta.url), 'utf8'),
);

/** The `PAGES` map in the harness - the screens it can actually render. */
function harnessPages() {
  const block = harness.match(/const PAGES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'the harness no longer has a PAGES map');
  return [...block[1].matchAll(/(\w+):\s*\w+/g)].map(([, id]) => id).sort();
}

/** The `HARNESS_PAGES` list in the checker - the screens it actually visits. */
function checkerPages() {
  const block = checker.match(/const HARNESS_PAGES = \[([\s\S]*?)\];/);
  assert.ok(block, 'the checker no longer lists the harness pages');
  return [...block[1].matchAll(/'([\w-]+)'/g)].map(([, id]) => id).sort();
}

describe('the review harness covers what it claims to cover', () => {
  test('every screen the harness can render is a screen the checker visits', () => {
    /*
     * Two lists for one rule, asserted equal - the shape this repository
     * already uses for a CHECK constraint and its code twin. Adding a page to
     * the harness and forgetting the checker produces a screen that looks
     * reviewed and is not, which is worse than one that was never added.
     */
    assert.deepEqual(checkerPages(), harnessPages());
  });

  test('and the recorded baseline has an entry for each of them, in both schemes', () => {
    /*
     * The list being right does not mean the baseline was recorded with it.
     * `--update` rewrites whatever was captured, so a run against a stale build
     * could shrink the snapshot back to four entries and every later run would
     * agree with it. An empty snapshot compares equal to an empty snapshot.
     */
    for (const page of checkerPages()) {
      for (const scheme of ['dark', 'light']) {
        const key = Object.keys(snapshot).find(
          (k) => k.startsWith(`${scheme} harness/`) && k.includes(`page=${page}`),
        );
        assert.ok(key, `no ${scheme} baseline entry for the ${page} screen`);
        assert.ok(
          Object.keys(snapshot[key]).length >= 12,
          `${key} captured ${Object.keys(snapshot[key]).length} selectors - the page cannot have rendered`,
        );
      }
    }
    // The two public routes are still watched in their own right: they are what
    // a visitor with no session and no JavaScript-reachable API sees.
    for (const key of ['dark app/', 'light app/', 'dark app/login', 'light app/login']) {
      assert.ok(snapshot[key], `the signed-out ${key} capture has been dropped`);
    }
  });

  test('the harness renders the shipped components, not copies of them', () => {
    /*
     * The whole value of this thing is that it mounts the REAL page. An import
     * from anywhere but web/src (or the server libraries, which are pure) means
     * it has started reviewing itself.
     *
     * readRaw, not readSource: the import list is code, but the rule is stated
     * in a comment beside it and a future edit should trip on both.
     */
    const raw = readRaw(new URL('../../web/harness/main.jsx', import.meta.url));
    const imports = [...raw.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(([, spec]) => spec);
    /*
     * `./` was allowed here in the first draft, for ./fixtures.js. A planted
     * mutant then swapped the real Program page for `./my-own-copy-of-Program.jsx`
     * and this test agreed with it - the exact defect it exists to prevent,
     * waved through by the exception that made the rule convenient.
     *
     * So the harness's own files are an enumerated list, not a prefix.
     */
    const OWN_FILES = ['./fixtures.js'];
    const local = imports.filter((spec) => spec.startsWith('.'));
    for (const spec of local) {
      assert.ok(
        spec.startsWith('../src/') || spec.startsWith('../../server/src/') || OWN_FILES.includes(spec),
        `the harness imports ${spec}, which is neither the app, a server library, nor a named fixture file`,
      );
    }
    assert.ok(local.some((s) => s.startsWith('../src/pages/')), 'it renders no real page');
  });

  test('the harness build is never part of the production build', () => {
    /*
     * It hands itself a signed-in session. That is what makes it useful and it
     * is why its output must not reach a public origin.
     */
    const pkg = JSON.parse(readFileSync(new URL('../../web/package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.scripts.build, 'vite build', 'the production build now does something else - check it does not include the harness');
    assert.match(pkg.scripts.harness, /vite\.harness\.config\.js/);
    const ignored = readRaw(new URL('../../.gitignore', import.meta.url));
    assert.match(ignored, /web\/harness-dist\//, 'the harness build output is not gitignored');
  });

  test('no real athlete data rides along in the fixtures', () => {
    /*
     * The fixtures carry a profile with injury and restriction FIELDS, because
     * the layout has to be honest about them. The content must be invented -
     * health information does not belong in a repository, a screenshot or a
     * context window.
     */
    const fixtures = readRaw(new URL('../../web/harness/fixtures.js', import.meta.url));
    assert.match(fixtures, /no real health data/i, 'the rule is no longer stated where the data is');
    assert.doesNotMatch(fixtures, /@gmail\.com|@icloud\.com|@outlook\.com/, 'a real email address is in the fixtures');
  });
});
