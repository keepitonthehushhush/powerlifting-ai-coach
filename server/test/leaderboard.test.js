import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES } from '../src/lib/errorCodes.js';
import { readSource, readRaw, phrase, readProfileApi } from './helpers/source.js';
import { rankEntries, toKg, fromKg, BOARDS } from '../src/lib/leaderboard.js';
import { canonicalLift } from '../src/lib/progression.js';

const migration = readRaw(new URL('../../supabase/migrations/0026_leaderboard.sql', import.meta.url));
const invariants = readRaw(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));
const route = readSource(new URL('../src/routes/leaderboard.js', import.meta.url));
const progression = readRaw(new URL('../src/lib/progression.js', import.meta.url));

describe('the leaderboard cannot leak what it does not hold', () => {
  test('THE PUBLISHED TABLE HAS NO HEALTH DATA, AND NO COLUMN ONE COULD HIDE IN', () => {
    const table = migration.slice(
      migration.indexOf('create table if not exists public.leaderboard_entries'),
      migration.indexOf(');', migration.indexOf('create table if not exists public.leaderboard_entries')),
    );
    for (const forbidden of [
      'bodyweight', 'weight_class', 'date_of_birth', 'birth', 'age', 'sex', 'gender',
      'health', 'injur', 'restriction', 'email', 'notes', 'location', 'city',
    ]) {
      assert.ok(
        !table.toLowerCase().includes(forbidden),
        `leaderboard_entries has a "${forbidden}" column - it is readable by every signed-in user`,
      );
    }
  });

  test('it is a separate table, not a view over the profile', () => {
    // A wrong policy on a view over user_profile exposes date of birth and
    // health restrictions. A wrong policy here exposes a handle and three
    // numbers somebody published on purpose.
    assert.ok(!/create (or replace )?view/i.test(migration));
    assert.match(migration, phrase('The blast radius is the column list'));
  });

  test('and the cross-user read is scoped to that table alone', () => {
    const policies = migration.match(/create policy [\s\S]*?;/g) ?? [];
    assert.equal(policies.length, 1, 'more than one policy was created');
    assert.match(policies[0], /on public\.leaderboard_entries/);
    assert.match(policies[0], /for select/);
  });
});

describe('the numbers cannot be self-reported', () => {
  test('AUTHENTICATED IS GRANTED SELECT AND NOTHING ELSE', () => {
    // The whole integrity property. The browser holds a real JWT and can talk
    // to PostgREST directly; with insert or update granted, anybody who opened
    // the network tab could set their squat to 9999 and RLS would allow it,
    // because it is their row.
    assert.match(migration, /grant select on public\.leaderboard_entries to authenticated;/);
    assert.ok(
      !/grant[^;]*\b(insert|update|delete)\b[^;]*public\.leaderboard_entries[^;]*to authenticated/i.test(migration),
      'authenticated has a write privilege on the published table',
    );
  });

  test('there is no insert, update or delete policy for anybody', () => {
    assert.ok(!/create policy[\s\S]*?for (insert|update|delete)/i.test(migration));
  });

  test('and neither writing function accepts a number', () => {
    // refresh takes nothing; opt-in takes a boolean. There is no argument
    // through which a weight could arrive.
    assert.match(migration, /create or replace function public\.refresh_leaderboard_entry\(\)/);
    assert.match(migration, /create or replace function public\.set_leaderboard_opt_in\(opt_in boolean\)/);
    assert.ok(!/function public\.(refresh_leaderboard_entry|set_leaderboard_opt_in)\([^)]*numeric/i.test(migration));
  });

  test('the functions are SECURITY DEFINER with a pinned search_path', () => {
    // Both halves. A definer function without a pinned search_path is the
    // classic privilege-escalation shape.
    const fns = migration.match(/create or replace function public\.(refresh_leaderboard_entry|set_leaderboard_opt_in)[\s\S]*?\$fn\$|create or replace function public\.(refresh_leaderboard_entry|set_leaderboard_opt_in)[\s\S]*?\$\$/g) ?? [];
    assert.ok(fns.length >= 2, 'could not find both functions');
    for (const fn of fns) {
      assert.match(fn, /security definer/);
      assert.match(fn, /set search_path = public, pg_temp/);
    }
  });

  test('only completed lifts count', () => {
    // A missed rep is a record of an attempt, not of a lift.
    assert.match(migration, /where user_id = uid and completed/);
  });
});

describe('leaving is a delete, not a flag', () => {
  test('withdrawing removes the row', () => {
    assert.match(migration, /delete from public\.leaderboard_entries where user_id = uid;/);
    assert.match(migration, phrase('A hidden row is still a row'));
  });

  test('joining and leaving are the same call, so leaving is not harder', () => {
    assert.match(route, /rpc\('set_leaderboard_opt_in', \{ opt_in: optIn \}\)/);
    assert.match(migration, phrase('withdrawal must be no harder than consent'));
  });

  test('and joining without a handle is refused, not defaulted', () => {
    // Publishing somebody under an email or a uuid must not be reachable by
    // accident.
    assert.match(migration, /raise exception 'display_name_required'/);
    // The route no longer invents a per-site code string: the KIND is
    // precondition_missing and the thing still missing travels beside it, so
    // the client can act on either.
    assert.match(route, /codedError\('precondition_missing'[\s\S]{0,140}needs: 'display_name'/);
    assert.equal(ERROR_CODES.precondition_missing.status, 400);
  });
});

describe('the handle', () => {
  test('is constrained to characters that cannot impersonate or inject', () => {
    assert.match(migration, /display_name ~ '\^\[A-Za-z0-9_-\]\+\$'/);
    assert.match(migration, /length\(display_name\) between 3 and 24/);
  });

  test('and is unique case-insensitively, because "Eddy" and "eddy" is a bug report', () => {
    assert.match(migration, /create unique index[\s\S]*?lower\(display_name\)/);
  });
});

describe('THE SPELLING LIST IN SQL MATCHES THE ONE IN JAVASCRIPT', () => {
  /**
   * The bug this catches is the one the first draft of the migration had:
   * progress_logs.lift stores what the athlete typed, so `lift = 'squat'`
   * silently ranks only the people who typed the shortest spelling. It
   * produces numbers. The numbers are wrong. Nothing fails.
   *
   * The SQL list is a copy, and a copy drifts, so the copy is checked.
   */
  const sqlPairs = new Map(
    [...migration.matchAll(/\('([a-z ]+)', '(squat|bench|deadlift|press)'\)/g)].map((m) => [m[1], m[2]]),
  );
  const jsPairs = new Map(
    [...progression.matchAll(/'([a-z ]+)'/g)]
      .map((m) => m[1])
      .filter((spelling) => canonicalLift(spelling) !== null)
      .map((spelling) => [spelling, canonicalLift(spelling)]),
  );

  test('every spelling JavaScript normalises, SQL normalises the same way', () => {
    for (const [spelling, canonical] of jsPairs) {
      assert.equal(
        sqlPairs.get(spelling), canonical,
        `"${spelling}" normalises to "${canonical}" in progression.js but ${
          sqlPairs.has(spelling) ? `"${sqlPairs.get(spelling)}"` : 'is missing'
        } in migration 0026`,
      );
    }
  });

  test('and SQL invents nothing JavaScript does not know', () => {
    for (const [spelling, canonical] of sqlPairs) {
      assert.equal(
        canonicalLift(spelling), canonical,
        `migration 0026 maps "${spelling}" to "${canonical}" and progression.js does not`,
      );
    }
  });

  test('the lists are the same size, so neither has an extra', () => {
    assert.equal(sqlPairs.size, jsPairs.size);
    assert.ok(sqlPairs.size >= 20, 'the parity check parsed suspiciously few spellings');
  });
});

describe('ranking across units', () => {
  const rows = [
    { display_name: 'kglifter', best_squat: 200, best_bench: null, best_deadlift: 250, units: 'kg' },
    { display_name: 'lblifter', best_squat: 405, best_bench: 315, best_deadlift: 500, units: 'lb' },
    { display_name: 'newcomer', best_squat: null, best_bench: null, best_deadlift: null, units: 'lb' },
  ];

  test('A KG 200 OUTRANKS AN LB 405, WHICH RAW SORTING WOULD GET BACKWARDS', () => {
    // 200 kg is 440 lb. Sorting the raw column puts 405 first and looks fine
    // doing it: the list is ordered and the numbers are real.
    const boards = rankEntries(rows, 'lb');
    assert.equal(boards.squat[0].displayName, 'kglifter');
    assert.equal(boards.squat[1].displayName, 'lblifter');
  });

  test('and the viewer sees their own units, marked when converted', () => {
    const boards = rankEntries(rows, 'lb');
    assert.equal(boards.squat[0].weight, 440.9);
    assert.equal(boards.squat[0].converted, true);
    assert.equal(boards.squat[0].loggedWeight, 200);
    assert.equal(boards.squat[0].loggedUnits, 'kg');
    // The viewer's own unit is not "converted", even though it was compared.
    assert.equal(boards.squat[1].converted, false);
  });

  test('a kg viewer sees the same order, in kg', () => {
    const boards = rankEntries(rows, 'kg');
    assert.equal(boards.squat[0].displayName, 'kglifter');
    assert.equal(boards.squat[0].weight, 200);
    assert.equal(boards.squat[0].converted, false);
  });

  test('NOBODY APPEARS ON A BOARD FOR A LIFT THEY HAVE NOT LOGGED', () => {
    // A null rendered as "—" still occupies a rank, and a zero reads as a
    // score. Both are worse than absence.
    const boards = rankEntries(rows, 'lb');
    assert.equal(boards.bench.length, 1);
    assert.equal(boards.bench[0].displayName, 'lblifter');
    assert.ok(!boards.squat.some((e) => e.displayName === 'newcomer'));
  });

  test('ranks are dense and start at one', () => {
    const boards = rankEntries(rows, 'lb');
    for (const lift of BOARDS) {
      boards[lift].forEach((entry, index) => assert.equal(entry.rank, index + 1));
    }
  });

  test('the conversion is the exact international definition, both ways', () => {
    assert.equal(toKg(1, 'lb'), 0.45359237);
    assert.equal(toKg(100, 'kg'), 100);
    assert.ok(Math.abs(fromKg(toKg(315, 'lb'), 'lb') - 315) < 1e-9);
  });

  test('an empty board is an empty array, not a crash', () => {
    const boards = rankEntries([], 'lb');
    for (const lift of BOARDS) assert.deepEqual(boards[lift], []);
  });
});

describe('the route stays inside ADR-1', () => {
  test('it reads with the caller JWT, not the service role', () => {
    // The day somebody reaches for the admin client to build a feature is the
    // day the ADR-12 exception stops being one.
    assert.match(route, /req\.supabase/);
    assert.ok(!/supabaseAdmin/.test(route));
  });

  test('and it sends no identifier for anybody but the viewer', () => {
    assert.ok(!/user_id/.test(route), 'the route selects or returns user_id');

    /**
     * This used to pin the select string literally, including `updated_at`,
     * and so refused the change that REMOVED it - the seventh assertion in
     * this repository to pin call text and then block a correct edit.
     *
     * What it means is that the route asks for published columns and nothing
     * else, so it is written that way. And since migration 0039 the database
     * agrees: `authenticated` holds a column grant on exactly these five, so a
     * route asking for a sixth no longer returns extra data - it 403s the
     * whole request, which would take the leaderboard down rather than leak.
     */
    const asked = route.match(/\.from\('leaderboard_entries'\)\s*\.select\('([^']+)'\)/);
    assert.ok(asked, 'could not find what the route selects from leaderboard_entries');

    const PUBLISHED = ['display_name', 'best_squat', 'best_bench', 'best_deadlift', 'units'];
    const extra = asked[1].split(',').map((c) => c.trim()).filter((c) => !PUBLISHED.includes(c));
    assert.deepEqual(
      extra,
      [],
      `the route selects ${extra.join(', ')}, which migration 0039 does not grant - ` +
        'the request will fail entirely, and the leaderboard document says these are not published'
    );
  });

  test('and the database grants exactly those five columns, not the table', () => {
    // The privilege is the control, not the select list. A table-wide grant
    // means the browser can ask PostgREST directly for user_id and updated_at
    // whatever our route does - which it could, for three days.
    const grants = readRaw(
      new URL('../../supabase/migrations/0039_the_leaderboard_publishes_five_columns.sql', import.meta.url)
    );
    assert.match(grants, /revoke select on public\.leaderboard_entries from authenticated/);
    assert.match(
      grants,
      /grant select \(display_name, best_squat, best_bench, best_deadlift, units\)/
    );
    // And the invariant that asks the live catalog, since a later migration
    // could re-grant the table and no migration file would look wrong.
    assert.match(invariants, /AND CANNOT READ THE COLUMNS THE LEADERBOARD DOES NOT PUBLISH/);
  });
});

describe('the page', () => {
  const page = readSource(new URL('../../web/src/pages/Leaderboard.jsx', import.meta.url));
  const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
  const nav = readSource(new URL('../../web/src/components/SiteNav.jsx', import.meta.url));
  const styles = readRaw(new URL('../../web/src/styles.css', import.meta.url));
  const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
  const profileRoute = readProfileApi();

  test('it is behind the sign-in gate, because the board is not public', () => {
    // Opting in publishes to other athletes, not to the internet.
    assert.match(app, /path="\/leaderboard"[\s\S]{0,120}<ProtectedRoute>/);
    assert.match(nav, /to: '\/leaderboard'/);
  });

  test('WHAT GETS PUBLISHED IS STATED BEFORE ANYBODY CAN JOIN', () => {
    // Consent to publish is worth nothing if what is published is a surprise.
    assert.match(page, /whatIsShown/);
    assert.match(en, phrase('nothing else. Not your bodyweight, not your age'));
    assert.ok(
      page.indexOf('whatIsShown') < page.indexOf("t('leaderboard.join')"),
      'the join button appears before the disclosure',
    );
  });

  test('the handle is asked for in the same action that needs it', () => {
    // A name requested on a separate screen is how somebody clicks Join and is
    // told to go elsewhere. It is a prerequisite, so it lives in the action.
    assert.match(page, /handleLabel/);
    assert.match(page, /display_name: handle/);
  });

  test('and join is disabled until the handle would actually be accepted', () => {
    // Prevented rather than reported: the same rule as the CHECK in 0026 and
    // the zod schema, so the button cannot produce a refusal.
    assert.match(page, /\/\^\[A-Za-z0-9_-\]\{3,24\}\$\/\.test\(handle\)/);
    assert.match(profileRoute, /regex\(\/\^\[A-Za-z0-9_-\]\+\$\/\)/);
  });

  test('leaving says it deletes, because that is what it does', () => {
    assert.match(en, phrase('Leaving deletes your leaderboard entry rather than hiding it'));
  });

  test('the board says the numbers cannot be typed in', () => {
    assert.match(en, phrase('they cannot be typed in, and a missed rep does not count'));
  });

  test('a converted figure is marked in the row, not silently rounded', () => {
    assert.match(page, /row\.converted/);
    assert.match(en, phrase('logged as {weight} {units}'));
  });

  test('the reader own row is findable without relying on colour', () => {
    assert.match(page, /thatsYou/);
    assert.match(styles, /\.board tr\.you td:first-child \{ box-shadow/);
  });

  test('the styles it uses exist', () => {
    for (const rule of ['.board {', '.badges {', '.badge {', '.table-scroll {']) {
      assert.ok(styles.includes(rule), `${rule} is missing from styles.css`);
    }
  });

  test('a wide board scrolls inside itself rather than pushing the page sideways', () => {
    assert.match(styles, /\.table-scroll \{ overflow-x: auto; \}/);
  });
});

describe('the rate limit bucket exists', () => {
  const app = readSource(new URL('../src/app.js', import.meta.url));

  test('EVERY BUCKET NAMED IN app.js IS ONE consume_rate_limit KNOWS', () => {
    // The function raises on an unknown bucket, the middleware catches it,
    // logs, and calls next() - so a typo or an invented name produces an
    // UNLIMITED endpoint that writes an error line on every request. This was
    // very nearly shipped as rateLimit('read').
    const known = new Set(['chat', 'chat_daily', 'write', 'export']);
    const used = [...app.matchAll(/rateLimit\('([a-z_]+)'\)/g)].map((m) => m[1]);
    assert.ok(used.length >= 6, 'the scan found suspiciously few rate-limited routes');
    for (const bucket of used) {
      assert.ok(known.has(bucket), `app.js uses rateLimit('${bucket}') and consume_rate_limit has no such bucket`);
    }
  });
});
