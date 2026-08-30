import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { CONTACT_EMAIL, CONTACT_LIVE, contactIsUsable } from '../../web/src/lib/contact.js';

const page = readFileSync(new URL('../../web/public/maintenance.html', import.meta.url), 'utf8');
const boundary = readSource(new URL('../../web/src/components/ErrorBoundary.jsx', import.meta.url));
const boundaryRaw = readRaw(new URL('../../web/src/components/ErrorBoundary.jsx', import.meta.url));
const main = readSource(new URL('../../web/src/main.jsx', import.meta.url));
const terms = readRaw(new URL('../../web/src/pages/Terms.jsx', import.meta.url));
const runbook = readRaw(new URL('../../docs/RUNBOOK.md', import.meta.url));
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

describe('THE MAINTENANCE PAGE DEPENDS ON NOTHING THAT COULD BE THE OUTAGE', () => {
  test('no external requests of any kind', () => {
    // It is read precisely when the bundle, the API or the database has
    // failed. A font, a script or a stylesheet from anywhere else is one more
    // thing that can be the reason somebody is looking at it.
    assert.doesNotMatch(page, /<script[^>]+src=/i, 'it loads an external script');
    assert.doesNotMatch(page, /<link[^>]+stylesheet/i, 'it loads an external stylesheet');
    assert.doesNotMatch(page, /<img|url\(http|@import|fonts\.googleapis/i);
  });

  test('the only network call is the health check, and it cannot throw', () => {
    const calls = [...page.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
    assert.equal(calls.length, 1, `expected one fetch, found ${calls.length}`);
    assert.match(calls[0], /\/api\/health/);
    // Without the catch, an outage that refuses connections leaves an
    // unhandled rejection and a status line stuck on "Checking…".
    assert.match(page, /\.catch\(function \(\) \{ return false; \}\)/);
  });

  test('the health check is not cached, or it would report a stale 200', () => {
    assert.match(page, /Date\.now\(\)/);
    assert.match(page, /cache: 'no-store'/);
  });

  test('IT DOES NOT NAVIGATE AWAY ON ITS OWN', () => {
    // Yanking somebody out of a game mid-attempt to prove the site is back is
    // worse than letting them press a button.
    const script = page.slice(page.indexOf('<script'));
    const assignments = [...script.matchAll(/location\.href\s*=/g)];
    assert.equal(assignments.length, 1, 'more than one navigation');
    assert.match(page, /retry\.addEventListener\('click'/);
    assert.doesNotMatch(script, /setTimeout\([^)]*location|location\.reload\(\)/);
  });

  test('it is excluded from search results', () => {
    assert.match(page, /<meta name="robots" content="noindex">/);
  });
});

describe('the mini-game', () => {
  test('works by keyboard and by touch, not by mouse alone', () => {
    assert.match(page, /addEventListener\('keydown'/);
    assert.match(page, /addEventListener\('pointerdown'/);
    assert.match(page, /tabindex="0"/);
    assert.match(page, /aria-label="Timing bar/);
  });

  test('space does not fire while somebody is typing or on a button', () => {
    // Otherwise space on "Try loading the app" both presses the button and
    // takes a lift attempt.
    assert.match(page, phrase("if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;"));
  });

  test('reduced motion slows it rather than removing it', () => {
    // The game IS motion, so removing it removes the feature. Slowing it down
    // keeps it playable for somebody who asked their system for less.
    assert.match(page, /prefers-reduced-motion: reduce/);
    assert.match(page, /slow \? 0\.22 : 0\.55/);
    assert.match(page, phrase('because your system asks for reduced motion'));
  });

  test('the animation touches no layout property', () => {
    // It runs every frame. A left/width change here is a reflow 60 times a
    // second on somebody's phone.
    const frame = page.slice(page.indexOf('function frame('), page.indexOf('function attempt('));
    assert.match(frame, /style\.transform/);
    assert.doesNotMatch(frame, /style\.(left|width|top|height|margin)/);
  });

  test('the result of every attempt is announced, not just drawn', () => {
    assert.match(page, /id="hint"[^>]*aria-live="polite"/);
    assert.match(page, /role="status"/);
  });

  test('it ends, and it can be restarted', () => {
    assert.match(page, /function finish\(/);
    assert.match(page, /again\.addEventListener\('click'/);
    assert.match(page, /misses = 3/);
  });

  test('nothing is stored anywhere', () => {
    // Said on the page, so it has to be true. A high score is not worth a
    // sentence about storage on a health-data domain.
    assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    assert.match(page, phrase('stores nothing'));
  });
});

describe('the error boundary', () => {
  test('IT IMPORTS NOTHING BUT REACT', () => {
    // Same rule as ConfigError.jsx. It renders exactly when something has
    // failed; importing the i18n provider or the API client risks failing for
    // the very reason it is being shown.
    const imports = [...boundary.matchAll(/^import .*$/gm)].map((m) => m[0]);
    assert.deepEqual(imports, ["import { Component } from 'react';"]);
  });

  test('it wraps App from OUTSIDE the provider tree', () => {
    // A boundary inside the providers cannot catch a provider that throws on
    // its first render, and the providers are where a bad token surfaces.
    assert.match(main, /<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/);
  });

  test('it offers a way out, and one of them is a full navigation', () => {
    // The router is part of what just failed, so a <Link> would be asking the
    // broken thing to rescue itself.
    assert.match(boundary, /window\.location\.reload\(\)/);
    assert.match(boundary, /href="\/maintenance\.html"/);
    assert.doesNotMatch(boundary, /<Link/);
  });

  test('it tells the person their data is fine, because that is their first fear', () => {
    assert.match(boundaryRaw, phrase('are in the database and are unaffected'));
  });

  test('the crash goes to the console and nowhere else', () => {
    // Sending a stack trace anywhere would have to answer what health data
    // might be in a component's props at the moment it threw.
    assert.match(boundary, /console\.error/);
    assert.doesNotMatch(boundary, /fetch\(|sentry|captureException/i);
  });
});

describe('the switch is documented where it will be needed', () => {
  test('vercel.json is still valid and still routes normally', () => {
    // An earlier version of this change put JSON comments in the rewrites
    // array. JSON has no comments; it would have failed schema validation and
    // taken the deploy with it.
    assert.ok(Array.isArray(vercel.rewrites));
    for (const rule of vercel.rewrites) {
      assert.equal(typeof rule, 'object', 'a rewrite entry is not an object');
    }
    assert.equal(vercel.rewrites.at(-1).destination, '/index.html');
  });

  test('the runbook carries the rewrite, and says order matters', () => {
    assert.match(runbook, /maintenance\.html/);
    assert.match(runbook, phrase('the first matching rewrite wins', 'i'));
    // The health check has to keep working during maintenance, or the page
    // cannot tell anybody when it is over.
    assert.match(runbook, phrase('deliberately still live'));
    assert.match(runbook, phrase('to notice when the site is back'));
  });
});

describe('the contact address is one address', () => {
  test('the page and the module agree', () => {
    assert.ok(page.includes(CONTACT_EMAIL), 'the maintenance page names a different address');
    const ready = /var CONTACT_READY = (true|false);/.exec(page);
    assert.ok(ready, 'CONTACT_READY is missing from the maintenance page');
    assert.equal(
      ready[1] === 'true',
      CONTACT_LIVE,
      'CONTACT_READY on the maintenance page disagrees with CONTACT_LIVE in contact.js'
    );
  });

  test('NOTHING PRINTS THE ADDRESS AS LIVE WHILE IT IS NOT', () => {
    // A legal document naming an address that bounces is worse than one
    // naming none: the Terms commit to acting on a report, and a route that
    // does not work makes that commitment decorative.
    if (!contactIsUsable()) {
      assert.match(terms, phrase('A monitored address for this is being set up'));
      assert.match(page, phrase('An address for this is being set up'));
    }
  });

  test('the Terms ask for the address only through the helper', () => {
    // So flipping one flag flips every document at once.
    assert.match(terms, /contactIsUsable\(\)/);
    assert.match(terms, /CONTACT_EMAIL/);
  });

  test('the flag records an arrival, not an intention', () => {
    const source = readRaw(new URL('../../web/src/lib/contact.js', import.meta.url));
    assert.match(source, phrase('after an actual email lands in an actual inbox'));
    assert.match(source, phrase('records a fact rather than an intention'));
  });
});

test('the contact-route check can say "I could not look"', async (t) => {
  /**
   * ── THE FALSE ALARM THIS PREVENTS ─────────────────────────────────────
   *
   * check-contact-route.mjs treated every DNS error as proof the address was
   * dead. Run on 2026-08-30 from a sandbox with no DNS egress it printed
   * "FAIL - no usable MX record for coachdiaz.app" and recommended setting
   * CONTACT_LIVE to false - for a domain whose MX records were live and
   * correct, verified from another machine seconds later.
   *
   * Acting on it would have REMOVED a working contact route from the Terms,
   * which is the exact harm the check exists to prevent. And the Terms commit
   * to deleting a minor's account when a parent writes to that address, so the
   * route is not decoration.
   *
   * ENOTFOUND and ENODATA are answers from a resolver that looked. Everything
   * else means the question was never asked.
   */
  const script = readRaw(new URL('../../scripts/check-contact-route.mjs', import.meta.url));

  await t.test('only a real resolver answer counts as a failure', () => {
    assert.match(script, /const ANSWERED = new Set\(\['ENOTFOUND', 'ENODATA'\]\)/);
    assert.match(script, /ANSWERED\.has\(error\.code\)/);
  });

  await t.test('anything else is UNKNOWN, and says the check did not run', () => {
    assert.match(script, /UNKNOWN - could not reach a DNS resolver/);
    assert.match(script, phrase('THE CHECK DID NOT RUN'));
    assert.match(script, phrase('is not a reason to change CONTACT_LIVE'));
  });

  await t.test('and it exits with a code CI can tell apart', () => {
    // Exit 1 means broken. Exit 3 means unlooked. Collapsing them makes the
    // check either decorative or a source of false outages.
    assert.match(script, /if \(unknown\) process\.exit\(3\)/);
  });

  await t.test('an empty MX list is still a real failure', () => {
    // A domain that resolves and advertises nowhere to deliver IS broken, and
    // must not be swept into "could not look" by the new branch.
    assert.match(script, /empty\.code = 'ENODATA'/);
  });
});
