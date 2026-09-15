import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { readSource } from './helpers/source.js';

/**
 * ── supabase.rpc() IS NOT A PROMISE, AND .catch() CRASHED THE PRODUCT ──────
 *
 * `supabase.rpc(...)` returns a PostgrestFilterBuilder. It is a THENABLE - it
 * has `then`, and calling `then` is what sends the request - and it has no
 * `catch`. So this:
 *
 *     supabase.rpc('record_page_visit', {...}).catch(() => {});
 *
 * was not a safety net. It was `undefined(() => {})`, a TypeError thrown
 * synchronously inside a React effect, escalated to the ErrorBoundary. Every
 * route in the product rendered "Something broke on our side" - the front
 * page included - for anybody who loaded the site.
 *
 * It shipped twice. RecordVisit took out the whole app; Login.jsx took out the
 * sign-in page at the exact moment somebody had typed a wrong password, under
 * a comment promising that a telemetry write would never become the reason
 * they saw a second error.
 *
 * ── AND HOW IT HID ────────────────────────────────────────────────────────
 *
 * The builder only sends its request when `then` is called. `.catch` threw
 * BEFORE that, so no request was ever made - `page_visits` sat at zero rows
 * for the entire time the feature was live. The evidence that should have
 * revealed a broken feature looked exactly like a feature nobody had used.
 */

/** Every source file under a directory, recursively. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const url = new URL(entry, dir);
    const path = url.pathname;
    if (statSync(path).isDirectory()) sources(new URL(`${entry}/`, dir), out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(url);
  }
  return out;
}

describe('a query builder is never treated as a promise', () => {
  test('the assumption itself is true of the installed client', () => {
    /*
     * Asserted against the real package rather than remembered, because the
     * whole defect was a confident belief about an API. If a future version
     * adds `catch`, this fails and the rule below can be relaxed deliberately
     * rather than discovered by a crash.
     */
    const client = createClient('https://example.supabase.co', 'sb_publishable_test');
    const builder = client.rpc('record_page_visit', { p_route: '/', p_referrer: 'direct' });
    assert.equal(typeof builder.then, 'function', 'the builder is no longer thenable');
    assert.equal(typeof builder.catch, 'undefined', 'the builder now has catch - see the note above');
    assert.throws(() => builder.catch(() => {}), TypeError);

    // And the shape the fix relies on actually works.
    assert.doesNotThrow(() => builder.then(() => {}, () => {}));
  });

  test('nothing calls .catch on a supabase builder', () => {
    const roots = [
      new URL('../../web/src/', import.meta.url),
      new URL('../src/', import.meta.url),
    ];
    const offenders = [];
    for (const root of roots) {
      for (const file of sources(root)) {
        const src = readSource(file);
        for (const line of src.split('\n')) {
          // `supabase.rpc(...)` / `.from(...)` chains, ending in .catch
          if (/supabase\s*\n?\s*\.\s*(rpc|from)\b/.test(line) && /\.catch\s*\(/.test(line)) {
            offenders.push(`${file.pathname.split('/').slice(-2).join('/')}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], 'these treat a thenable as a promise:\n  ' + offenders.join('\n  '));
  });

  test('something watches production, since CI does not gate the deploy', () => {
    /*
     * The gate that catches this exists and works - `npm run check:mounts`
     * reported all ten broken routes the first time it was pointed at the
     * right thing. It did not stop the release for two reasons, and only one
     * of them is fixable here.
     *
     * Vercel's Git integration builds on push and does not wait for GitHub
     * Actions, so a red CI run holds nothing back. That is a project setting,
     * not a file in this repository.
     *
     * What IS fixable: nothing was looking at production. Every other check
     * here reads a local artifact, and a local artifact is not evidence about
     * a remote one - the lesson verify-deployment.mjs already exists to
     * record. So the mount check gained a remote mode and a workflow runs it
     * after every production deploy and on a schedule.
     */
    const workflow = readSource(new URL('../../.github/workflows/post-deploy.yml', import.meta.url));
    assert.match(workflow, /check-app-mounts\.mjs https:\/\/coachdiaz\.app/, 'nothing checks that the live site renders');
    assert.match(workflow, /deployment_status/, 'it does not run after a deploy');
    /*
     * The KEY and its cron, not the word. `readSource` strips JavaScript
     * comments and this is YAML, so a mutant that deleted the whole schedule
     * block still matched /schedule/ - in the `# And on a schedule, because...`
     * comment two lines above it. The test agreed with its own prose.
     */
    assert.match(workflow, /^ {2}schedule:$/m, 'the schedule key is gone');
    assert.match(workflow, /^ {4}- cron: /m, 'the schedule has no cron expression');

    const mounts = readSource(new URL('../../scripts/check-app-mounts.mjs', import.meta.url));
    assert.match(mounts, /const remoteTarget/, 'the mount check lost its remote mode');
    /*
     * The offline rule is what makes the LOCAL check meaningful and would make
     * the remote one meaningless. It is now in two halves, in two files, and
     * both are asserted: the caller decides, the driver applies.
     *
     * It used to be one regex against the flag inside check-app-mounts' own
     * dumpDom. dumpDom is gone - `--dump-dom` could not inject a probe into a
     * page it did not serve, which is why the remote mode had never been able
     * to pass - so this follows the rule to where it went rather than
     * asserting the shape of a function that no longer exists.
     */
    assert.match(mounts, /offline: !remoteTarget/, 'the remote check would block its own target');
    const driver = readSource(new URL('../../scripts/lib/browser.mjs', import.meta.url));
    assert.match(driver, /offline \? \['--host-resolver-rules/, 'the driver no longer honours the offline rule');
    assert.match(driver, /offline = false/, 'the driver cuts the network off by default, which is the dangerous direction');
  });

  test('and the two that did are written the way that works', () => {
    // Named, because a regex that finds nothing is indistinguishable from a
    // regex that is broken. These two must keep the working form.
    const visit = readSource(new URL('../../web/src/components/RecordVisit.jsx', import.meta.url));
    assert.match(visit, /\.then\(\(\) => \{\}, \(\) => \{\}\)/, 'RecordVisit no longer handles its rejection');

    const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
    assert.match(login, /record_auth_failure[^)]*\}\)\.then\(\(\) => \{\}, \(\) => \{\}\)/);
  });
});
