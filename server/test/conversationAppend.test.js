import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw } from './helpers/source.js';

/**
 * ── THE LOST TURN ─────────────────────────────────────────────────────────
 *
 * POST /api/chat read the whole message array at the start of a request that
 * then spent up to 77 seconds in the model, and wrote the array back at the
 * end. Read-modify-write on a JSONB column, no version check, no lock:
 *
 *     A reads m1..m20, thinks for 60s
 *     B reads m1..m20, thinks for 45s
 *     A writes m1..m20 + uA + aA
 *     B writes m1..m20 + uB + aB      <- A's exchange is gone
 *
 * Nothing failed. Both replies were generated and paid for, the athlete may
 * have read both, and one then vanished on the next load - taking whatever
 * was said in it out of the coach's context permanently.
 *
 * Found in the data on 2026-09-06: 2026-09-02 held seven usage_events rows
 * and six assistant messages, six of the seven within one second of a stored
 * message and the seventh fifteen seconds from any of them, with a second
 * full reply sixteen seconds behind it. Never reported by anybody.
 */

const route = readRaw(new URL('../src/routes/chat.js', import.meta.url));
const migration = readRaw(
  new URL('../../supabase/migrations/0058_two_replies_at_once_stopped_erasing_each_other.sql', import.meta.url)
);

describe('the conversation is appended to, never overwritten', () => {
  test('THE ROUTE DOES NOT WRITE A MESSAGE ARRAY IT BUILT ITSELF', () => {
    /*
     * The property, stated as the absence it is. Any `update({ messages: ... })`
     * from the API is a lost-update bug however carefully the array is built,
     * because the array is always a snapshot from before the model call.
     */
    assert.doesNotMatch(
      route,
      /\.update\(\s*\{\s*messages:/,
      'the route overwrites the message array again - two crossing turns will erase one'
    );
    assert.match(route, /rpc\('append_conversation_turn'/, 'nothing appends the turn');
  });

  test('the append is one statement, not a read followed by a write', () => {
    // `messages || jsonb_build_array(...)` inside a single UPDATE is what makes
    // it atomic. A function that SELECTed the array and then UPDATEd it would
    // have exactly the same defect one layer down.
    assert.match(migration, /set messages = coalesce\(messages, '\[\]'::jsonb\) \|\| jsonb_build_array\(/);
    const body = migration.slice(migration.indexOf('as $fn$'), migration.indexOf('$fn$;'));
    assert.doesNotMatch(body, /select\s+messages\s+into/i, 'it reads the array before writing it');
  });

  test('and the response is what the database now holds', () => {
    /*
     * Not the array this request built. When two turns cross, the locally
     * built array is missing the other one, so answering with it shows the
     * athlete a conversation that disagrees with the one they get on reload -
     * the same defect moved from storage into the screen.
     */
    assert.match(route, /messages: storedTail/);
    assert.doesNotMatch(route, /messages: updated\.slice/);
  });

  test('an update that matched no row is reported, not answered 200', () => {
    // RLS refusing it, or the conversation deleted mid-request. The reply
    // exists and is stored nowhere; answering 200 would tell the athlete it
    // was saved.
    assert.match(route, /storedTail\)\s*\|\|\s*storedTail\.length === 0/);
    const guard = route.slice(route.indexOf('storedTail.length === 0'));
    assert.match(guard.slice(0, 200), /reply_not_saved/);
  });
});

describe('a refused append returns an empty array, never null', () => {
  test('THE OUTER SELECT HAS NO `from appended`, and that is the whole difference', () => {
    /*
     * Written the obvious way - `select coalesce(...) from appended` - the
     * outer select produces NO ROWS when the UPDATE matched none, and a scalar
     * SQL function with no rows returns SQL NULL. The coalesce never runs,
     * because there is nothing to run it on.
     *
     * Measured, not reasoned about: called as `authenticated` against a
     * conversation belonging to somebody else, the first version came back
     * NULL while its own comment promised `[]`. The route survived it by
     * accident - `Array.isArray(null)` is false - and a guard that works by
     * accident is one reordering away from `null.length`.
     */
    const body = migration.slice(migration.indexOf('as $fn$'), migration.indexOf('$fn$;'));
    assert.ok(body.length > 200, 'the function body could not be found - this check did not run');
    const outer = body.slice(body.lastIndexOf('select coalesce('));
    assert.doesNotMatch(outer, /\)\s*from appended\s*;/, 'the outer select reads from the CTE - it will return NULL');
    assert.match(outer, /'\[\]'::jsonb\);/, 'the empty default is gone');
  });

  test('and the route treats a refused append as a failure to save', () => {
    // null and [] must both reach reply_not_saved. Answering 200 would tell
    // the athlete a reply was stored when it is nowhere.
    assert.match(route, /!Array\.isArray\(storedTail\)/, 'a null result would pass the guard');
  });
});

describe('the append function takes no privilege it does not need', () => {
  test('IT IS SECURITY INVOKER, so RLS is what scopes it', () => {
    /*
     * Every other function in this schema is definer because each needs to
     * reach something the caller cannot. This one touches only
     * public.conversations, which the athlete already has RLS-scoped access
     * to - so running as the caller means `where id = p_conversation` can only
     * match a row they own. Definer would take the id from an argument while
     * bypassing the policy that makes the argument safe, which is the exact
     * shape this repository avoids everywhere else.
     */
    const fn = migration.slice(
      migration.indexOf('create or replace function public.append_conversation_turn'),
      migration.indexOf('$fn$;')
    );
    assert.ok(fn.length > 200, 'the function could not be found - this check did not run');
    assert.doesNotMatch(fn, /security definer/i, 'the append function was made SECURITY DEFINER');
    assert.match(fn, /set search_path to ''/, 'search_path is not pinned');
  });

  test('execute is revoked from public and granted only to authenticated', () => {
    assert.match(migration, /revoke all on function public\.append_conversation_turn\([^)]*\) from public;/);
    assert.match(migration, /grant execute on function public\.append_conversation_turn\([^)]*\) to authenticated;/);
    assert.doesNotMatch(migration, /grant execute on function public\.append_conversation_turn\([^)]*\) to anon/);
  });

  test('every reference inside it is schema-qualified', () => {
    const body = migration.slice(migration.indexOf('as $fn$'), migration.indexOf('$fn$;'));
    // With an empty search_path an unqualified name does not resolve, so this
    // is correctness rather than style - and it fails at runtime, not at
    // create time, which is how it would reach production.
    assert.match(body, /public\.conversations/);
    assert.doesNotMatch(body, /\bfrom conversations\b|\bupdate conversations\b/);
  });
});
