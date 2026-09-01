import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseRoute } from '../src/lib/errorRecord.js';
import {
  CLIENT_ERROR_CODES,
  TOP_FRAME_PATTERN,
  buildReport,
  describeError,
  frameCountOf,
  safeRoute,
  shouldReport,
  MAX_REPORTS_PER_SESSION,
} from '../../web/src/lib/crashReport.js';

/**
 * What a browser is allowed to say about its own failures.
 *
 * The property under test is not "does it report". It is "can it leak". The
 * app holds health_restrictions, the README promises that field is never
 * forwarded to observability, and a crash reporter is the most natural place
 * in any codebase for that promise to quietly stop being true - because the
 * useful thing to send and the dangerous thing to send are the same object.
 */

describe('a report carries a coordinate, never a description', () => {
  /*
   * The scenario that has to be impossible. An athlete's restriction reaches a
   * thrown message the ordinary way - some validation interpolates the value
   * it rejected - and then that error is what crashes the render.
   */
  const RESTRICTION = 'left shoulder impingement, no overhead pressing';

  const thrownWithHealthData = () => {
    const error = new TypeError(`Cannot format restriction "${RESTRICTION}"`);
    error.stack = [
      `TypeError: Cannot format restriction "${RESTRICTION}"`,
      '    at formatRestriction (https://coachdiaz.app/assets/index-a1b2c3.js:14:2201)',
      '    at renderProfile (https://coachdiaz.app/assets/index-a1b2c3.js:19:884)',
    ].join('\n');
    return error;
  };

  test('the restriction does not survive into the report, in any field', () => {
    const report = buildReport({
      code: 'client_render_crash',
      route: '/coach',
      thrown: thrownWithHealthData(),
      build: 'dpl_abc123',
    });

    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /impingement/i, 'the restriction reached the report');
    assert.doesNotMatch(serialized, /shoulder/i);
    assert.doesNotMatch(serialized, /overhead/i);
    // And nothing message-shaped got through under another name.
    assert.doesNotMatch(serialized, /Cannot format/i);
  });

  test('what it does carry is enough to find the line', () => {
    const report = buildReport({
      code: 'client_render_crash',
      route: '/coach',
      thrown: thrownWithHealthData(),
      build: 'dpl_abc123',
    });
    assert.deepEqual(report, {
      code: 'client_render_crash',
      route: '/coach',
      detail: {
        errorName: 'TypeError',
        topFrame: 'index-a1b2c3.js:14:2201',
        frames: 2,
        build: 'dpl_abc123',
      },
    });
  });

  test('the report has exactly four detail keys and no fifth ever appears', () => {
    const report = buildReport({
      code: 'client_unhandled_error',
      route: '/account',
      thrown: thrownWithHealthData(),
      build: 'dpl_abc123',
    });
    assert.deepEqual(Object.keys(report.detail).sort(), [
      'build', 'errorName', 'frames', 'topFrame',
    ]);
  });

  test('an unrecognized error name becomes Other rather than passing through', () => {
    // A name is usually a constructor. Nothing stops code from building one
    // out of a value, so the whitelist decides rather than the thrower.
    const error = new Error('nope');
    error.name = RESTRICTION;
    assert.equal(describeError(error).errorName, 'Other');
  });

  test('a thrown string does not throw, and reports honestly', () => {
    assert.deepEqual(describeError('just a string', { build: 'x' }), {
      errorName: 'Other',
      topFrame: null,
      frames: 0,
      build: 'x',
    });
  });
});

describe('the stack coordinate', () => {
  const chrome = '    at render (https://coachdiaz.app/assets/index-a1b2c3.js:14:2201)';
  const safari = 'render@https://coachdiaz.app/assets/index-a1b2c3.js:14:2201';
  const firefox = 'render@https://coachdiaz.app/assets/index-a1b2c3.js:14:2201';

  for (const [browser, stack] of Object.entries({ chrome, safari, firefox })) {
    test(`is extracted from a ${browser} stack`, () => {
      assert.equal(describeError({ name: 'Error', stack }).topFrame, 'index-a1b2c3.js:14:2201');
    });
  }

  test('the scheme is never mistaken for a coordinate', () => {
    // 'https:' is followed by slashes, not digits. Stated as a test because
    // it is the one way this regex could plausibly be wrong.
    const frame = describeError({ name: 'Error', stack: chrome }).topFrame;
    assert.doesNotMatch(frame, /^https/);
  });

  test('no stack means no coordinate, not a fabricated one', () => {
    // Safari omits a stack for some internal errors. A guess would be worse.
    assert.equal(describeError({ name: 'Error' }).topFrame, null);
    assert.equal(frameCountOf(undefined), 0);
  });

  test('whatever comes out matches the pattern the database enforces', () => {
    for (const stack of [chrome, safari, `at x (${'a'.repeat(200)}.js:9:9)`]) {
      const frame = describeError({ name: 'Error', stack }).topFrame;
      if (frame !== null) assert.match(frame, TOP_FRAME_PATTERN);
    }
  });
});

describe('the route', () => {
  test('static routes pass through', () => {
    for (const path of ['/coach', '/account', '/program', '/']) {
      assert.equal(safeRoute(path), path);
    }
  });

  test('an id in the path is replaced, not shipped', () => {
    // The first version of safeRoute only pattern-checked, and a UUID passes
    // that check: it is letters, digits and hyphens. This test is why the
    // function normalizes the path instead of only checking it.
    assert.equal(safeRoute('/program/6f2a9c11-4d3e-4a10-9b7e-2c1d8e5f0a33'), '/program/_id');
    assert.equal(safeRoute('/sessions/1842'), '/sessions/_id');
  });

  test('a query string is dropped, because it can carry anything at all', () => {
    assert.equal(safeRoute('/coach?q=my+shoulder+hurts'), '/coach');
  });

  test('nonsense becomes /unknown, never undefined', () => {
    for (const bad of [undefined, null, 42, {}, 'coach']) {
      assert.equal(safeRoute(bad), '/unknown');
    }
  });

  test('it gives the same answer the server would', () => {
    /*
     * The rule exists twice - once in the browser, once in errorRecord.js -
     * because server code cannot be imported into the bundle. Two copies of
     * one fact is this project's most reliable source of defects, so the
     * copies are asserted equal rather than trusted.
     */
    const paths = [
      '/coach', '/account', '/', '/program/6f2a9c11-4d3e-4a10-9b7e-2c1d8e5f0a33',
      '/sessions/1842', '/coach?q=hurts', '/api/conversations/8f3c1d2e-aaaa-bbbb-cccc-ddddeeeeffff/messages',
      'coach', '', '/a'.repeat(60),
    ];
    for (const path of paths) {
      assert.equal(safeRoute(path), normaliseRoute(path), `disagreement on ${path}`);
    }
  });
});

describe('a crash loop does not become a flood', () => {
  test('the same failure on the same screen is sent once', () => {
    const first = shouldReport({ sent: [] }, { code: 'client_render_crash', route: '/coach' });
    assert.equal(first.send, true);
    const second = shouldReport(first.state, { code: 'client_render_crash', route: '/coach' });
    assert.equal(second.send, false);
    assert.equal(second.reason, 'duplicate');
  });

  test('the same failure on a different screen is a different finding', () => {
    const first = shouldReport({ sent: [] }, { code: 'client_render_crash', route: '/coach' });
    const other = shouldReport(first.state, { code: 'client_render_crash', route: '/account' });
    assert.equal(other.send, true, 'collapsing these is how a second bug hides behind the first');
  });

  test('a page view stops after the cap', () => {
    let state = { sent: [] };
    let sent = 0;
    for (let i = 0; i < MAX_REPORTS_PER_SESSION + 4; i += 1) {
      const decision = shouldReport(state, { code: 'client_render_crash', route: `/r${i}` });
      state = decision.state;
      if (decision.send) sent += 1;
    }
    assert.equal(sent, MAX_REPORTS_PER_SESSION);
  });

  test('a code outside the vocabulary is never sent', () => {
    const decision = shouldReport({ sent: [] }, { code: 'coach_refused', route: '/coach' });
    assert.equal(decision.send, false);
    assert.equal(decision.reason, 'unknownCode');
  });
});

describe('the browser and the database agree', () => {
  /*
   * Derived from the migration, not from a list typed here. Adding a fifth
   * detail key to describeError without widening the CHECK constraint would
   * produce a reporter that silently fails to record anything - the row would
   * be refused by the database and the warning logged where nobody looks.
   * That is this project's recurring defect shape, so it gets a test.
   */
  const migration = readFileSync(
    new URL('../../supabase/migrations/0048_a_crash_that_can_report_itself.sql', import.meta.url),
    'utf8'
  );

  test('every detail key the browser can produce is permitted by the CHECK constraint', () => {
    const whitelist = migration
      .slice(migration.indexOf('error_events_detail_check'))
      .match(/'([a-zA-Z]+)'/g)
      .map((quoted) => quoted.slice(1, -1));

    const produced = Object.keys(describeError(new Error('x')));
    const missing = produced.filter((key) => !whitelist.includes(key));
    assert.deepEqual(missing, [], 'the database would refuse these rows');
  });

  test('every code in the vocabulary is one the RPC will accept', () => {
    // 0049 refuses anything not prefixed client_. A code added to the
    // vocabulary without that prefix would be rejected at write time.
    for (const code of CLIENT_ERROR_CODES) {
      assert.match(code, /^client_/, `${code} would be refused by record_client_error_event`);
    }
  });

  test('every code also satisfies the column pattern', () => {
    for (const code of CLIENT_ERROR_CODES) {
      assert.match(code, /^[a-z][a-z_]{2,39}$/);
    }
  });
});
