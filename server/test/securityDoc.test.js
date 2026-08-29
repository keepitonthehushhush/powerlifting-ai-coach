import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { readRaw, phrase, latestDefinition } from './helpers/source.js';
import { redact } from '../src/lib/logger.js';

/**
 * docs/SECURITY.md, checked against the thing it describes.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * On 2026-08-29 an audit found six stale claims in that document and one that
 * was outright false: it said "Retention. Not yet implemented" while
 * private.apply_retention() had been running nightly under pg_cron since
 * migration 0031. The known-gaps list still said there was no audit log, no
 * retention policy, no terms of service and no password policy - all four of
 * which existed.
 *
 * Every one of those was wrong in the same direction: it understated what the
 * product does. That is the harmless-feeling kind of wrong, and it is not
 * harmless, because this is the document somebody reads to decide whether to
 * trust the system. A security posture nobody can verify from the outside is
 * indistinguishable from one that is not there.
 *
 * ── WHAT CAN AND CANNOT BE PINNED ─────────────────────────────────────────
 *
 * Prose cannot be tested. Claims about specific artifacts can, and those are
 * exactly the claims that rot: a list of functions, a list of redacted keys, a
 * table of retention periods, a statement that something is or is not
 * scheduled. Each assertion below reads the artifact rather than a copy of it,
 * for the reason the rest of this suite exists - a test that restates the
 * document agrees with the document, which is the one thing it must not do.
 */

const doc = readRaw(new URL('../../docs/SECURITY.md', import.meta.url));
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const sql = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => readFileSync(new URL(n, MIGRATIONS), 'utf8'))
  .join('\n');

test('the document does not contradict the schema', async (t) => {
  await t.test('it does not claim retention is unimplemented', () => {
    // The false claim itself, named so it cannot come back by a copy-paste.
    assert.ok(
      !/Retention[^\n]*Not yet implemented/i.test(doc),
      'SECURITY.md says retention is not implemented; migration 0031 schedules it nightly'
    );
    // And the positive half: if a sweep is scheduled, the document says so.
    if (/cron\.schedule\('apply-retention'/.test(sql)) {
      assert.match(doc, /apply-retention/, 'a scheduled sweep exists and the document never mentions it');
    }
  });

  await t.test('every retention category it tabulates is one the database has', () => {
    const categories = new Set(
      [...sql.matchAll(/\(\s*'([a-z0-9_]+)',\s*(\d+),/g)].map(([, c]) => c)
    );
    assert.ok(categories.size >= 6, `only parsed ${categories.size} retention categories`);
    // Every category the sweep knows about must be swept - the invariant the
    // database also asserts - and the doc must not have invented one.
    const sweep = latestDefinition('function private.apply_retention').body;
    for (const category of categories) {
      assert.match(sweep, new RegExp(`'${category}'`), `${category} has a period and no sweep`);
    }
  });

  await t.test('the gaps list does not claim absent things that exist', () => {
    /**
     * The OPEN gaps only. The section ends with a "Closed since the last
     * revision" list that names each thing that used to be a gap - so a search
     * over the whole section matches the record of the fix and reports the bug
     * as still present. Same collision readSource() exists for, in a different
     * costume: a regex cannot tell a claim from the note saying it is no longer
     * true. Caught by this test failing on its own first run.
     */
    const section = doc.slice(doc.indexOf('## Known gaps'));
    const closed = section.indexOf('### Closed since the last revision');
    const gaps = closed === -1 ? section : section.slice(0, closed);
    for (const [claim, why] of [
      [/\*\*No audit log\.\*\*/, 'audit_events exists (migration 0030)'],
      [/\*\*No automated retention policy\.\*\*/, 'apply_retention runs nightly (0031)'],
      [/no terms of service/i, 'tos-2026-08-27b exists and is consented to'],
      [/password policy is whatever Supabase/i, 'a 12-character policy and a breach check exist'],
    ]) {
      assert.ok(!claim.test(gaps), `Known gaps still says: ${why}`);
    }
  });
});

test('the controls it describes are the controls that exist', async (t) => {
  await t.test('every key it says is redacted actually is', () => {
    /**
     * Read out of the sentence, then run through the REAL redactor. The list
     * matches on substrings, so whether a name is covered is a property of the
     * function rather than of the array - which is why this executes it
     * instead of comparing two lists.
     */
    const sentence = doc.slice(doc.indexOf('recursively redacts keys matching'));
    const claimed = [...sentence.slice(0, 600).matchAll(/`([a-z0-9_]+)`/g)].map(([, k]) => k);
    assert.ok(claimed.length >= 8, `only parsed ${claimed.length} claimed keys`);

    const logged = redact(Object.fromEntries(claimed.map((k) => [k, 'SENSITIVE'])));
    const leaked = Object.entries(logged).filter(([, v]) => v === 'SENSITIVE').map(([k]) => k);
    assert.deepEqual(leaked, [], `SECURITY.md claims these are redacted and they are not: ${leaked.join(', ')}`);
  });

  await t.test('and pronouns are still excluded, as it says', () => {
    assert.match(doc, phrase('pronouns` is deliberately **not** redacted', 'i'));
    assert.equal(redact({ pronouns: 'they/them' }).pronouns, 'they/them');
  });

  await t.test('every definer function it lists as accepted is one the migrations create', () => {
    const section = doc.slice(doc.indexOf('## 9. Accepted linter warnings'));
    const listed = [...section.matchAll(/- `public\.([a-z_]+)\(/g)].map(([, fn]) => fn);
    assert.ok(listed.length >= 7, `SECURITY.md lists only ${listed.length} definer functions`);

    for (const fn of listed) {
      assert.match(
        sql,
        new RegExp(`function public\\.${fn}\\s*\\(`),
        `SECURITY.md accepts public.${fn} as a definer function and no migration creates it`
      );
    }
  });

  await t.test('and the reverse: a user-callable definer function is not undocumented', () => {
    /**
     * The direction that actually matters. A function gaining owner rights and
     * never appearing in the security document is the shape of the thing this
     * document exists to make visible - and it is how the list drifted from
     * two to seven without anybody noticing.
     *
     * Scoped to functions that grant EXECUTE to authenticated, because the
     * private-schema ones are unreachable by users and are covered by 0004.
     */
    const section = doc.slice(doc.indexOf('## 9. Accepted linter warnings'));
    const definers = new Set(
      [...sql.matchAll(/function public\.([a-z_]+)\s*\([^)]*\)[\s\S]{0,400}?security definer/gi)]
        .map(([, fn]) => fn)
    );
    const userCallable = [...definers].filter((fn) =>
      new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated`, 'i').test(sql)
    );
    assert.ok(userCallable.length >= 5, `only found ${userCallable.length} user-callable definer functions`);

    const undocumented = userCallable.filter((fn) => !section.includes(`public.${fn}(`)).sort();
    assert.deepEqual(
      undocumented,
      [],
      `these run with owner rights, are callable by any signed-in user, and are absent ` +
        `from SECURITY.md section 9: ${undocumented.join(', ')}`
    );
  });

  await t.test('the third-party requests it names are the ones the browser makes', () => {
    // Two, and the document must name both. Turnstile was absent from this
    // file entirely while running on the sign-in page of a health-data product.
    assert.match(doc, /Turnstile/, 'Cloudflare Turnstile runs on sign-in and SECURITY.md never mentions it');
    assert.match(doc, /pwnedpasswords\.com|HaveIBeenPwned/i);

    const web = readRaw(new URL('../../web/src/lib/turnstile.js', import.meta.url));
    assert.match(web, /challenges\.cloudflare\.com/);
    // The secret key must never appear anywhere in the repository.
    assert.ok(!/TURNSTILE_SECRET/.test(doc), 'SECURITY.md references a Turnstile secret key');
  });
});
