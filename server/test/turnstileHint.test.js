import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readRaw, flatten } from './helpers/source.js';

const widget = readSource(new URL('../../web/src/components/Turnstile.jsx', import.meta.url));
const css = readRaw(new URL('../../web/src/styles.css', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

/*
 * Reported from a screenshot on 2026-09-10. The challenge had solved - green
 * check, the word "Success!" - and directly underneath it the page still said
 * "A quick check that you are not a bot. It usually resolves on its own."
 *
 * Reassurance about a wait, offered to somebody who has finished waiting,
 * directly above the button it gates. It makes a state that succeeded look
 * like one that is still going.
 */
describe('the hint retires when the wait is over', () => {
  test('the widget knows whether it has been solved', () => {
    assert.match(widget, /const \[solved, setSolved\] = useState\(false\)/);
    assert.match(widget, /setSolved\(Boolean\(token\)\)/);
  });

  test('a falsy token is not a solved challenge', () => {
    /*
     * `Boolean(token)` rather than `setSolved(true)` in the success callback.
     * The callback is named for the happy path; the hint should stay up for
     * anything that is not actually a token, rather than the widget going
     * quiet with nothing left to explain it.
     */
    assert.doesNotMatch(widget, /callback: \(token\) => \{\s*setSolved\(true\)/);
  });

  test('and it comes back when the token stops being good', () => {
    // expired and error both mean "you are waiting again".
    const expired = widget.slice(widget.indexOf("'expired-callback'"), widget.indexOf("'error-callback'"));
    assert.match(expired, /setSolved\(false\)/);
    const errored = widget.slice(widget.indexOf("'error-callback'"));
    assert.match(errored.slice(0, 200), /setSolved\(false\)/);
  });
});

describe('nothing moves under the reader', () => {
  test('the hint is hidden rather than removed', () => {
    /*
     * The submit button is directly below. Turnstile decides when it solves,
     * not the reader, so taking a line out from under a thumb at that moment
     * is how a tap lands on the wrong control.
     */
    assert.match(css, /\.turnstile-why\.is-done \{ visibility: hidden; \}/);
    assert.doesNotMatch(css, /\.turnstile-why\.is-done \{ display: none/);
    // And it is a class swap, not a conditional render.
    assert.match(widget, /solved \? 'muted small turnstile-why is-done' : 'muted small turnstile-why'/);
    assert.doesNotMatch(widget, /\{!solved && </, 'the hint is unmounted, so the button jumps');
  });

  test('visibility also takes it out of the accessibility tree', () => {
    // Both halves of what is wanted: nothing moves, and nothing reads out a
    // sentence about a wait that has ended. `opacity: 0` would do only one.
    const rule = css.slice(css.indexOf('.turnstile-why.is-done'));
    assert.doesNotMatch(rule.slice(0, 80), /opacity/);
  });
});

describe('the sentence itself is unchanged', () => {
  test('it still explains the wait to somebody who is having one', () => {
    // The fix is about WHEN it shows, not what it says. Rewriting the copy in
    // the same change would make it impossible to tell which one helped.
    assert.match(flatten(en), /A quick check that you are not a bot/);
    assert.match(widget, /t\('auth\.captcha\.why'\)/);
  });
});
