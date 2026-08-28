import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_SUPABASE_REF,
  supabaseRef,
  deploymentEnvironment,
  describeIsolation,
  assertPreviewIsolation,
} from '../src/lib/environment.js';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * ── WHY THERE IS A PREVIEW ENVIRONMENT AT ALL ───────────────────────────────
 *
 * Three separate faults reached coachdiaz.app in one afternoon: a blank page, a
 * profile save nobody could complete, and a chat error that gave no reason.
 * Every one of them was findable by clicking the thing once. None was clicked,
 * because there was nowhere to click it: Vercel builds a preview for every
 * branch and every one of them talked to the PRODUCTION database, so testing
 * anything that writes meant testing on real athletes' rows.
 *
 * ── AND WHY THE ISOLATION IS ASSERTED RATHER THAN CONFIGURED ────────────────
 *
 * A second database introduces a failure worse than the one it fixes: a
 * preview that is *believed* isolated and is quietly still pointed at
 * production. That looks safe, invites exactly the destructive testing it was
 * built to allow, and does the damage silently - which is this project's
 * recurring defect shape in a new place.
 *
 * So a preview pointed at production refuses to serve, on both sides, and this
 * file is the proof that the refusal is real and one-directional.
 */

const OTHER_REF = 'abcdefghijklmnopqrst';

describe('reading the environment', () => {
  test('a Supabase URL yields its project ref', () => {
    assert.equal(supabaseRef(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`), PRODUCTION_SUPABASE_REF);
    assert.equal(supabaseRef(`https://${OTHER_REF}.supabase.co/rest/v1/`), OTHER_REF);
    assert.equal(supabaseRef(`HTTPS://${PRODUCTION_SUPABASE_REF.toUpperCase()}.SUPABASE.CO`), PRODUCTION_SUPABASE_REF);
  });

  test('and anything else yields null rather than a guess', () => {
    for (const value of ['', undefined, null, 'not a url', 'http://localhost:54321', 'https://example.com']) {
      assert.equal(supabaseRef(value), null, `${JSON.stringify(value)} was parsed as a ref`);
    }
  });

  test('VERCEL_ENV decides, and its absence means development', () => {
    assert.equal(deploymentEnvironment({ VERCEL_ENV: 'production' }), 'production');
    assert.equal(deploymentEnvironment({ VERCEL_ENV: 'preview' }), 'preview');
    assert.equal(deploymentEnvironment({}), 'development');
    assert.equal(deploymentEnvironment({ VERCEL_ENV: 'staging' }), 'development');
  });
});

describe('a preview may not write to production', () => {
  const pointedAtProduction = { VERCEL_ENV: 'preview', SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` };

  test('IT REFUSES, AND SAYS WHAT TO DO ABOUT IT', () => {
    const result = describeIsolation(pointedAtProduction);
    assert.equal(result.isolated, false);
    // A refusal that does not say which dashboard, which variables, and that a
    // redeploy is needed is a refusal somebody works around.
    assert.match(result.reason, /PREVIEW/);
    assert.match(result.reason, /VITE_SUPABASE_URL/);
    assert.match(result.reason, /Vercel dashboard/);
    assert.match(result.reason, /redeploy/);
    assert.throws(() => assertPreviewIsolation(pointedAtProduction), /PREVIEW/);
  });

  test('a preview on its own database is fine', () => {
    const result = describeIsolation({ VERCEL_ENV: 'preview', SUPABASE_URL: `https://${OTHER_REF}.supabase.co` });
    assert.equal(result.isolated, true);
    assert.doesNotThrow(() => assertPreviewIsolation({ VERCEL_ENV: 'preview', SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }));
  });

  test('and a URL that is not Supabase at all is not claimed as an isolation failure', () => {
    // The config validation has more to say about that, and reporting it here
    // would send somebody looking in the wrong place.
    const result = describeIsolation({ VERCEL_ENV: 'preview', SUPABASE_URL: 'http://localhost:54321' });
    assert.equal(result.isolated, true);
  });
});

describe('AND PRODUCTION IS NEVER REFUSED', () => {
  test('whatever it is pointed at', () => {
    /*
     * The one-directional property, and the reason this check is allowed to
     * exist at all. This project's standing rule is that failing to boot turns
     * a configuration mistake into a total outage - which is usually worse
     * than the mistake. The exception is when the thing failing to boot is not
     * production: a dead preview costs one branch and is fixed in a dashboard.
     *
     * If this ever throws for production, the check has become the outage it
     * was written to avoid.
     */
    for (const env of [
      { VERCEL_ENV: 'production', SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` },
      { VERCEL_ENV: 'production', SUPABASE_URL: `https://${OTHER_REF}.supabase.co` },
      { VERCEL_ENV: 'production', SUPABASE_URL: undefined },
      {},
      { SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` },
    ]) {
      assert.doesNotThrow(() => assertPreviewIsolation(env), `refused for ${JSON.stringify(env)}`);
    }
  });
});

describe('both halves are guarded, because both can reach the database', () => {
  const config = readSource(new URL('../src/config.js', import.meta.url));
  const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
  const viteConfig = readRaw(new URL('../../web/vite.config.js', import.meta.url));
  const browser = readSource(new URL('../../web/src/lib/environment.js', import.meta.url));
  const eslint = readSource(new URL('../../eslint.config.js', import.meta.url));

  test('THE SERVER CHECKS BEFORE IT BUILDS ITS CONFIG', () => {
    // Order matters: a pointed-at-production preview should refuse for that
    // reason, not fall over later complaining about something else.
    const check = config.indexOf('assertPreviewIsolation');
    const build = config.indexOf('buildConfig(process.env)');
    assert.ok(check > 0 && build > check, 'the isolation check runs after the config is built');
  });

  test('AND THE BROWSER CHECKS TOO, BECAUSE THE URL IS IN THE BUNDLE', () => {
    /*
     * The half a server-side check cannot cover. VITE_SUPABASE_URL is compiled
     * into the bundle, so a preview build carrying production's URL talks to
     * production from the page - Supabase Auth and any direct PostgREST call
     * go straight out, whatever the API is configured with.
     */
    assert.match(app, /previewPointsAtProduction\(config\.supabaseUrl\)/);
    const guard = app.indexOf('previewPointsAtProduction');
    const providers = app.indexOf('<I18nProvider>');
    assert.ok(guard > 0 && providers > guard, 'the app mounts before the check runs');
  });

  test('the two copies of the production ref agree', () => {
    // Public by design - it is half of VITE_SUPABASE_URL and is in every
    // bundle - but two copies of one constant is a thing that drifts.
    assert.match(browser, new RegExp(`PRODUCTION_SUPABASE_REF = '${PRODUCTION_SUPABASE_REF}'`));
  });

  test('and the build environment reaches the bundle at all', () => {
    // A browser cannot read the build's environment at runtime, so it is
    // replaced at build time - the same mechanism as __BUILD_ID__, and the
    // same failure if it is forgotten: undefined, then dead-code-eliminated.
    assert.match(viteConfig, /__VERCEL_ENV__: JSON\.stringify\(process\.env\.VERCEL_ENV/);
    assert.match(eslint, /__VERCEL_ENV__: 'readonly'/);
  });

  test('a preview says so on every page', () => {
    // Confusing a preview tab for the live site is the mistake a preview
    // environment makes possible, and it is made by looking at a page that is
    // identical to production in every other way.
    assert.match(app, /isPreviewBuild\(\) && \(/);
    assert.match(app, /Preview build/);
  });

  test('the reasoning survives, because a refusal to boot always looks wrong', () => {
    assert.match(
      readRaw(new URL('../src/lib/environment.js', import.meta.url)),
      phrase('a preview that is CONFIGURED as isolated but is quietly still pointed at')
    );
  });
});

describe('the migrations can rebuild the database', () => {
  const replay = readSource(new URL('../../scripts/replay-migrations.mjs', import.meta.url));
  const runbook = readRaw(new URL('../../docs/RUNBOOK.md', import.meta.url));

  test('IT REFUSES THE PRODUCTION PROJECT BY REF', () => {
    // A connection string is one paste away from being the wrong one, and the
    // wrong one here recreates a schema over live data.
    assert.match(replay, /connectionString\.includes\(PRODUCTION_SUPABASE_REF\)/);
    // Imported rather than retyped: a third copy of the ref is a third thing
    // to keep in step.
    assert.match(replay, /from '\.\.\/server\/src\/lib\/environment\.js'/);
  });

  test('AND IT REFUSES ANY DATABASE THAT IS NOT EMPTY', () => {
    // The check is on the TARGET rather than on a flag somebody passes,
    // because a flag is the thing that gets passed by habit.
    assert.match(replay, /table_schema = 'public' and table_type = 'BASE TABLE'/);
    assert.match(replay, /Refusing to run: this database already has/);
  });

  test('each file gets its own transaction', () => {
    // Postgres makes DDL transactional, so a file that fails halfway leaves
    // nothing behind and the replay stops at a known point - which is what
    // makes "start again from empty" a recovery rather than a guess.
    assert.match(replay, /await client\.query\('begin'\)/);
    assert.match(replay, /await client\.query\('rollback'\)/);
  });

  test('and the order is the filename order, said out loud', () => {
    assert.match(replay, /lexical order IS the order/);
  });

  test('a failure says the whole recovery, not just the error', () => {
    assert.match(replay, /replay from empty rather than patching around it/);
  });

  test('no log line can carry the password', () => {
    // The connection string holds one, and a script that prints where it is
    // connecting is a script that prints it. readRaw for the reasoning,
    // readSource for the absence - the eighth time that distinction has
    // mattered in this repository.
    assert.match(
      readRaw(new URL('../../scripts/replay-migrations.mjs', import.meta.url)),
      /Just the host, so a log line never carries the password/
    );
    // Precisely: the string is never interpolated and never passed straight to
    // a console call. `hostOf(connectionString)` is the only way it is allowed
    // near one, which the first version of this assertion flagged as a
    // violation - a check too blunt to tell the safe use from the unsafe one.
    assert.doesNotMatch(replay, /\$\{connectionString\}/);
    assert.doesNotMatch(replay, /console\.(log|error)\(\s*connectionString/);
    assert.match(replay, /hostOf\(connectionString\)/);
  });

  test('the runbook tells somebody it exists', () => {
    assert.match(runbook, /npm run db:replay/);
  });
});
