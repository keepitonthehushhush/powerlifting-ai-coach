import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw, stripComments } from './helpers/source.js';

const page = readSource(new URL('../../web/src/pages/NotFound.jsx', import.meta.url));
const pageRaw = readRaw(new URL('../../web/src/pages/NotFound.jsx', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
const css = stripComments(readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8'));

/**
 * ── A URL THAT SILENTLY BECOMES A DIFFERENT URL IS A LIE ──────────────────
 *
 * The catch-all was `<Navigate to="/coach" replace />`, and /coach is behind
 * ProtectedRoute, so every unknown address bounced a signed-out visitor to
 * /login. Measured on the built app with the network cut off:
 *
 *   /this-page-does-not-exist  ->  /login
 *   /policies/pricing          ->  /login
 *   /program                   ->  /login     (real, protected)
 *
 * All three rendered byte-identical screens. "That page does not exist" and
 * "you need an account for that page" were the same screen, shown to the
 * person with the least context - somebody following a stale link.
 */
describe('an address that does not exist says so', () => {
  test('the catch-all renders a page instead of redirecting', () => {
    assert.match(
      app,
      /<Route path="\*" element=\{<NotFound \/>\} \/>/,
      'the catch-all no longer renders the NotFound page',
    );
    /*
     * Asserted in both directions. A redirect is the defect itself: it changes
     * the address before anybody can read what was wrong with it, and it is
     * the one-character change that would undo this whole page.
     */
    assert.doesNotMatch(
      app,
      /<Route path="\*" element=\{<Navigate/,
      'the catch-all redirects again, so an unknown URL is silently a different URL',
    );
  });

  test('THE HASH AND THE QUERY ARE NEVER READ, because they hold tokens', () => {
    /*
     * The assertion this file exists for.
     *
     * Supabase puts the recovery token in the URL FRAGMENT of a password-reset
     * link (`#access_token=...`). A malformed or expired one can land on the
     * catch-all, and a page echoing `location.href` would print a live
     * credential on screen - over a shoulder, into a screenshot, into a
     * support ticket. The query string is where `?checkout=` lives and where
     * any future token would.
     *
     * Read from the comment-stripped source, so the paragraph in the component
     * explaining this rule cannot satisfy the check that enforces it.
     */
    assert.match(page, /location\.pathname/, 'the page no longer reads the path it is supposed to name');
    for (const [field, why] of [
      ['hash', 'the URL fragment carries the Supabase recovery access token'],
      ['search', 'the query string is where tokens and checkout state live'],
    ]) {
      assert.doesNotMatch(
        page,
        new RegExp(`location\\.${field}`),
        `NotFound reads location.${field} - ${why}`,
      );
    }
    assert.doesNotMatch(page, /location\.href/, 'location.href contains both the query and the fragment');

    // And the reasoning is written down where the next person will change it.
    assert.match(pageRaw, /access_token/, 'the comment no longer says WHY the fragment is off limits');
  });

  test('the path is capped, so one long URL cannot wreck the card', () => {
    assert.match(page, /export const MAX_PATH = \d+;/, 'there is no cap on the path length');
    const cap = Number(page.match(/MAX_PATH = (\d+)/)[1]);
    assert.ok(cap >= 20 && cap <= 120, `MAX_PATH is ${cap}, which is not a plausible cap`);
    assert.match(page, /asked\.length > MAX_PATH/, 'MAX_PATH is declared and never compared against');
    assert.match(css, /\.not-found-path \{[^}]*overflow-wrap:\s*anywhere/s,
      'a path has no spaces to break at, so without overflow-wrap it pushes the card off a 320px screen');
  });

  test('there is a way out, and which way depends on whether you are signed in', () => {
    /*
     * Measured in the review harness at 390px:
     *   signed in   1 nav bar, actions: ["Back to Coach"]
     *   signed out  0 nav bars, actions: ["Go to the front page", "Sign in"]
     *
     * Zero nav bars signed out is correct, not a gap: a bar of destinations
     * that all bounce to a password field is the other half of the trapdoor.
     * InfoHeader already owns that rule, which is why this page reuses it
     * rather than building a third header.
     */
    assert.match(page, /<InfoHeader/, 'the page builds its own header instead of the one that knows this rule');
    assert.match(page, /session \?/, 'the page offers the same way out to everybody');
    assert.match(page, /to="\/coach"/, 'a signed-in reader is not offered the way back into the app');
    assert.match(page, /to="\/"/, 'a signed-out reader is not offered the front page');
    assert.match(page, /to="\/login"/, 'a signed-out reader is not offered sign-in');
  });

  test('it reuses the design system rather than inventing a fourth button', () => {
    // `.cta` is already the product's primary action: 44px tall, swept in
    // twenty palettes. Measured here at 241x50.
    assert.match(page, /className="cta"/, 'the primary action is no longer the product\'s own pill');
    assert.doesNotMatch(page, /className="primary-link"/, 'a one-page button style is back');
  });

  test('and it is translated, in plain language, with no status code in the title', () => {
    for (const [name, locale] of [['en', en], ['es', es]]) {
      assert.match(locale, /notFound: \{/, `${name} has no notFound namespace`);
      for (const key of ['title', 'detail', 'asked', 'toHome', 'toLogin', 'toCoach']) {
        assert.match(locale, new RegExp(`\\n\\s*${key}:\\s*'[^']+'`), `${name} is missing notFound.${key}`);
      }
    }
    /*
     * NN/g: an error message must be "written in plain language that is easy
     * to understand for non-technical users and that does not imply that the
     * mistake is the user's fault". "404" means nothing to somebody who
     * followed a link out of a message, and "you" in the headline blames them.
     */
    const title = en.match(/\n\s*title: '([^']+)'/g)
      .map((m) => m.match(/'([^']+)'/)[1])
      .find((v) => v.toLowerCase().includes('find that page'));
    assert.ok(title, 'the English notFound title has changed shape - check this assertion still reads it');
    assert.doesNotMatch(title, /404/, 'the headline shows a status code to somebody who followed a link');
    assert.doesNotMatch(title, /\byou\b/i, 'the headline puts the mistake on the reader');

    /*
     * Spanish here is Mexican Spanish, and the other 373 accented strings in
     * that file set the standard.
     *
     * Asserted PER KEY, and the first version of this was not. It read the
     * whole notFound block and required `página` to appear somewhere in it -
     * which `toHome` satisfies on its own, so stripping the accent off the
     * TITLE left the check green. That is the `[].every()` trap wearing a
     * different hat: a property asserted over a collection, satisfied by the
     * wrong member. Mutation testing is the only reason it is not still there.
     */
    const spanish = (key) => es.match(new RegExp(`notFound: \\{[\\s\\S]*?\\n\\s*${key}: '([^']+)'`))?.[1];
    for (const [key, accented] of [
      ['title', 'página'],
      ['detail', 'dirección'],
      ['toHome', 'página'],
      ['toLogin', 'sesión'],
    ]) {
      const value = spanish(key);
      assert.ok(value, `could not read the Spanish notFound.${key}`);
      assert.ok(
        value.includes(accented),
        `the Spanish notFound.${key} is missing the accent in "${accented}": ${value}`,
      );
    }
  });

  test('the screen is inside every sweep, not just this file', () => {
    const harness = readSource(new URL('../../web/harness/main.jsx', import.meta.url));
    const screens = readSource(new URL('../../scripts/check-screens.mjs', import.meta.url));
    const styles = readSource(new URL('../../scripts/check-computed-styles.mjs', import.meta.url));
    assert.match(harness, /notfound: NotFound/, 'the review harness cannot render the screen');
    assert.match(screens, /'notfound'/, 'the eighteen-screen sweep does not visit it');
    assert.match(styles, /'notfound'/, 'the style snapshot does not visit it');
    /*
     * The harness rewrites its own path so the screen has something real to
     * name. Reviewing it while it shows "/" would review everything about the
     * page except the one property it exists for.
     */
    assert.match(harness, /history\.replaceState\(null, '', `\/policies\/pricing/,
      'the harness no longer gives the screen a path to show, so it reviews it showing "/"');
  });
});
