import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, readRaw } from './helpers/source.js';
import { STEP_IDS } from '../src/lib/onboarding.js';

/**
 * The wiring around server/src/lib/onboarding.js.
 *
 * The derivation itself is tested in onboarding.test.js, through the function,
 * where it belongs. What is left here is everything that is NOT observable
 * through a pure function: which columns the route reads, when it pays for the
 * two existence checks, that the stamp is write-once, that the panel is not a
 * modal, and that it reaches an athlete whose conversation is not empty - the
 * one this feature most needs to reach.
 */
const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));
const page = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const panel = readSource(new URL('../../web/src/components/FirstWeek.jsx', import.meta.url));
const styles = readRaw(new URL('../../web/src/styles.css', import.meta.url));
const migration = readFileSync(
  new URL(
    '../../supabase/migrations/0072_the_panel_that_stops_when_the_first_week_is_done.sql',
    import.meta.url,
  ),
  'utf8',
);

/**
 * The conversation handler, bounded at BOTH ends.
 *
 * chat.js is 1400 lines and holds a POST handler that also calls res.json and
 * also touches user_profile. A region with only an opening boundary is not a
 * region, and this file has shipped that mistake before.
 */
function conversationHandler() {
  const from = chatRoute.indexOf("chatRouter.get('/conversation'");
  const to = chatRoute.indexOf("chatRouter.post('/onboarding/hide'", from);
  assert.notEqual(from, -1, 'the conversation route is gone - this check did not run');
  assert.notEqual(to, -1, 'the end marker moved - this check did not run');
  return chatRoute.slice(from, to);
}

describe('what the route pays for, and when it stops', () => {
  test('the two existence checks are guarded by the stored end state', () => {
    /*
     * This is the entire justification for migration 0072 adding a column to
     * a feature that otherwise stores nothing. Ungated, every athlete pays
     * two queries on every load of the coach page for the life of the
     * account.
     */
    const handler = conversationHandler();
    const guard = handler.indexOf("profile.onboarding_hidden_at == null");
    const programs = handler.indexOf("from('workout_programs')");
    const sessions = handler.indexOf("from('workout_sessions')");
    assert.ok(guard > 0, 'the panel is computed without checking whether it was hidden');
    assert.ok(programs > guard, 'the program check runs outside the guard');
    assert.ok(sessions > guard, 'the session check runs outside the guard');
  });

  test('they transfer no rows', () => {
    // Existence is all that is wanted, and a program row carries a whole week
    // of training.
    const handler = conversationHandler();
    assert.equal(
      (handler.match(/\{ count: 'exact', head: true \}/g) ?? []).length,
      2,
      'an existence check is fetching rows',
    );
  });

  test('finishing the fourth step stamps the column, write-once', () => {
    const handler = conversationHandler();
    const stamp = handler.indexOf('onboarding_hidden_at: new Date()');
    assert.ok(stamp > 0, 'the panel never stops costing anything');
    // In the DATABASE, not in a branch: two tabs opening together both read
    // null here and only one of them can win at `.is(..., null)`.
    assert.match(handler.slice(stamp, stamp + 300), /\.is\('onboarding_hidden_at', null\)/);
  });

  test('and that stamp never costs somebody the page they asked for', () => {
    const handler = conversationHandler();
    const at = handler.indexOf('onboarding_hidden_at: new Date()');
    const around = handler.slice(Math.max(0, at - 500), at + 500);
    assert.match(around, /try \{/, 'the stamp is not guarded');
    assert.match(around, /\} catch \{/, 'a failed telemetry write would break the conversation load');
  });
});

describe('the panel never claims something it did not read', () => {
  test('a failed existence check renders no panel, rather than an empty one', () => {
    /*
     * NOT "assume zero". Zero would put "you have no program yet" in front of
     * somebody who has one, and a checklist that makes a false claim about
     * the athlete's own account is the single thing lib/onboarding.js exists
     * to prevent. Same reasoning as firstWeekComplete([]) refusing to call an
     * empty list finished.
     */
    const handler = conversationHandler();
    assert.match(
      handler,
      /if \(!programs\.error && !sessions\.error\) \{/,
      'a failed existence check is being read as a fact about the account',
    );
  });

  test('the response OMITS the panel rather than sending null', () => {
    // A field that is sometimes null is a field somebody eventually renders.
    /*
     * Anchored on CODE, not on the comment heading above it. `chatRoute` is
     * read with readSource, which strips comments - a marker that only exists
     * in a comment is an anchor this file cannot see, and the failure it
     * produces reads as "the wrong block was sliced" rather than as "your
     * anchor is invisible". Cost one debugging round here; it is the trap
     * helpers/source.js is written to warn about.
     */
    const from = chatRoute.indexOf('res.json({', chatRoute.indexOf('const starters = empty ?'));
    const to = chatRoute.indexOf('});', from);
    assert.notEqual(from, -1, 'the conversation response is gone - this check did not run');
    const body = chatRoute.slice(from, to);
    assert.match(body, /starters/, 'the wrong block was sliced - this check did not run');
    assert.match(body, /\.\.\.\(onboarding \? \{ onboarding \} : \{\}\)/);
    assert.ok(!/onboarding: null/.test(body), 'the response sends a null panel');
  });

  test('nothing off the profile travels with it', () => {
    const handler = conversationHandler();
    const at = handler.indexOf('onboarding = { steps }');
    assert.ok(at > 0, 'the panel payload has changed - this check did not run');
    const payload = handler.slice(at, at + 200);
    for (const column of ['health_restrictions', 'cleared_to_train', 'intake_completed_at']) {
      assert.ok(!payload.includes(column), `the panel payload carries ${column}`);
    }
  });
});

describe('hiding it', () => {
  test('is a route, so the server stops paying for the checks too', () => {
    assert.match(chatRoute, /chatRouter\.post\('\/onboarding\/hide'/);
  });

  test('is idempotent and is not an error the second time', () => {
    const from = chatRoute.indexOf("chatRouter.post('/onboarding/hide'");
    const to = chatRoute.indexOf('});', chatRoute.indexOf('res.status(204)', from));
    assert.notEqual(from, -1, 'the hide route is gone - this check did not run');
    const handler = chatRoute.slice(from, to);
    assert.match(handler, /\.is\('onboarding_hidden_at', null\)/, 'the write is not idempotent');
    assert.match(handler, /res\.status\(204\)/, 'pressing Hide twice reads as an error');
  });

  test('goes through the caller own client - ADR-12 stays at one service-role client', () => {
    const from = chatRoute.indexOf("chatRouter.post('/onboarding/hide'");
    const handler = chatRoute.slice(from, from + 900);
    assert.match(handler, /req\.supabase/, 'the hide route does not use the caller own client');
    assert.ok(!/serviceRole|service_role/.test(handler), 'the hide route reaches for a privileged client');
  });
});

describe('it is a panel, not a modal', () => {
  test('nothing about it is positioned over the page', () => {
    /*
     * The measured reason this is a panel at all: guidance embedded in the
     * page is acted on roughly 1.5x as often as the same guidance in a modal,
     * and a modal here would stand between a new athlete and the composer
     * they need to type into. This is where "embedded" stops being an
     * intention.
     */
    const from = styles.indexOf('.first-week {');
    const to = styles.indexOf('\n.composer', from);
    assert.notEqual(from, -1, 'the panel styles are gone - this check did not run');
    assert.notEqual(to, -1, 'the end marker moved - this check did not run');
    const block = styles.slice(from, to);
    assert.match(block, /max-width/, 'the wrong block was sliced - this check did not run');
    for (const forbidden of ['position: fixed', 'position: absolute', 'z-index']) {
      assert.ok(!block.includes(forbidden), `the panel uses ${forbidden} - that is a modal`);
    }
  });

  test('there is nothing to click through and nothing to skip', () => {
    // Roughly 70% of people skip linear tours, and a seven-step one completes
    // around 16%. The whole list is on screen at once, always.
    assert.ok(!/currentStep|nextStep|step \+ 1|setStep/.test(panel), 'the panel has become a tour');
  });
});

describe('where it renders', () => {
  test('it is NOT inside the empty-conversation branch', () => {
    /*
     * The athlete this most needs to reach is the one who has been talking to
     * the coach for ten messages and still has no program on the Program tab.
     * That athlete's conversation is not empty, and a panel nested inside the
     * empty branch would never be shown to them.
     */
    const render = page.indexOf('<FirstWeek');
    const emptyBranch = page.indexOf('messages.length === 0 && (');
    assert.ok(render > 0, 'the panel is not rendered');
    assert.ok(emptyBranch > 0, 'the empty-conversation branch moved - this check did not run');
    assert.ok(render < emptyBranch, 'the panel only renders for an empty conversation');
  });

  test('and not while the conversation is still loading', () => {
    // A checklist that says "you have no program" before the page knows
    // anything is the false claim again, in the one second nobody screenshots.
    assert.match(page, /\{!loading && onboarding && <FirstWeek/);
  });

  test('pressing Hide takes it off the screen without waiting for the server', () => {
    const at = page.indexOf('function hideFirstWeek()');
    assert.ok(at > 0, 'the hide handler is gone - this check did not run');
    const handler = page.slice(at, page.indexOf('\n  }', at));
    const clears = handler.indexOf('setOnboarding(null)');
    const calls = handler.indexOf('api.hideOnboarding()');
    assert.ok(clears > 0 && calls > clears, 'the panel waits on the network before it will go away');
    assert.match(handler, /\.catch\(\(\) => \{\}\)/, 'a failed hide would raise an error about a checklist');
  });
});

describe('the destination map is a closed set', () => {
  test('every destination belongs to a step the server can emit', () => {
    // The other direction is deliberately NOT asserted: firstMessage has no
    // destination, because the thing that completes it is the composer six
    // inches below and a link to it would be noise.
    const from = panel.indexOf('const DESTINATIONS = {');
    const to = panel.indexOf('};', from);
    assert.notEqual(from, -1, 'the destination map is gone - this check did not run');
    const ids = [...panel.slice(from, to).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    assert.ok(ids.length >= 4, `only found ${ids.length} destinations - this check did not run`);
    for (const id of ids) {
      assert.ok(STEP_IDS.includes(id), `DESTINATIONS has '${id}', which onboarding.js never emits`);
    }
  });
});

describe('the column is declared', () => {
  test('the migration adds it and says what it is for', () => {
    assert.match(migration, /add column if not exists onboarding_hidden_at timestamptz/);
    assert.match(migration, /comment on column public\.user_profile\.onboarding_hidden_at is/);
  });

  test('and it is declared as something the model never sees', () => {
    // Every column on user_profile is either mapped to a disclosure or listed
    // as not sent, with a reason. A new column is not finished until it is in
    // one of those two lists - policyDisclosure.test.js is what enforces it,
    // and this is the reminder of where to look when it fails.
    const disclosure = readRaw(new URL('./policyDisclosure.test.js', import.meta.url));
    assert.match(disclosure, /onboarding_hidden_at: 'bookkeeping'/);
  });
});
