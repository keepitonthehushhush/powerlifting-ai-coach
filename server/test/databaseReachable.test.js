import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw, readSource } from './helpers/source.js';
/*
 * Read as source rather than imported. The module reaches lib/supabase.js,
 * which reaches config, which refuses to build without ANTHROPIC_API_KEY - so
 * importing it here would make this file require a live environment to assert
 * things about text. Several tests in this suite work the same way for the
 * same reason.
 */

/**
 * ── WHY /api/health NOW TOUCHES THE DATABASE ──────────────────────────────
 *
 * It read environment variables and nothing else, so it answered
 * `status: "ok"` whether or not a database existed - the same defect this
 * repository keeps finding in its own controls, a check that answers
 * confidently without looking.
 *
 * And it had a specific, likely trigger rather than a theoretical one.
 * Supabase pauses a FREE project after about a week of low activity; this app
 * went 2026-09-04 to 2026-09-06 with no traffic at all, and a quiet week is
 * the normal state of a product that has not launched. Through such a week the
 * daily deployment check would have reported production healthy every morning
 * while every request that needed data failed.
 */

const source = readRaw(new URL('../src/lib/databaseReachable.js', import.meta.url));
const stripped = readSource(new URL('../src/lib/databaseReachable.js', import.meta.url));
const app = readRaw(new URL('../src/app.js', import.meta.url));
const migration = readRaw(
  new URL('../../supabase/migrations/0059_three_things_the_linter_found.sql', import.meta.url)
);
const runbook = readRaw(new URL('../../docs/runbooks/daily-deployment-check.md', import.meta.url));

describe('health means the database answered', () => {
  test('THE ROUTE ASKS THE DATABASE, NOT ONLY THE ENVIRONMENT', () => {
    const route = app.slice(app.indexOf("app.get('/api/health'"), app.indexOf('app.use(\'/api\', requireAuth)'));
    assert.ok(route.length > 200, 'the health route could not be found - this check did not run');
    assert.match(route, /await databaseReachable\(\)/, 'health does not consult the database');
  });

  test('and an unreachable database is a 503, not a 200 that says ok', () => {
    // The whole point. A 200 here is what let an outage look healthy.
    const route = app.slice(app.indexOf("app.get('/api/health'"), app.indexOf("deploymentId"));
    assert.match(route, /503/);
    assert.match(route, /'degraded'/);
  });

  test('but an UNCONFIGURED database is not an outage', () => {
    /*
     * A deployment with no Supabase keys is the free product being developed,
     * not a broken one. Conflating the two would make every local run report
     * itself down - and a check that cries wolf gets switched off.
     */
    assert.match(source, /'unconfigured'/);
    const route = app.slice(app.indexOf("app.get('/api/health'"), app.indexOf("deploymentId"));
    assert.match(route, /database === 'unreachable' \? 503 : 200/);
  });
});

describe('it takes no privilege it does not need', () => {
  test('IT DOES NOT USE THE SERVICE-ROLE CLIENT', () => {
    /*
     * The first version did, and billing.test.js caught it: ADR-12 allows
     * exactly one importer of supabaseAdmin and it is the Stripe webhook, with
     * the comment "if a second importer appears, the exception has stopped
     * being an exception". A liveness check is a poor reason to widen the one
     * component in the system that bypasses RLS.
     */
    assert.doesNotMatch(stripped, /supabaseAdmin/, 'the health probe reaches for the admin client');
    assert.match(source, /createAnonymousClient/);
  });

  test('the function it calls reads nothing at all', () => {
    // A liveness probe that selects from a table makes an unauthenticated
    // endpoint's success depend on somebody's rows. This returns a constant.
    const fn = migration.slice(migration.indexOf('create or replace function public.database_awake'));
    assert.ok(fn.length > 100, 'database_awake is gone - this check did not run');
    assert.match(fn, /select true/);
    assert.doesNotMatch(fn.slice(0, fn.indexOf('$fn$;')), /\bfrom\s+\w/i, 'the liveness probe reads a table');
    assert.doesNotMatch(fn.slice(0, fn.indexOf('$fn$;')), /security definer/i);
  });
});

describe('the answer is cached, because the endpoint is public', () => {
  test('a flood costs at most one query per minute per instance', () => {
    /*
     * /api/health is unauthenticated on purpose - the maintenance page polls
     * it - so a database round trip per request is an endpoint anybody can use
     * to make us open connections.
     */
    const ttl = source.match(/export const DB_CHECK_TTL_MS = ([\d_]+);/);
    assert.ok(ttl, 'DB_CHECK_TTL_MS is gone - this check did not run');
    assert.equal(Number(ttl[1].replace(/_/g, '')), 60_000);
    assert.match(source, /now - cached\.at < DB_CHECK_TTL_MS/);
  });

  test('and it never rejects, whatever the database does', () => {
    // /api/health must not 500 because the database is down. Saying so is its
    // entire job, and a probe that throws takes the answer with it.
    /*
     * `stripped`, not `source`. An absence assertion against raw text matches
     * the PROSE - the first version of this failed on the words "thrown away"
     * and "A throw and" inside two comments, which is the readSource/readRaw
     * rule this repository has now relearned in a brand-new file.
     */
    const body = stripped.slice(stripped.indexOf('export async function databaseReachable'));
    assert.ok(body.length > 100, 'the function could not be found - this check did not run');
    assert.match(body, /catch/);
    assert.doesNotMatch(body, /\bthrow\b/, 'the probe can reject, which takes the answer with it');
  });
});

describe('the keepalive is written down where somebody will act on it', () => {
  test('the reason the probe exists is in the code, not only in a commit', () => {
    // A round trip that looks pointless is a round trip somebody deletes.
    assert.match(source, /pauses a FREE project/i);
    assert.match(migration, /pauses a FREE project/i);
  });

  test('and the daily check is the thing that polls it', () => {
    // The keepalive only works if something actually calls it every day. The
    // daily runbook already fetches /api/health for a different reason, which
    // is why this costs nothing extra.
    assert.match(runbook, /api\/health/);
  });
});
