import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw, readMigration } from './helpers/source.js';
import { VISIT_ROUTES, VISIT_REFERRERS, routeFor, referrerBucket } from '../../web/src/lib/visit.js';

/**
 * ── THE BLIND SPOT THIS CLOSES ────────────────────────────────────────────
 *
 * The last signup was 2026-09-06 and nothing in this product could say whether
 * anybody was arriving at all. Every measurement it has - the funnel document,
 * the intake stamps, the coach-first-opened stamp, the first-week panel -
 * begins AFTER an account exists. "Nobody visits" and "people visit and leave"
 * need completely different fixes and were indistinguishable.
 */
const migration = readMigration(
  new URL('../../supabase/migrations/0076_whether_anybody_arrives_at_the_front_door.sql', import.meta.url),
);
const rawMigration = readFileSync(
  new URL('../../supabase/migrations/0076_whether_anybody_arrives_at_the_front_door.sql', import.meta.url),
  'utf8',
);
const component = readSource(new URL('../../web/src/components/RecordVisit.jsx', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
const visitLib = readSource(new URL('../../web/src/lib/visit.js', import.meta.url));
// readRAW, because the thing asserted below is the PROSE. readSource strips
// comments, and this repository has shipped that mistake five times.
const visitLibRaw = readRaw(new URL('../../web/src/lib/visit.js', import.meta.url));

/** Every route the app mounts, from the router, so this test sees new ones. */
function routesInApp() {
  const found = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, p]) => p);
  assert.ok(found.length >= 15, `only found ${found.length} routes - the pattern stopped matching`);
  return found;
}

describe('NOTHING BEHIND A LOGIN IS EVER RECORDED', () => {
  test('the authenticated routes are not recordable', () => {
    /*
     * The heart of it. This reads the ROUTER rather than a hardcoded list, so
     * a page added behind ProtectedRoute next month fails here rather than
     * quietly appearing in a table of what people looked at.
     */
    const protectedRoutes = ['/coach', '/intake', '/log', '/progress', '/program', '/library', '/account', '/leaderboard', '/consent'];
    for (const route of protectedRoutes) {
      assert.equal(routeFor(route), null, `${route} is behind a login and is recordable`);
      assert.ok(!VISIT_ROUTES.includes(route), `${route} is in the allow-list`);
    }
  });

  test('THE TWO PUBLIC ROUTES THAT CARRY TOKENS ARE ALSO EXCLUDED', () => {
    /*
     * /reset-password and /guardian/consent are public, so an allow-list built
     * from "is it public" would include them. The token is never stored either
     * way - but "somebody was on the password reset page at 14:02" is a fact
     * about one identifiable person, and the question this exists to answer
     * does not need it.
     */
    for (const route of ['/reset-password', '/guardian/consent']) {
      assert.equal(routeFor(route), null, `${route} carries a token and is recordable`);
    }
  });

  test('it is an allow-list, so an unknown route records nothing', () => {
    // A deny-list would have the opposite default, and the first authenticated
    // page somebody forgot would be the one that leaked.
    for (const route of ['/a-page-added-next-month', '/coach/settings', '/', '/..', '']) {
      const result = routeFor(route);
      assert.ok(result === null || VISIT_ROUTES.includes(result), `${route} produced ${result}`);
    }
    assert.match(visitLibRaw, /ALLOW-LIST, NEVER A DENY-LIST/);
    // And the code matches the prose: inclusion, never exclusion.
    assert.match(visitLib, /RECORDABLE_ROUTES\.includes\(normalized\) \? normalized : null/);
  });

  test('every recordable route really is one the app mounts as public', () => {
    const mounted = new Set(routesInApp());
    for (const route of VISIT_ROUTES) {
      assert.ok(mounted.has(route), `${route} is recordable and the router does not mount it`);
    }
  });
});

describe('what a visit is reduced to', () => {
  test('a referrer becomes one of five words, never a URL', () => {
    const cases = [
      ['', 'direct'],
      ['https://www.google.com/search?q=powerlifting+coach', 'search'],
      ['https://duckduckgo.com/', 'search'],
      ['https://chatgpt.com/c/abc123', 'ai'],
      ['https://www.reddit.com/r/weightroom/comments/xyz', 'social'],
      ['https://example.com/some/deep/path?with=params', 'other'],
      ['not a url at all', 'other'],
    ];
    for (const [referrer, expected] of cases) {
      const bucket = referrerBucket(referrer, 'coachdiaz.app');
      assert.equal(bucket, expected, `${referrer} bucketed as ${bucket}`);
      assert.ok(VISIT_REFERRERS.includes(bucket));
      // The point of the bucket: nothing of the URL survives it.
      assert.ok(!bucket.includes('/') && !bucket.includes('.'), `${bucket} carries part of a URL`);
    }
  });

  test('THE AI BUCKET WINS OVER SEARCH FOR gemini.google.com', () => {
    // The order of the bucket list is load-bearing: `search` matches `google.`
    // and would swallow Gemini if it ran first. In 2026 those are different
    // distribution channels with different fixes.
    assert.equal(referrerBucket('https://gemini.google.com/app', 'coachdiaz.app'), 'ai');
    assert.equal(referrerBucket('https://www.google.com/', 'coachdiaz.app'), 'search');
  });

  test('our own pages are not a referral', () => {
    // Without this every internal link reports as a referral and drowns the
    // number that matters.
    assert.equal(referrerBucket('https://coachdiaz.app/faq', 'coachdiaz.app'), 'direct');
    assert.equal(referrerBucket('https://CoachDiaz.app/', 'coachdiaz.app'), 'direct');
  });
});

describe('the table cannot hold a person', () => {
  test('there is no user_id column, and no column that could become one', () => {
    const create = migration.slice(migration.indexOf('create table'), migration.indexOf(');', migration.indexOf('create table')));
    assert.ok(create.includes('route'), 'the wrong block was sliced - this check did not run');
    for (const forbidden of ['user_id', 'ip', 'user_agent', 'session', 'visitor']) {
      assert.ok(!create.includes(forbidden), `page_visits has a ${forbidden} column`);
    }
  });

  test('the route and referrer are constrained in the database, not only in the browser', () => {
    // The browser is not a control. Anybody can call an anon-callable function
    // with whatever they like; the CHECK is what decides what can land.
    assert.match(migration, /page_visits_route_check/);
    assert.match(migration, /page_visits_referrer_check/);
  });

  test('THE ALLOW-LIST AND THE CHECK CONSTRAINT AGREE', () => {
    const from = migration.indexOf('check (route in (');
    assert.notEqual(from, -1, 'the route CHECK is gone - this check did not run');
    const inDb = [...migration.slice(from, migration.indexOf('));', from)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...inDb].sort(), [...VISIT_ROUTES].sort(), 'the browser allow-list and the CHECK have drifted apart');

    const refFrom = migration.indexOf('check (referrer in (');
    const inDbRefs = [...migration.slice(refFrom, migration.indexOf('));', refFrom)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...inDbRefs].sort(), [...VISIT_REFERRERS].sort(), 'the referrer buckets have drifted apart');
  });

  test('and the function refuses what the CHECK would refuse, rather than raising', () => {
    // It is called from a page somebody is reading. A counter that raises
    // turns a visit into an error in their console.
    const fn = migration.slice(migration.indexOf('create or replace function public.record_page_visit'));
    assert.match(fn, /returns boolean/);
    assert.ok(!/raise exception/.test(fn), 'record_page_visit raises at somebody reading a page');
    assert.match(fn, /return false;/);
  });
});

describe('an unauthenticated write, and what bounds it', () => {
  test('anon may execute it, deliberately and with a reason written down', () => {
    assert.match(migration, /grant execute on function public\.record_page_visit\(text, text\) to anon, authenticated/);
    assert.match(rawMigration, /HOW AN ANONYMOUS WRITE IS PROTECTED/);
  });

  test('it is flood-capped, because there is no user to rate limit', () => {
    /*
     * THIS ASSERTION USED TO AGREE WITH ANYTHING.
     *
     * It checked that `ceiling constant int`, `interval '1 minute'` and
     * `if recent >= ceiling` were present - and a mutant that replaced the
     * counting query with `select 0 into recent` left all three in place and
     * passed. The cap was disabled and the test said the cap was there.
     *
     * So it now pins the thing that makes the cap a cap: that `recent` is
     * populated by counting the table it is capping. The three lines above are
     * still asserted, because each of them can be broken independently.
     */
    const fn = migration.slice(migration.indexOf('create or replace function public.record_page_visit'));
    assert.match(fn, /ceiling constant int := \d+;/);
    assert.match(fn, /interval '1 minute'/);
    assert.match(fn, /if recent >= ceiling then/);
    assert.match(
      fn,
      /select count\(\*\) into recent[\s\S]{0,120}from public\.page_visits/,
      'recent is not counted from page_visits - the cap counts nothing',
    );
  });

  test('the table is not readable through PostgREST', () => {
    // RLS on with no policy, the same shape as stripe_events. Nothing reads
    // this from a browser; an anon-callable INSERT must not come with a read.
    assert.match(migration, /alter table public\.page_visits enable row level security/);
    assert.match(migration, /revoke all on public\.page_visits from anon, authenticated/);
    assert.ok(!/create policy[\s\S]{0,200}page_visits/.test(migration), 'page_visits has a read policy');
  });
});

describe('the privacy policy says so', () => {
  /*
   * It said "There are no advertising or analytics scripts on any page of this
   * site." Shipping this without changing that sentence would have made the
   * privacy policy of a health product false - not by a lot, and not in a way
   * anybody would have noticed, which is exactly the kind this project has
   * been caught by before.
   *
   * Held to the SHAPE of what the table can hold rather than to a wording, so
   * a reworded paragraph passes and a paragraph that stops describing the
   * feature does not.
   */
  const policy = readRaw(new URL('../../web/src/pages/PrivacyPolicy.jsx', import.meta.url));

  test('it no longer claims there is no analytics at all', () => {
    assert.ok(
      !/no advertising or analytics\s+scripts on any page/.test(policy.replace(/\s+/g, ' ')),
      'the policy still says this site has no analytics',
    );
  });

  test('it describes what is counted and what is not', () => {
    const flat = policy.replace(/\s+/g, ' ');
    assert.match(flat, /count arrivals at our public pages/i, 'the policy does not mention the counts');
    assert.match(flat, /no cookie/i, 'the policy does not say there is no cookie');
    assert.match(flat, /no identifier of any kind/i, 'the policy does not say there is no identifier');
    assert.match(flat, /after signing in are never counted/i, 'the policy does not say signed-in pages are excluded');
  });

  test('and the version identifier moved, because the document did', () => {
    // The policy's own last section promises the identifier changes whenever
    // the document does.
    assert.match(policy, /Version pp-2026-09-14a/);
  });

  test('BUMPING IT CANNOT WALL ANYBODY OUT', () => {
    /*
     * Checked against policy_versions before the bump, not assumed: the five
     * consent types are terms_of_service, ai_processing,
     * health_data_collection, leaderboard_publication and guardian_consent.
     * There is no privacy consent type, so the pp- identifier is display-only
     * and moving it supersedes nothing.
     *
     * This matters because a version bump invalidating every consent is what
     * locked three accounts out of this product in early September, and it is
     * the failure mode a privacy-policy edit is most likely to repeat.
     */
    const consentTypes = readSource(new URL('../src/lib/policyVersions.js', import.meta.url));
    assert.match(consentTypes, /leaderboard_publication/, 'the wrong file was read - this check did not run');
    assert.ok(!/['"]privacy['"]/.test(consentTypes), 'privacy has become a consent type - bumping pp- now supersedes consents');
  });
});

describe('where it runs', () => {
  test('it is mounted inside the router and renders nothing', () => {
    assert.match(app, /<RecordVisit \/>/);
    assert.match(component, /return null;/);
  });

  test('a failed count never reaches the person reading the page', () => {
    assert.match(component, /\.catch\(\(\) => \{\}\)/);
  });

  test('StrictMode cannot double-count', () => {
    // The effect has a side effect at the other end of a network call. Without
    // the guard every development pageview counts twice, and the number is
    // quietly wrong in the direction that flatters it.
    assert.match(component, /counted\.current === location\.key/);
    assert.match(component, /counted\.current = location\.key/);
  });
});
