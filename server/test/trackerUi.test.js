import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw } from './helpers/source.js';

/**
 * THE SCREEN WHERE SOMEBODY PASTES A CREDENTIAL FOR ANOTHER SERVICE.
 *
 * ── WHAT MAKES THIS SCREEN DIFFERENT FROM EVERY OTHER SETTINGS CARD ────────
 *
 * The value in this field is not a preference. It is a bearer token for
 * somebody's paid account on a product we do not run, and it is most often
 * pasted on a phone, in a gym, with other people nearby. Everything below is
 * about that field and about the two states this card can be in.
 */

const panel = readSource(new URL('../../web/src/components/TrackerSettings.jsx', import.meta.url));
const panelRaw = readRaw(new URL('../../web/src/components/TrackerSettings.jsx', import.meta.url));
const account = readSource(new URL('../../web/src/pages/Account.jsx', import.meta.url));
const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
const styles = readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));

describe('the field is write-only, in every sense', () => {
  test('it is a password field, not a text field', () => {
    // A text field is readable over a shoulder and, worse, is offered to
    // autofill and to screenshots as ordinary content.
    const field = panel.slice(panel.indexOf('<input'), panel.indexOf('</label>'));
    assert.match(field, /type="password"/);
    assert.match(field, /autoComplete="off"/);
  });

  test('the value is cleared the instant it is accepted', () => {
    /*
     * It is in the database now. The longer it stays in a form field the more
     * chances it has to be autofilled into something else, screenshotted, or
     * left on a screen somebody walks away from.
     */
    const connect = panel.slice(panel.indexOf('async function connect'), panel.indexOf('async function disconnect'));
    assert.match(connect, /setKey\(''\)/);
    assert.ok(connect.indexOf("setKey('')") > connect.indexOf('await api.connectHevy'));
  });

  test('THERE IS NO REQUEST THAT COULD GET IT BACK', () => {
    /*
     * The design, not an omission. The API module has a POST that sends the
     * key and nothing that returns one, so there is no value for this screen
     * to render even by accident.
     */
    const block = api.slice(api.indexOf('getHevyConnection'), api.indexOf('// Data subject rights'));
    assert.match(block, /connectHevy/);
    assert.doesNotMatch(block, /getHevyKey|apiKey:|readKey/);
    assert.doesNotMatch(panel, /connection\.api_key|connection\?\.api_key/);
  });
});

describe('the two states this card can be in, and the third that is not a state', () => {
  test('a failed load renders nothing rather than the connect form', () => {
    /*
     * "Unreachable" is not "not connected". Showing the connect form to
     * somebody who IS connected invites a second paste - and connecting again
     * resets the cursor by design, because a new key can belong to a different
     * account. So a network failure would silently restart a backfill that was
     * halfway through.
     */
    assert.match(panel, /if \(!loaded\) return null;/);
    const load = panel.slice(panel.indexOf('useEffect'), panel.indexOf('async function connect'));
    assert.match(load, /catch\(\(\) => \{ if \(live\) setLoaded\(false\); \}\)/);
  });

  test('a stored failure is shown, not swallowed', () => {
    // A card that says "connected" above a sync that has failed every time for
    // a week is the version of this screen that wastes somebody's afternoon.
    assert.match(panel, /connection\.last_error/);
    assert.match(panel, /role="alert"/);
  });

  test('an unfinished import says so and says what to do', () => {
    assert.match(panel, /backfill_done/);
    assert.match(en, /stateImporting:/);
    assert.match(en, /press sync again/i);
  });

  test('only failures with a sentence are rendered as one', () => {
    /*
     * t() returns the KEY when it does not recognize one, so an unmapped code
     * would render `tracker.failure.storage_unavailable` at somebody in a gym.
     * The set is closed and everything else gets the generic sentence.
     */
    assert.match(panel, /const NAMED_FAILURES = new Set\(/);
    assert.match(panel, /NAMED_FAILURES\.has\(connection\.last_error\) \? connection\.last_error : 'unknown'/);
    for (const code of ['tracker_key_rejected', 'tracker_rate_limited', 'tracker_unavailable', 'unknown']) {
      assert.match(en, new RegExp(`${code}:`), `en has no sentence for ${code}`);
      assert.match(es, new RegExp(`${code}:`), `es has no sentence for ${code}`);
    }
  });
});

describe('what the card promises, in both languages', () => {
  test('it says we only read', () => {
    /*
     * Promised where the decision is made, not only in the privacy policy.
     * Somebody handing over a credential for another product is entitled to
     * know what we will do with it on the screen where they hand it over.
     */
    assert.match(en, /readOnly: 'We only read\./);
    assert.match(en, /Nothing is ever written back/);
    assert.match(es, /readOnly: 'Solo leemos\./);
    assert.match(es, /Nunca escribimos nada/);
  });

  test('it says disconnecting deletes the key', () => {
    assert.match(en, /Disconnecting deletes your key from our database/);
    assert.match(es, /Al desconectar borramos tu clave/);
  });

  test('it says the Pro requirement is theirs, not ours', () => {
    // Somebody who cannot generate a key will otherwise conclude our
    // integration is broken.
    assert.match(en, /That is their rule, not ours\./);
    assert.match(es, /Es su regla, no la nuestra\./);
  });
});

describe('it is actually on the page, and it fits a phone', () => {
  test('the account page renders it', () => {
    assert.match(account, /<TrackerSettings \/>/);
    assert.match(account, /import \{ TrackerSettings \}/);
  });

  test('the two buttons wrap rather than sit at opposite ends', () => {
    assert.match(panelRaw, /row-actions, not row/);
    assert.match(panel, /className="row-actions"/);
    assert.match(styles, /\.row-actions \{/);
  });
});
