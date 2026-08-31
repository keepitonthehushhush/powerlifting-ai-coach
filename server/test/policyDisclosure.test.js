import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSource, readRaw, phrase, readProfileApi } from './helpers/source.js';
import { redact } from '../src/lib/logger.js';

/**
 * THE DOCUMENTS ARE HELD TO THE CODE, NOT TO THEMSELVES.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * policyDocuments.test.js already checks that each consent has a document,
 * that the document is routed, readable without an account, and stamped with
 * the version the ledger records. Every one of those passed on 2026-08-27
 * while all three documents were describing an application that had moved on.
 *
 *   - the consumer health data policy did not mention sleep, alcohol,
 *     nicotine or nutrition notes, four fields it stores under that consent
 *   - the AI processing page said the date of birth is "not sent to the
 *     model", while the athlete's AGE - derived from it, and the subject of a
 *     whole section of the prompt - is sent on every message
 *   - the terms said accounts are refused below 18. No code refuses an
 *     account; what is refused is storing health data
 *   - the data export claimed to contain everything held about somebody and
 *     omitted the consent ledger and usage_events
 *
 * A structural test cannot read English and decide whether a paragraph is
 * true. What it CAN do is notice that a column, a table, or a field reaches
 * somewhere it must be disclosed and that no disclosure has been mapped for
 * it. So each map below is the specification: adding a column without adding
 * a line to the map fails, and the failure names the column.
 *
 * The technique is the one used for the clinician page - hold the page to the
 * source of truth rather than to a copy of itself.
 */

const prompt = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));
const account = readSource(new URL('../src/routes/account.js', import.meta.url));
const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const aiPage = readRaw(new URL('../../web/src/pages/AiProcessing.jsx', import.meta.url));
const healthPage = readRaw(new URL('../../web/src/pages/HealthDataPolicy.jsx', import.meta.url));
const termsPage = readRaw(new URL('../../web/src/pages/Terms.jsx', import.meta.url));

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readRaw(new URL(f, new URL('../../supabase/migrations/', import.meta.url))))
  .join('\n');

/**
 * Every profile column the coach is told about, and the words on the AI
 * processing page that disclose it.
 *
 * The value is a phrase that must appear on that page. It is not the column
 * name: a privacy document written in column names is not a document a person
 * can read, and "date_of_birth" appearing on the page would have satisfied a
 * naive check while the page was actively denying that anything derived from
 * it is sent.
 */
const SENT_TO_THE_MODEL = {
  date_of_birth: 'Your age in whole years',
  experience_level: 'experience',
  progress_cadence: 'how quickly your lifts have been progressing',
  units: 'units',
  bodyweight: 'bodyweight',
  current_squat: 'current lifts',
  current_bench: 'current lifts',
  current_deadlift: 'current lifts',
  goal: 'goal',
  competition_date: 'competition date',
  equipment_available: 'equipment',
  gender: 'your gender if you gave one',
  glp1_status: 'whether you use a GLP-1 medication, if you told us',
  gender_self_described: 'your gender if you gave one',
  pronouns: 'Your pronouns',
  gym_chains: 'Which gym chains you ticked',
  gym_label: 'branch note',
  days_per_week: 'days per week',
  sleep_hours_typical: 'sleep',
  alcohol_units_per_week: 'alcohol',
  nicotine_use: 'nicotine',
  nutrition_notes: 'nutrition notes',
  health_restrictions: 'Injuries and medical conditions',
  cleared_to_train: 'cleared to train',
};

/** Columns on user_profile that never reach renderProfile, and why. */
const NOT_SENT = {
  user_id: 'the row key',
  smallest_plate_pair: 'feeds the computed loads rather than being stated to the model',
  display_name:
    'the public leaderboard handle. Deliberately NOT sent: the coach already ' +
    'has a preferred name and pronouns for addressing somebody, so the handle ' +
    'adds nothing to the coaching and sending it would put a name the athlete ' +
    'chose for strangers into a third party request for no reason.',
  health_restrictions_updated_at:
    'when the injury note last changed, used only to expire it after 12 months ' +
    '(migration 0031). Not sent: the coach is given the restriction itself when ' +
    'there is one, and how old it is tells the model nothing it can coach on ' +
    'while being one more fact about somebody health in a third-party request.',
  free_forever:
    'marks somebody promised free coaching before the paywall existed ' +
    '(migration 0032). Not sent: it is a billing fact, and what somebody pays ' +
    'has no business shaping how they are coached.',
  glp1_status_updated_at:
    'when the medication answer last changed, used only to expire it after 12 ' +
    'months. Not sent, for the same reason as the injury timestamp: how old an ' +
    'answer is tells the model nothing it can coach on.',
  intake_completed_at: 'bookkeeping',
  created_at: 'bookkeeping',
  updated_at: 'bookkeeping',
};

/** Pull `profile.<column>` out of the profile renderer, which is what is sent. */
function columnsRenderedToTheModel() {
  const start = prompt.indexOf('function renderProfile(');
  assert.ok(start > 0, 'renderProfile has been renamed - this test is now measuring nothing');
  const end = prompt.indexOf('\nfunction ', start + 1);
  const body = prompt.slice(start, end === -1 ? undefined : end);
  // [a-z0-9_], not [a-z_]: the first column with a digit in its name -
  // glp1_status - parsed as "glp" and produced a demand to disclose a field
  // that does not exist, while the one that does went unchecked.
  return new Set([...body.matchAll(/profile\.([a-z0-9_]+)/g)].map((m) => m[1]));
}

/** Every column that exists on user_profile, from the migrations. */
function profileColumns() {
  const created = migrations.slice(
    migrations.indexOf('create table public.user_profile'),
    migrations.indexOf('comment on table  public.user_profile')
  );
  const columns = new Set(
    // [a-z0-9_] here too - same digit problem as above, and this is the half
    // that decides which columns get audited at all.
    [...created.matchAll(/^\s{2}([a-z0-9_]+)\s+(uuid|text|numeric|boolean|int|date|timestamptz)/gm)].map((m) => m[1])
  );
  // One `alter table` can add several columns in a single statement - 0012
  // adds four - so this takes the whole statement and then every `add column`
  // inside it. A regex anchored on `alter table` and scanning forward matches
  // once per statement and silently drops the rest, which is how this test
  // first reported that alcohol_units_per_week had "vanished from the schema".
  for (const statement of migrations.split('alter table public.user_profile').slice(1)) {
    const body = statement.slice(0, statement.indexOf(';'));
    for (const m of body.matchAll(/add column (?:if not exists )?([a-z0-9_]+)/g)) columns.add(m[1]);
  }
  return columns;
}

describe('the AI processing page lists what actually goes to Anthropic', () => {
  test('every profile column in the prompt has a disclosure mapped to it', () => {
    for (const column of columnsRenderedToTheModel()) {
      assert.ok(
        column in SENT_TO_THE_MODEL,
        `profile.${column} is rendered into the system prompt and no disclosure is mapped for it. ` +
          'Add a line to SENT_TO_THE_MODEL and the corresponding words to AiProcessing.jsx.'
      );
    }
  });

  test('every mapped disclosure is actually printed on the page', () => {
    for (const [column, words] of Object.entries(SENT_TO_THE_MODEL)) {
      assert.match(aiPage, phrase(words, 'i'), `${column} is sent, and the page does not say so`);
    }
  });

  test('every column on the table is either sent-and-disclosed or explicitly not sent', () => {
    // The point of the second map is that "I did not think about it" and "it
    // does not go" stop looking the same.
    const columns = profileColumns();
    // A parser that finds nothing passes every assertion below it. This
    // number was checked against information_schema on the live database on
    // 2026-08-27: 23 columns, matching exactly, then 25 after 0023 and 28 after 0024. It goes UP when a migration
    // adds one, and this assertion is meant to be edited when that happens.
    assert.ok(columns.size >= 28, `only parsed ${columns.size} columns out of the migrations`);
    for (const column of columns) {
      assert.ok(
        column in SENT_TO_THE_MODEL || column in NOT_SENT,
        `user_profile.${column} is unaccounted for: say where it goes in SENT_TO_THE_MODEL or NOT_SENT`
      );
    }
  });

  test('THE AGE IS DISCLOSED, NOT JUST THE DATE IT CAME FROM', () => {
    // The specific defect this file was written for. The page was accurate
    // about the column and silent about the inference, which is the pattern
    // that gets named in enforcement actions rather than the one that hides.
    assert.match(prompt, /ageInYears\(profile\.date_of_birth\)/);
    assert.match(aiPage, phrase('your age is', 'i'));
    assert.doesNotMatch(
      aiPage,
      phrase('It is not sent to the model'),
      'the page is denying that anything from the date of birth reaches the model'
    );
  });

  test('the free-text note on a session is disclosed, because people put anything in it', () => {
    assert.match(prompt, /note: \$\{asData\(s\.notes\)\}/);
    assert.match(aiPage, phrase('including any note you wrote on a session', 'i'));
  });
});

describe('the health data policy lists what is stored under that consent', () => {
  // MHMDA is a disclosure statute before it is anything else. A field
  // collected under a consent whose document does not name it is the exact
  // failure mode.
  const CONSUMER_HEALTH_FIELDS = {
    health_restrictions: 'injuries, pain, and medical conditions',
    sleep_hours_typical: 'the hours you typically sleep',
    alcohol_units_per_week: 'alcoholic drinks',
    nicotine_use: 'whether you use nicotine',
    nutrition_notes: 'anything you choose to write about how you eat',
    gender: 'your gender, if you give it',
  };

  test('each health field the schema holds is named in the policy', () => {
    for (const [column, words] of Object.entries(CONSUMER_HEALTH_FIELDS)) {
      assert.ok(profileColumns().has(column), `${column} has vanished from the schema`);
      assert.match(healthPage, phrase(words, 'i'), `${column} is collected and the policy does not say so`);
    }
  });

  test('the lifestyle fields the prompt reads are the ones the policy declares', () => {
    // If a new lifestyle field is added to describeRecoveryConcerns, this is
    // the assertion that notices the policy was not updated with it.
    for (const column of Object.keys(CONSUMER_HEALTH_FIELDS)) {
      if (column === 'health_restrictions') continue;
      assert.ok(prompt.includes(`profile.${column}`), `${column} is declared but unused - or renamed`);
    }
  });
});

describe('the logger redacts everything the disclosure says it redacts', () => {
  test('injury and recovery values never survive a log line', () => {
    const line = redact({
      health_restrictions: 'left shoulder impingement',
      sleep_hours_typical: 5,
      alcohol_units_per_week: 21,
      nicotine_use: 'daily',
      nutrition_notes: 'skipping breakfast',
      date_of_birth: '1994-02-11',
      days_per_week: 4,
    });
    for (const key of [
      'health_restrictions',
      'sleep_hours_typical',
      'alcohol_units_per_week',
      'nicotine_use',
      'nutrition_notes',
      'date_of_birth',
    ]) {
      assert.equal(line[key], '[redacted]', `${key} reached the log`);
    }
    // And it is redaction, not blanket destruction: a log with nothing
    // diagnosable in it gets ignored, which is its own failure.
    assert.equal(line.days_per_week, 4);
  });

  test('the page does not claim more than the redactor delivers', () => {
    // The previous version promised recovery information was never logged
    // while the redactor knew nothing about those keys. It held only because
    // no call site happened to pass a profile.
    assert.match(aiPage, phrase('they do not record', 'i'));
    assert.match(aiPage, phrase('which fields you changed', 'i'));
    assert.match(readProfileApi({ raw: true }), /field\(s\) were rejected/);
  });

  test('no log call site is handed a message body', () => {
    assert.doesNotMatch(chat, /logger\.[a-z]+\('[^']*',\s*\{[^}]*\bmessage\b:\s*message/);
    assert.match(chat, /inputTokens: reply\.usage\?\.input_tokens/);
  });
});

describe('the export contains everything, which is what it says it contains', () => {
  /** Tables carrying a user_id, from the migrations - minus the ones with a reason. */
  const EXCLUDED = {
    // Not client-readable at all by design: 0006 took the grants away so a
    // client cannot forge its own rate limit state.
    rate_limit_counters: 'holds a request count and a timestamp, and is listed in not_included',
  };

  /**
   * Tables the export reaches through a function instead of a select, with the
   * call that proves it. Not an exemption - the table must still be in the
   * document - only a different spelling of how it gets there.
   *
   * leaderboard_entries is here because 0039 revoked user_id from
   * `authenticated`, so the export cannot filter on it and goes through
   * my_leaderboard_entry() instead (0042).
   */
  const EXCLUDED_BY_RPC = {
    leaderboard_entries: "rpc\\('my_leaderboard_entry'\\)",
  };

  /**
   * The export document only, not the whole route file.
   *
   * ── WHY THAT DISTINCTION IS THE WHOLE TEST ────────────────────────────────
   *
   * This used to match `from('<table>')` anywhere in account.js, and account.js
   * also holds GET /api/account/activity, which reads audit_events. So the
   * assertion "the export includes audit_events" was satisfied by a completely
   * different endpoint reading it for a completely different purpose, and
   * audit_events was absent from the export for as long as both existed.
   *
   * A test that accepts any mention of a name in a file is asking whether the
   * word appears, not whether the export contains the table.
   */
  const exportHandler = account.slice(
    account.indexOf("accountRouter.get('/export'"),
    account.indexOf('const DeleteRequest')
  );

  test('every user-scoped table is either exported or explicitly excused', () => {
    /**
     * `if not exists` is optional in the DDL and was not optional in this
     * regex, so three tables were invisible: audit_events, error_events and
     * leaderboard_entries. Two of them were fine by luck. leaderboard_entries
     * was not - somebody's published handle and lifts were absent from their
     * own subject access request, and this test reported the export complete.
     *
     * Second time a checker in this repository has looked at the right artifact
     * and asked a question narrower than the thing it was guarding; the health
     * data column comments were the first, three days ago.
     */
    const tables = new Set(
      [...migrations.matchAll(/create table (?:if not exists )?public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g)]
        .filter(([, , body]) => /user_id/.test(body))
        .map(([, name]) => name)
    );
    assert.ok(tables.size >= 11, `only found ${tables.size} user-scoped tables - the parser has drifted`);

    // The ones the old regex could not see, named individually. If the parser
    // is ever loosened again, a generic count will not notice losing these.
    for (const table of ['audit_events', 'error_events', 'leaderboard_entries']) {
      assert.ok(tables.has(table), `the parser stopped seeing ${table}`);
    }

    for (const table of tables) {
      if (table in EXCLUDED) continue;
      assert.match(
        exportHandler,
        new RegExp(`from\\('${table}'\\)|${EXCLUDED_BY_RPC[table] ?? '\\0'}`),
        `${table} holds user rows and the data export does not include it`
      );
    }
  });

  test('the consent ledger and the usage rows are in there', () => {
    // Named individually because these two are the ones that were missing,
    // and a regression here is invisible in the generic assertion above if
    // somebody also changes the parser.
    assert.match(account, /from\('consent_records'\)/);
    assert.match(account, /from\('usage_events'\)/);
    assert.match(account, /consent_records: consents\.data/);
    assert.match(account, /usage_events: usage\.data/);
  });

  test('not_included no longer claims token counts are unheld', () => {
    // It was true when written and stopped being true when migration 0020
    // created a table full of them.
    const notIncluded = account.slice(account.indexOf('not_included'), account.indexOf('};', account.indexOf('not_included')));
    assert.doesNotMatch(notIncluded, /token counts/i);
  });
});

describe('the terms describe the age rule the code actually enforces', () => {
  test('nothing in the codebase refuses an account on age', () => {
    // The claim the terms used to make. The gate is on health data, and it is
    // in one place.
    const profileRoute = readProfileApi();
    assert.match(profileRoute, /if \(carriesHealthData\)/);
    assert.match(profileRoute, /evaluateAgeGate\(dateOfBirth\)/);
    // Only the operative text. The changelog above it quotes the claim that
    // was withdrawn, and a test that forbids the page from naming its own
    // correction would push the honest half of the document out of it - which
    // is the first version of this assertion, and it failed for that reason.
    const operative = termsPage.slice(termsPage.indexOf('What this service is'));
    assert.doesNotMatch(operative, phrase('Accounts are refused'));
  });

  test('the page says what is refused, and by what', () => {
    assert.match(termsPage, phrase('refuse to store injury or lifestyle information for anyone under 18', 'i'));
    assert.match(termsPage, phrase('fails closed', 'i'));
  });

  test('THE TERMS CLAIM A SERVER-SIDE GATE, AND ONE EXISTS', () => {
    // The previous version of this document described an enforcement that was
    // not in the code. This asserts the opposite direction: that the promise
    // on the page is backed by the route.
    assert.match(termsPage, phrase('that check runs on our server, not in', 'i'));
    assert.match(chat, /adultGateDecision\(context\.profile\)/);
    assert.match(chat, /adult_gate_/);
  });

  test('it does not claim to verify what it cannot verify', () => {
    // A statement that age is "verified" would be the same class of defect as
    // the one this file was written for: a document describing a capability
    // the product does not have.
    assert.match(termsPage, phrase('What we cannot do is verify any of it', 'i'));
    assert.doesNotMatch(termsPage, /we verify your age|age is verified/i);
  });

  test('there is a route back for a parent, and it is acted on', () => {
    // COPPA and the state statutes turn on ACTUAL KNOWLEDGE. A takedown path
    // that is honored is worth more than any wording that is not.
    assert.match(termsPage, phrase('If you are a parent or guardian', 'i'));
    assert.match(termsPage, phrase('we do not knowingly provide this service to', 'i'));
  });

  test('the terms and the intake hint tell the same story', () => {
    // They contradicted each other for weeks: the hint said health data
    // cannot be stored for under-18s, the terms said the account is refused.
    const en = readRaw(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
    assert.match(en, phrase('cannot store injury or lifestyle information', 'i'));
    assert.match(termsPage, phrase('under 18', 'i'));
  });

  test('the deletion promise matches the cascade that delivers it', () => {
    // Every user-scoped table hangs off auth.users with ON DELETE CASCADE, so
    // the sweep is a claim the schema makes true rather than one the route has
    // to remember.
    const cascades = [...migrations.matchAll(/references auth\.users \(id\) on delete cascade/g)];
    assert.ok(cascades.length >= 8, 'a user-scoped table may have been added without a cascade');
  });

  test('and it no longer promises more than the schema delivers', () => {
    /*
     * ── THE PROMISE THIS TEST USED TO PIN ─────────────────────────────────
     *
     * It asserted the Terms say "Nothing is kept back for our own records",
     * and treated the cascade count as proof of it. The cascades are real; the
     * sentence was not. Migration 0030 keeps audit_events after deletion with
     * user_id set to NULL, and Stripe keeps its own transaction records under
     * its own obligations - neither of which a cascade on auth.users touches.
     * The internal review flagged it as A7 and the sentence stayed for two
     * more weeks because a passing test sat on top of it.
     *
     * A test that pins a false claim is worse than no test: it converts a
     * documentation error into a thing you have to argue with CI about. So
     * this one now pins the opposite - that the overclaim is gone, and that
     * the two survivors are named where a reader will see them.
     */
    assert.doesNotMatch(termsPage, phrase('Nothing is kept back for our own records'));
    assert.match(termsPage, phrase('Two things survive', 'i'));
    assert.match(termsPage, /audit trail/i);
    assert.match(termsPage, /Stripe/);
  });
});

describe('every policy page dates its own change', () => {
  test('each carries a changelog for the version it is stamped with', () => {
    for (const [page, version] of [
      [termsPage, 'tos-2026-08-31a'],
      [aiPage, 'aip-2026-08-27c'],
      [healthPage, 'chd-2026-08-27b'],
    ]) {
      assert.match(page, phrase('What changed in this version'));
      assert.ok(page.includes(version), `${version} is not printed on its own page`);
      // Bumping a version invalidates every consent on file. Saying so on the
      // page is the difference between a re-consent prompt that looks like a
      // bug and one that looks like an explanation.
      assert.match(page, phrase('you will be asked to agree again', 'i'));
    }
  });
});

test('one unreachable source does not destroy the whole export', async (t) => {
  /**
   * ── THE OUTAGE THIS PREVENTS ──────────────────────────────────────────
   *
   * On 2026-08-30 the export gained a call to my_leaderboard_entry()
   * (migration 0042). The code was merged and deployed; the migration was not
   * applied to production. A function that does not exist errors like anything
   * else, and the export threw on the first error - so every subject access
   * request returned 500. Profile, programs, sessions, every logged lift,
   * withheld because one optional row could not be read.
   *
   * The deploy order was the mistake. This is the fragility that turned it
   * into an outage, and it is the kind an export should never have: this is
   * the one endpoint where "most of your data, plus an honest note about the
   * rest" beats "nothing".
   */
  const account = readSource(new URL('../src/routes/account.js', import.meta.url));
  const handler = account.slice(
    account.indexOf("accountRouter.get('/export'"),
    account.indexOf('const DeleteRequest')
  );

  await t.test('it no longer throws on the first failing source', () => {
    assert.ok(
      !/for \(const result of \[profile[^\]]*\]\)\s*\{\s*if \(result\.error\) throw/.test(handler),
      'the export still fails entirely when any one source errors'
    );
  });

  await t.test('but a missing profile is still fatal', () => {
    // An export with no profile is not a partial export, it is a different
    // document, and returning one would misrepresent what we hold.
    assert.match(handler, /if \(profile\.error\)/);
    assert.match(handler, /throw codedError\('storage_unavailable'/);
  });

  await t.test('and anything unreadable is NAMED in the document', () => {
    /**
     * The property that makes degrading acceptable. A subject access request
     * that silently omits a table is worse than one that fails, because the
     * person cannot tell which they got.
     */
    assert.match(handler, /could_not_be_included/);
    assert.match(handler, /couldNotInclude/);
    assert.match(handler, phrase('Nothing has been deleted'));
  });

  await t.test('and it is logged, so we find out rather than the user', () => {
    assert.match(handler, /account\.export_incomplete/);
  });
});
