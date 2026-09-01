import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * The privacy policy has to describe THIS application.
 *
 * A privacy policy is the easiest document in a codebase to write from a
 * template and the hardest to notice going stale, because nothing breaks when
 * it does. The failure is silent and the person it misleads is a user.
 *
 * This project already learned that twice, on the two documents that had
 * tests: chd-2026-08-27 disclosed four fewer lifestyle fields than the code
 * collected, and aip-2026-08-27 omitted age, progress cadence and session
 * notes. Both were found by a test comparing the page against the source, and
 * both were bumped rather than quietly corrected.
 *
 * So the new page gets the same treatment: the retention periods are checked
 * against the rows the database actually enforces, and the third parties are
 * checked against the hosts this application actually contacts.
 */

const raw = (url) => readFileSync(url, 'utf8');
const page = raw(new URL('../../web/src/pages/PrivacyPolicy.jsx', import.meta.url));

/**
 * Whitespace-tolerant, because JSX wraps prose wherever the formatter likes.
 *
 * Used for EVERY multi-word assertion in this file, without exception. The
 * first draft used plain literals for three of them and all three failed
 * against text that was plainly on the page, split across a line break by
 * Prettier. A guard defeated by reformatting is the failure mode this
 * codebase has hit more times than any other.
 */
function phrase(text, flags = '') {
  return new RegExp(text.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), flags);
}

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
function allMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => raw(new URL(f, MIGRATIONS)))
    .join('\n');
}

describe('the privacy policy exists and is reachable', () => {
  test('it is routed and linked from the front page', () => {
    const app = raw(new URL('../../web/src/App.jsx', import.meta.url));
    const home = raw(new URL('../../web/src/pages/Home.jsx', import.meta.url));
    assert.match(app, /path="\/policies\/privacy"/);
    assert.match(home, /to="\/policies\/privacy"/);
  });

  test('it is a SEPARATE document from the health data policy, and links to it', () => {
    // Washington's MHMDA requires the consumer health data policy to be its own
    // document with its own link. Folding health data into a general policy
    // would undo the thing that requirement is asking for.
    assert.match(page, /to="\/policies\/health-data"/);
    assert.doesNotMatch(page, phrase('injury and medical notes are collected because', 'i'));
  });

  test('it carries a version and a draft banner', () => {
    assert.match(page, /pp-2026-08-31b/);
    assert.match(page, phrase('has not been reviewed by an attorney', 'i'));
  });
});

describe('what it promises is what the database does', () => {
  test('every retention period on the page is one the database enforces', () => {
    /*
     * The review's A5: four categories were disclosed and eight existed, and
     * the sharpest example was error_events - carried in the data export as
     * the person's own data, and absent from the retention disclosure. A
     * document that treats something as personal data in one place and forgets
     * it in another is not a small inconsistency; it is the one a regulator
     * reads out loud.
     */
    const migrations = allMigrations();
    const expected = [
      ['injury and medical notes', '12 months'],
      ['GLP-1 medication status', '12 months'],
      ['Conversation messages', '12 months'],
      ['Account activity records', '24 months'],
      ['Usage and cost records', '24 months'],
      ['Error records', '6 months'],
      ['Payment webhook identifiers', '3 months'],
      ['Your named obstacle and if-then plan', '12 months'],
      ['Guardian consent requests', '24 months'],
    ];
    for (const [label, period] of expected) {
      assert.match(page, phrase(label, 'i'), `the page does not disclose ${label}`);
      assert.match(page, phrase(period, 'i'), `the page does not state ${period}`);
    }

    // And the other direction: every category the database sweeps must appear
    // above, or a new retention rule can ship undisclosed.
    const categories = [...migrations.matchAll(/insert into public\.retention_periods[\s\S]*?;/g)]
      .join('\n')
      .match(/'([a-z0-9_]+)'\s*,\s*\d+/g) ?? [];
    const known = new Set(
      categories.map((c) => c.match(/'([a-z0-9_]+)'/)[1]).filter((c) => c !== 'guardian_email'),
    );
    const disclosed = {
      health_restrictions: 'injury and medical notes',
      glp1_status: 'GLP-1 medication status',
      conversation_messages: 'Conversation messages',
      audit_events: 'Account activity records',
      usage_events: 'Usage and cost records',
      error_events: 'Error records',
      stripe_events: 'Payment webhook identifiers',
      training_intention: 'Your named obstacle and if-then plan',
      guardian_consent_requests: 'Guardian consent requests',
    };
    for (const category of known) {
      assert.ok(
        category in disclosed,
        `retention category "${category}" is swept by the database and not disclosed on the privacy policy`,
      );
    }
  });

  test('every third party named is one this application actually contacts', () => {
    for (const party of ['Anthropic', 'Supabase', 'Vercel', 'Stripe', 'Cloudflare', 'Have I Been Pwned']) {
      assert.match(page, new RegExp(party), `${party} is not named`);
    }
    // Named parties this app does NOT use would be a template leaking through.
    for (const absent of ['Google Analytics', 'Facebook', 'Segment', 'Mixpanel', 'Amplitude']) {
      assert.doesNotMatch(page, new RegExp(absent, 'i'), `${absent} appears but is not used`);
    }
  });

  test('the no-sale statement is unambiguous', () => {
    // CCPA/CPRA wants this said plainly rather than implied. "Sharing" has a
    // specific statutory meaning - cross-context behavioral advertising - and
    // saying only "we do not sell" leaves the other half unanswered.
    assert.match(page, phrase('We do not sell your personal information', 'i'));
    assert.match(page, phrase('cross-context behavioral advertising', 'i'));
  });

  test('it names the two things deletion leaves behind', () => {
    // The same correction made in the Terms. The export includes audit rows
    // and Stripe holds its own copy; a policy claiming otherwise is the A7
    // defect moved to a new page.
    assert.match(page, /audit trail/i);
    assert.match(page, phrase('Stripe keeps its own transaction records', 'i'));
  });

  test('it commits to a breach notification window', () => {
    assert.match(page, phrase('within 72 hours of confirming it', 'i'));
    assert.match(page, phrase('Health Breach Notification Rule', 'i'));
  });

  test('it states the operator and where they are', () => {
    assert.match(page, phrase('operated by an individual', 'i'));
    assert.match(page, /based in [A-Z][a-z]+, United States/);
  });
});

describe('the terms carry the clauses the review said were missing', () => {
  const terms = raw(new URL('../../web/src/pages/Terms.jsx', import.meta.url));

  test('governing law, venue, and an explicit position on arbitration', () => {
    assert.match(terms, /laws of the State of [A-Z][a-z]+/);
    // Silence on arbitration is ambiguous. Saying there is none is a position.
    assert.match(terms, phrase('There is no arbitration clause', 'i'));
  });

  test('the two documents name the SAME state, and it is where the operator is', () => {
    /*
     * ── THE ERROR THIS EXISTS FOR ─────────────────────────────────────────
     *
     * The first draft said Florida - governing law, venue, and the operator's
     * location - and the operator is in Michigan. It came from a menu of
     * options nobody checked against reality, and it surfaced only when he
     * asked for a lawyer near his actual town. Five places, two documents, one
     * wrong fact.
     *
     * Hardcoding the right state here would pin today's answer and catch
     * nothing: the failure was never "the state is not Michigan", it was
     * "nobody compared the state to anything". So this compares the documents
     * to each other. If somebody moves, or edits one clause and not the other,
     * these disagree and the suite says so.
     */
    const governing = terms.match(/laws of the State of ([A-Z][a-z]+)/)?.[1];
    const venue = terms.match(/courts located in ([A-Z][a-z]+)/)?.[1];
    const operator = page.match(/based in ([A-Z][a-z]+), United States/)?.[1];

    assert.ok(governing, 'the Terms name no governing law');
    assert.ok(venue, 'the Terms name no venue');
    assert.ok(operator, 'the privacy policy does not say where the operator is');

    assert.equal(venue, governing, 'the Terms pick one state for law and another for venue');
    assert.equal(
      operator,
      governing,
      `the privacy policy says the operator is in ${operator} while the Terms choose ${governing} law`,
    );
  });

  test('a liability cap with a number in it', () => {
    // "To the fullest extent permitted by law we are not liable" on its own is
    // not a cap - it was the entire liability section before this change.
    assert.match(terms, phrase('total liability', 'i'));
    assert.match(terms, phrase('one hundred US dollars', 'i'));
  });

  test('a warranty disclaimer', () => {
    assert.match(terms, /as is/i);
    assert.match(terms, phrase('fitness for a particular purpose', 'i'));
  });

  test('assumption of risk, which a barbell product needs by name', () => {
    assert.match(terms, phrase('You train at your own risk', 'i'));
  });

  test('indemnity, severability, entire agreement, assignment, force majeure, survival', () => {
    for (const clause of ['indemnify', 'Severability', 'Entire agreement', 'Assignment', 'Force majeure', 'Survival']) {
      assert.match(terms, new RegExp(clause, 'i'), `missing: ${clause}`);
    }
  });

  test('subscription terms say how renewal and cancellation work', () => {
    // California's amended auto-renewal law wants affirmative consent to the
    // renewal terms specifically, and cancellation online without further
    // steps. Stripe is already wired, so this stops being theoretical the day
    // the paywall flips.
    assert.match(terms, phrase('renews automatically', 'i'));
    assert.match(terms, phrase('You can cancel at any time', 'i'));
    assert.match(terms, /refund/i);
  });

  test('a copyright route and an accessibility statement', () => {
    assert.match(terms, /copyright/i);
    assert.match(terms, phrase('Web Content Accessibility Guidelines', 'i'));
  });

  test('the accessibility claim does not overstate what is verified', () => {
    // The contrast thresholds ARE machine-checked; the rest is not. Claiming
    // full conformance would be the same defect class as every other
    // overclaim this suite exists to catch.
    assert.match(terms, phrase('not yet verified', 'i'));
  });
});
