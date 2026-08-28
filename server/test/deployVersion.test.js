import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * ── THE FAILURE THIS ADDRESSES IS NOT THE ONE YOU EXPECT ───────────────────
 *
 * "Users accidentally refresh during a live fix" sounds like the classic
 * chunk-404: hashed asset filenames change, the old page requests a chunk that
 * no longer exists, blank screen.
 *
 * That cannot happen here, and the check came before the code: this app has no
 * React.lazy and no dynamic import(), so there is one bundle and no lazy chunks
 * to miss. Vercel also serves index.html with must-revalidate, so a refresh
 * gets fresh HTML pointing at a fresh asset.
 *
 * The real exposure is VERSION SKEW - an old client against a new API. It
 * produces no crash, no error, and a bug report nobody can reproduce because a
 * refresh silently fixes it.
 */

const version = readSource(new URL('../../web/src/lib/version.js', import.meta.url));
const versionRaw = readRaw(new URL('../../web/src/lib/version.js', import.meta.url));
const banner = readSource(new URL('../../web/src/components/NewVersionBanner.jsx', import.meta.url));
const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
const app = readSource(new URL('../src/app.js', import.meta.url));
const viteConfig = readRaw(new URL('../../web/vite.config.js', import.meta.url));
const runbook = readRaw(new URL('../../docs/RUNBOOK.md', import.meta.url));
const webSrc = new URL('../../web/src/', import.meta.url);

describe('the diagnosis was checked, not assumed', () => {
  test('THERE IS STILL NO CODE SPLITTING, SO THE CHUNK-404 GUARD WOULD BE DEAD CODE', async () => {
    // If this ever fails, the app has grown lazy routes and the OTHER failure
    // becomes real - at which point a chunk-load recovery handler is worth
    // writing. Until then it would be a guard for something that cannot happen.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const walk = (dir, acc = []) => {
      for (const entry of readdirSync(dir)) {
        const full = new URL(entry, dir);
        if (statSync(full).isDirectory()) walk(new URL(`${entry}/`, dir), acc);
        else if (/\.jsx?$/.test(entry)) acc.push(readFileSync(full, 'utf8'));
      }
      return acc;
    };
    const sources = walk(webSrc);
    const lazy = sources.filter((s) => /React\.lazy|\blazy\(|import\(/.test(s));
    assert.equal(lazy.length, 0, 'the app now code-splits - revisit chunk-load recovery');
  });

  test('and the reasoning is recorded so it is not re-litigated', () => {
    assert.match(versionRaw, phrase('checked before building a guard for it'));
  });
});

describe('the build knows which build it is', () => {
  test('the id is injected at build time from the deployment', () => {
    assert.match(viteConfig, /__BUILD_ID__: JSON\.stringify\(process\.env\.VERCEL_DEPLOYMENT_ID \?\? 'dev'\)/);
  });

  test('and the server reports the deployment actually serving', () => {
    assert.match(app, /deploymentId: process\.env\.VERCEL_DEPLOYMENT_ID \?\? 'dev'/);
  });

  test('a local build compares nothing, because there is nothing to compare', () => {
    assert.match(version, /BUILD_ID !== 'dev'/);
  });
});

describe('when it prompts, and when it refuses to', () => {
  test('IT NEVER RELOADS BY ITSELF', () => {
    // Somebody may be halfway through logging a session. An automatic reload
    // trades a possible confusion for a certain loss.
    assert.match(banner, /window\.location\.reload\(\)/);
    const auto = banner.slice(0, banner.indexOf('return ('));
    assert.ok(!/reload\(\)/.test(auto), 'the component reloads outside a click handler');
    // The reasoning lives in version.js, next to the decision not to reload.
    assert.match(versionRaw, phrase('a certain loss'));
  });

  test('missing information is never treated as a mismatch', () => {
    // An absent id means the server cannot tell us, which is not the same as
    // being out of date. Prompting on it would nag every user of a deployment
    // where the variable is unset.
    assert.match(version, /if \(!body\?\.deploymentId \|\| body\.deploymentId === 'dev'\) return false/);
  });

  test('and neither is a failed or slow request', () => {
    // A version prompt is the last thing somebody offline needs.
    assert.match(version, /catch \{/);
    assert.match(version, /AbortController/);
    assert.match(version, /timeoutMs = 5000/);
  });

  test('it checks on focus rather than polling', () => {
    // A background tab cannot be confused by a deploy. The moment that matters
    // is somebody returning to a page they left open.
    assert.match(banner, /visibilitychange/);
    assert.ok(!/setInterval/.test(banner), 'it polls on a timer');
  });

  test('a declined prompt stays declined', () => {
    assert.match(banner, /dismissed/);
  });
});

describe('the platform feature is wired even though it is not available', () => {
  test('every request carries x-deployment-id', () => {
    // Vercel Skew Protection is Pro-and-above and does not support a plain
    // Vite SPA automatically. The header is the manual half, ignored today,
    // working the day the plan changes rather than being remembered.
    assert.match(api, /'x-deployment-id': BUILD_ID/);
  });

  test('and not on a local build, where the value means nothing', () => {
    assert.match(api, /BUILD_ID && BUILD_ID !== 'dev' \?/);
  });
});

describe('the runbook says the dangerous part out loud', () => {
  test('A PREVIEW DEPLOYMENT WRITES TO PRODUCTION DATA', () => {
    // One Supabase project. The preview URL reads and writes the same rows as
    // the live site, which is the opposite of what "preview" implies.
    assert.match(runbook, phrase('A preview deployment talks to the production database'));
    assert.match(runbook, phrase('It is not a place to try a migration or a delete'));
  });

  test('and that migrations go live before the code that uses them', () => {
    assert.match(runbook, phrase('a migration is live the moment it is applied'));
    assert.match(runbook, phrase('add columns, do not rename or drop them'));
  });

  test('rollback is promoting the last good deployment, not reverting', () => {
    assert.match(runbook, phrase('Promote the last good one'));
    assert.match(runbook, phrase('A database migration does'));
  });
});
