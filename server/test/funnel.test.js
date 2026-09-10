import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource, flatten } from './helpers/source.js';

const profileRoute = readSource(new URL('../src/routes/profile.js', import.meta.url));
const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));
const script = readFileSync(new URL('../../scripts/funnel.mjs', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../supabase/migrations/0064_where_they_stop_between_the_form_and_the_first_message.sql', import.meta.url),
  'utf8'
).replace(/--.*$/gm, '');

/**
 * Where people stop between finishing the form and saying anything.
 *
 * ── THE MEASUREMENT THIS EXISTS FOR ───────────────────────────────────────
 *
 * Four of six real signups completed the intake form and sent zero messages,
 * and every one left the same day. "Never reached the coach page" is a bug and
 * "reached it and did not type" is a design problem. Nothing in the database
 * told them apart.
 */
describe('the two timestamps that split the drop-off', () => {
  test('reaching the coach is recorded, once, in the conversation route', () => {
    const handler = chatRoute.slice(chatRoute.indexOf("chatRouter.get('/conversation'"));
    const stamp = handler.indexOf('coach_first_opened_at');
    assert.ok(stamp > 0, 'the coach page arrival is not recorded where it happens');
    // Write-once in the DATABASE, not in a branch: two tabs opening together
    // both read null, and only one of them can win at `.is(..., null)`.
    assert.match(handler.slice(stamp, stamp + 400), /\.is\('coach_first_opened_at', null\)/);
  });

  test('it is recorded only when the read actually succeeded', () => {
    // "The page answered" is the thing being measured, and a failed read is
    // not that. The throw has to come first.
    const handler = chatRoute.slice(chatRoute.indexOf("chatRouter.get('/conversation'"));
    const thrown = handler.indexOf("codedError('storage_unavailable'");
    const stamp = handler.indexOf('coach_first_opened_at');
    assert.ok(thrown > 0 && thrown < stamp, 'a failed conversation load would be counted as an arrival');
  });

  test('a telemetry write never costs somebody the page they asked for', () => {
    for (const [name, source, marker] of [
      ['chat', chatRoute, 'coach_first_opened_at'],
      ['profile', profileRoute, 'intake_completed_at: new Date()'],
    ]) {
      const at = source.indexOf(marker);
      const around = source.slice(Math.max(0, at - 700), at + 700);
      assert.match(around, /try \{/, `${name}: the stamp is not guarded`);
      assert.match(around, /\} catch \{/, `${name}: a failed stamp would surface as an error`);
      // Awaited, not fired and forgotten: a serverless function is frozen the
      // moment it responds and a detached write dies mid-socket.
      assert.match(around, /await req\.supabase/, `${name}: the stamp is not awaited`);
    }
  });
});

describe('intake_completed_at means what it is called', () => {
  test('it is no longer written on every save', () => {
    /*
     * It was in the upsert patch, so a column named "completed" held the last
     * time somebody EDITED their intake. The developer's own row said
     * 2026-09-01 for an intake finished on 2026-08-25 - and a funnel built on
     * it would have reported people completing intake weeks late with nothing
     * looking wrong.
     */
    assert.doesNotMatch(
      profileRoute,
      /const patch = \{ \.\.\.parsed\.data, intake_completed_at/,
      'the timestamp is back in the patch and is a last-edit time again'
    );
    assert.match(flatten(profileRoute), /const patch = \{ \.\.\.parsed\.data \}/);
  });

  test('and is stamped write-once instead', () => {
    const at = profileRoute.indexOf('intake_completed_at: new Date()');
    assert.ok(at > 0, 'nothing records when the intake was finished');
    assert.match(profileRoute.slice(at, at + 300), /\.is\('intake_completed_at', null\)/);
  });

  test('the migration says the early rows are a different measurement', () => {
    // Somebody will one day plot this column and deserves to know its first
    // points mean something else. Deleting the history quietly would be worse.
    const comment = readFileSync(
      new URL('../../supabase/migrations/0064_where_they_stop_between_the_form_and_the_first_message.sql', import.meta.url),
      'utf8'
    );
    assert.match(comment, /BEFORE 0064 the route stamped it on every profile save/);
  });
});

describe('the column carries no personal data', () => {
  test('it is classified as not sent to the model', () => {
    // policyDisclosure.test.js requires every profile column to be entered
    // either as sent-and-disclosed or explicitly-not-sent. This is the entry.
    const disclosure = readSource(new URL('./policyDisclosure.test.js', import.meta.url));
    assert.match(disclosure, /coach_first_opened_at: 'bookkeeping'/);
  });

  test('and the migration says what it is not', () => {
    assert.match(migration, /add column if not exists coach_first_opened_at timestamptz/);
    const comment = readFileSync(
      new URL('../../supabase/migrations/0064_where_they_stop_between_the_form_and_the_first_message.sql', import.meta.url),
      'utf8'
    );
    assert.match(comment, /Not health data and never sent to the model/);
  });
});

describe('the report', () => {
  test('it prints where people stopped and nothing about who they are', () => {
    // A funnel tool that quietly becomes a way to read the users is a tool
    // that gets used for something else eventually.
    assert.doesNotMatch(script, /\bemail\b/i, 'the report reaches for addresses');
    assert.doesNotMatch(script, /health_restrictions|goal|display_name|bodyweight/, 'it selects personal fields');
    assert.match(script, /const short = \(id\) => String\(id\)\.slice\(0, 8\)/, 'it prints whole account ids');
  });

  test('only messages the PERSON sent count as sending a message', () => {
    // A conversation row exists the moment the coach greets somebody. Counting
    // rows rather than user turns would report the drop-off as solved.
    assert.match(script, /messages\.filter\(\(m\) => m\?\.role === 'user'\)/);
  });

  test('the steps fall monotonically, so a drop is a real drop', () => {
    /*
     * The first version counted each step with its own filter, and the first
     * real run printed the funnel going UP - "reached the coach 0" above
     * "sent a message 3". Three people were plainly talking to a page the
     * report said they had never reached, because their arrival predates the
     * column. An independent filter cannot know that a later step proves an
     * earlier one, so the summary counts from the furthest step instead.
     */
    assert.match(flatten(script), /const furthestStep = \(p\) =>/);
    assert.match(flatten(script), /profiles\.filter\(\(p\) => furthestStep\(p\) >= index\)/);
  });

  test('a sent message counts as proof of arrival', () => {
    // Otherwise the "never reached the coach page - that is a bug" list names
    // people who are visibly using the product.
    const list = script.slice(script.indexOf('const finishedButNeverArrived'));
    assert.match(list.slice(0, 400), /!sent\.has\(p\.user_id\)/);
  });

  test('it names the two groups that need opposite fixes', () => {
    assert.match(script, /finishedButNeverArrived/);
    assert.match(script, /arrivedButNeverTyped/);
    assert.match(flatten(script), /That is a bug/);
    assert.match(flatten(script), /That is a design problem, not a bug/);
  });

  test('it admits what it cannot see about older accounts', () => {
    /*
     * This used to assert a FOOTNOTE - "accounts that signed up before
     * migration 0064 have no coach_first_opened_at whatever they did" -
     * printed underneath a list that had already called those same accounts a
     * bug. The footnote was the thing that made the false claim survivable:
     * the report asserted and retracted in the same breath, and the assertion
     * was the part in bold.
     *
     * Admitting it properly means not making the claim. The unmeasurable
     * accounts get their own heading, and it says in as many words that it is
     * not a bug report.
     */
    assert.match(flatten(script), /CANNOT BE CLASSIFIED/);
    assert.match(flatten(script), /This is not a bug report and must not be read/);
    assert.doesNotMatch(
      flatten(script),
      /they land in the first list by default/,
      'the retraction footnote is back, which means the false claim is back above it'
    );
  });
});

describe('the instrument says when it was not switched on', () => {
  test('"did not reach" and "cannot say" are different answers', () => {
    /*
     * ── THIS SCRIPT REPORTED A BUG IT COULD NOT SEE ─────────────────────
     *
     * It computed one list and printed it twice: as "N finished the intake and
     * NEVER REACHED the coach page. That is a bug - routing, loading, or an
     * error nobody saw", naming two accounts to investigate, and then again
     * underneath as "these accounts cannot have a stamp, so the split means
     * nothing for them". The two filters were character-for-character
     * identical.
     *
     * A false RED is worse than a false green. It sends somebody hunting a
     * routing bug for which the evidence cannot exist, while the one real
     * signal in the data - a failed /api/consent read on 2026-09-02 by an
     * athlete who never returned - sits unread underneath a louder claim that
     * was never established.
     */
    assert.match(script, /COACH_STAMP_RECORDING_SINCE/);
    assert.match(script, /CANNOT BE CLASSIFIED/);
    assert.match(script, /const measurable = \(p\) =>/);
    // The bug list must be narrowed by measurability; the unmeasurable list by
    // its negation. Identical predicates are what produced the false report.
    assert.match(script, /finishedButNeverArrived = profiles\.filter\(\s*\(p\) => p\.intake_completed_at && !reachedCoach\(p\) && measurable\(p\)/);
    assert.match(script, /cannotSay = profiles\.filter\(\s*\(p\) => p\.intake_completed_at && !reachedCoach\(p\) && !measurable\(p\)/);
  });

  test('the cutoff is the moment the column started recording, not a guess', () => {
    // Migration 0064, applied to production at 2026-09-08T21:54:17Z - read out
    // of supabase_migrations.schema_migrations, version 20260908215417.
    assert.match(script, /Date\.parse\('2026-09-08T21:54:17Z'\)/);
    assert.match(script, /20260908215417/, 'the ledger version that justifies the date is not cited');
  });

  test('a message still proves arrival, whatever the stamp says', () => {
    // The stamp is written on a page load, and the earliest athletes predate
    // it entirely - three of them were demonstrably talking to the coach.
    assert.match(script, /const reachedCoach = \(p\) => p\.coach_first_opened_at != null \|\| sent\.has\(p\.user_id\)/);
  });

  test('and it says so when there is nothing to report', () => {
    // A quiet zero and "we looked and found nothing" are different messages,
    // and only one of them tells you the check ran.
    assert.match(script, /No account has finished the intake and then measurably failed/);
  });
});
