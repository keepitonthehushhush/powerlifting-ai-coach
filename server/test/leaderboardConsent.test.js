import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { POLICY_VERSIONS, REQUIRED_CONSENTS, CONSENT_TYPES } from '../src/lib/policyVersions.js';
import { POLICY_DOCUMENTS } from '../../web/src/lib/policyDocuments.js';

/**
 * ── WHY PUBLISHING NEEDED ITS OWN CONSENT ───────────────────────────────────
 *
 * Everything else this product holds is used to coach the person it belongs
 * to. The leaderboard is the only thing shown to anybody else, which makes it
 * a different PURPOSE, and until now the only record that somebody agreed to
 * it was the existence of a row in leaderboard_entries.
 *
 * That row is not a consent record, for three reasons, and the third decides
 * it: it carries no version, so the terms could change with no way to ask
 * again; its timestamp moves every time the numbers are recomputed; and
 * LEAVING DELETES IT - so the evidence that consent was obtained disappears at
 * exactly the moment somebody might dispute it. A controller has to be able to
 * demonstrate consent, and a record destroyed by withdrawal demonstrates
 * nothing.
 */

const migration = readRaw(new URL('../../supabase/migrations/0028_leaderboard_consent.sql', import.meta.url));
const page = readSource(new URL('../../web/src/pages/Leaderboard.jsx', import.meta.url));
const pageRaw = readRaw(new URL('../../web/src/pages/Leaderboard.jsx', import.meta.url));
const policy = readSource(new URL('../../web/src/pages/LeaderboardPolicy.jsx', import.meta.url));
const route = readSource(new URL('../src/routes/leaderboard.js', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

describe('the consent exists and is genuinely optional', () => {
  test('it is a consent type with a version and a document', () => {
    assert.ok(CONSENT_TYPES.includes('leaderboard_publication'));
    assert.match(POLICY_VERSIONS.leaderboard_publication, /^lbp-\d{4}-\d{2}-\d{2}/);
    assert.equal(POLICY_DOCUMENTS.leaderboard_publication, '/policies/leaderboard');
  });

  test('IT IS NOT REQUIRED, AND MUST NEVER BE', () => {
    // A permission that costs something to refuse is not freely given. Every
    // other feature behaves identically without this one, and the policy page
    // says so in those words.
    assert.ok(!REQUIRED_CONSENTS.includes('leaderboard_publication'));
    assert.match(policy, phrase('A permission that costs you something to refuse is not freely given'));
  });
});

describe('the database refuses to publish without it', () => {
  test('THE CHECK IS IN THE FUNCTION, NOT THE BUTTON', () => {
    // Same reasoning as the health-data trigger: the browser is not the
    // control, and "the UI would not let you" is not enforcement. A person can
    // call the RPC directly.
    assert.match(migration, /if not public\.has_active_consent\('leaderboard_publication'\) then/);
    assert.match(migration, /raise exception 'leaderboard_consent_required'/);
    assert.match(migration, phrase('the browser is not the control'));
  });

  test('and because has_active_consent is version-aware, a stale agreement does not count', () => {
    // 0027 made the function require the current version. A change to what
    // publishing means should stop republishing until it is agreed again.
    assert.match(migration, phrase('agreed to a superseded version of the leaderboard terms'));
  });

  test('LEAVING IS NOT GATED, BECAUSE WITHDRAWAL MUST NEVER BE HARDER', () => {
    // The delete runs before every check. Somebody whose consent went stale
    // must still be able to take themselves off the board.
    const body = migration.slice(migration.indexOf('create or replace function public.set_leaderboard_opt_in'));
    const leave = body.indexOf('delete from public.leaderboard_entries');
    const gate = body.indexOf("has_active_consent('leaderboard_publication')");
    assert.ok(leave !== -1 && gate !== -1);
    assert.ok(leave < gate, 'the consent check runs before the leave path - withdrawal can be blocked');
  });

  test('the route turns the database refusal into a sentence', () => {
    assert.match(route, /leaderboard_consent_required/);
    assert.match(route, /Agree to the leaderboard terms before joining\./);
  });
});

describe('withdrawing the consent takes them off the board', () => {
  test('a granted=false row deletes the entry', () => {
    // Otherwise "I withdraw permission to publish my lifts" leaves the lifts
    // published, and the consent panel becomes a form that lies.
    assert.match(migration, /new\.consent_type = 'leaderboard_publication' and new\.granted = false/);
    assert.match(migration, /delete from public\.leaderboard_entries where user_id = new\.user_id/);
  });

  test('AND GRANTING DOES NOT ADD ONE', () => {
    // Agreeing that publication is acceptable is not the same act as asking to
    // be published. Inferring the second from the first is how somebody ends
    // up on a leaderboard they never joined.
    assert.match(migration, phrase('Deliberately one-directional'));
    assert.ok(!/granted = true[\s\S]{0,200}insert into public\.leaderboard_entries/.test(migration));
  });

  test('the trigger is not callable by users', () => {
    assert.match(migration, /revoke all on function private\.leaderboard_follows_consent\(\) from anon, authenticated, public;/);
  });
});

describe('what the page asks, and in what order', () => {
  test('THE DOCUMENT COMES BEFORE THE CHECKBOX', () => {
    // Agreeing to something before it has been made available is not informed
    // consent, and a link under the control is a link nobody sees.
    const link = page.indexOf("policyPathFor('leaderboard_publication')");
    const box = page.indexOf('checked={agreedNow}');
    assert.ok(link !== -1 && box !== -1, 'the policy link or the agreement box is missing');
    assert.ok(link < box, 'the checkbox appears before the document it agrees to');
  });

  test('join is disabled until the agreement is actually given', () => {
    assert.match(page, /!\(consented \|\| agreedNow\)/);
  });

  test('the consent is recorded BEFORE the opt-in, or every first join would fail', () => {
    const record = page.indexOf("recordConsent('leaderboard_publication', true)");
    const optIn = page.indexOf('setLeaderboardOptIn(optIn)');
    assert.ok(record !== -1 && optIn !== -1);
    assert.ok(record < optIn, 'the opt-in is attempted before the consent it requires');
  });

  test('a stale agreement counts as not agreed, same as everywhere else', () => {
    // The page, the consent panel and has_active_consent() must agree about
    // what counts, or one of them is lying to somebody.
    assert.match(page, /Boolean\(record\?\.granted\) && !record\?\.stale/);
  });

  test('and the agreement text says what is published and that it can be withdrawn', () => {
    assert.match(en, phrase('may be shown to other signed-in users'));
    assert.match(en, phrase('I can withdraw this at any time, and it deletes my entry'));
  });

  test('afterwards it points at where the permission lives', () => {
    assert.match(page, /leaderboard\.consentRecorded/);
    assert.match(page, /to="\/consent"/);
  });
});

describe('the policy document', () => {
  test('lists what is published and what is not, in that order', () => {
    assert.ok(policy.indexOf('What is published') < policy.indexOf('What is not'));
    for (const excluded of ['bodyweight', 'age', 'injuries', 'conversations', 'achievements']) {
      assert.ok(policy.toLowerCase().includes(excluded), `the policy does not say ${excluded} is excluded`);
    }
  });

  test('says the numbers cannot be typed in, which is a claim the schema backs', () => {
    assert.match(policy, phrase('permission to write those numbers is not granted to any user account'));
  });

  test('says leaving deletes rather than hides', () => {
    assert.match(policy, phrase('deletes'));
    assert.match(policy, phrase('rather than hiding it'));
  });

  test('and explains why the consent record survives leaving', () => {
    // People read a retained record as a broken promise unless told why.
    assert.match(policy, phrase('we have to be able to show that consent was obtained'));
  });

  test('it carries its version, and it is the one that gets recorded', () => {
    assert.ok(policy.includes(POLICY_VERSIONS.leaderboard_publication));
  });

  test('it is a draft until a lawyer has seen it, and says so', () => {
    assert.match(readRaw(new URL('../../web/src/pages/LeaderboardPolicy.jsx', import.meta.url)),
      /pending legal review/i);
  });
});

describe('the rule was backfilled, not just applied to newcomers', () => {
  const backfill = readRaw(new URL('../../supabase/migrations/0029_leaderboard_entries_need_consent.sql', import.meta.url));
  const invariants = readRaw(new URL('../../scripts/check-db-invariants.mjs', import.meta.url));

  test('ENTRIES PUBLISHED BEFORE THE CONSENT EXISTED ARE REMOVED', () => {
    // A rule introduced with no backfill holds for everybody who arrives after
    // it and nobody who arrived before - and the rows created before the rule
    // are precisely the ones with no record of agreement.
    assert.match(backfill, /delete from public\.leaderboard_entries e/);
    assert.match(backfill, /where not exists \(/);
  });

  test('it deletes only the cache, and says which data it does not touch', () => {
    // Every number in leaderboard_entries is recomputed from progress_logs on
    // rejoining, so nothing an athlete created is lost.
    assert.match(backfill, phrase('Does NOT touch: progress_logs, user_profile, display names'));
    assert.match(backfill, phrase('they were derived here'));
    assert.ok(!/delete from public\.(progress_logs|user_profile|consent_records)/.test(backfill));
  });

  test('"latest decision" means seq, not created_at, here too', () => {
    // The 0010 bug is one careless ORDER BY away in every query that reduces
    // this ledger.
    //
    // Scoped to the STATEMENT, not the file. The header comment explains the
    // bug and therefore contains the words "created_at", so an absence
    // assertion against the whole file matches the explanation of why the
    // thing is absent. That is the fifth time this collision has bitten this
    // suite - see helpers/source.js - and the fix here is to assert against
    // the code rather than the prose about the code.
    const statement = backfill.slice(backfill.indexOf('delete from public.leaderboard_entries'));
    assert.match(statement, /order by c\.user_id, c\.seq desc/);
    assert.ok(!/created_at/.test(statement), 'the delete statement orders by created_at');
  });

  test('AND THE CONDITION IS CHECKED FROM NOW ON, NOT FIXED ONCE', () => {
    // A one-time DELETE fixes today. The invariant fails if any future path
    // ever writes an entry around set_leaderboard_opt_in().
    assert.match(invariants, /NO LEADERBOARD ENTRY EXISTS WITHOUT A CURRENT CONSENT BEHIND IT/);
    assert.match(invariants, /from public\.leaderboard_entries e/);
    assert.match(invariants, /order by c\.user_id, c\.seq desc/);
  });

  test('the invariant requires the CURRENT version, matching has_active_consent', () => {
    const check = invariants.slice(invariants.indexOf('NO LEADERBOARD ENTRY EXISTS'));
    assert.match(check.slice(0, 1400), /latest\.policy_version = \(/);
  });
});
