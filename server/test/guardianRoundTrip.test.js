import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, readRaw, phrase, latestDefinition } from './helpers/source.js';
import { POLICY_VERSIONS, GUARDIAN_CONSENT_VERSION, SELF_SERVICE_CONSENT_TYPES } from '../src/lib/policyVersions.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';
import { POLICY_DOCUMENTS } from '../../web/src/lib/policyDocuments.js';

/**
 * The guardian consent round trip.
 *
 * 0036 built the storage and left the flow as a paragraph in docs/UNDER_18.md.
 * This is the flow, and it has two halves with opposite security models: the
 * athlete asks while authenticated, and the guardian answers with no account at
 * all. Nearly everything below is about keeping that second half narrow.
 */

const route = readSource(new URL('../src/routes/guardian.js', import.meta.url));
const routeRaw = readRaw(new URL('../src/routes/guardian.js', import.meta.url));
const app = readSource(new URL('../src/app.js', import.meta.url));
const mailer = readSource(new URL('../src/lib/mailer.js', import.meta.url));
const mailerRaw = readRaw(new URL('../src/lib/mailer.js', import.meta.url));
const page = readRaw(new URL('../../web/src/pages/GuardianConsent.jsx', import.meta.url));
const decisionPage = readSource(new URL('../../web/src/pages/GuardianDecision.jsx', import.meta.url));
const migration = latestDefinition('function public.record_guardian_consent').body;
const requestFn = latestDefinition('function public.request_guardian_consent').body;
const migrationRaw = readRaw(
  new URL('../../supabase/migrations/0045_guardian_consent_round_trip.sql', import.meta.url)
);

test('the token', async (t) => {
  await t.test('is 32 bytes of CSPRNG, not a uuid or a timestamp', () => {
    // A guessable token is the whole attack: the endpoint that redeems it has
    // no user, so it cannot be rate limited per account.
    assert.match(route, /randomBytes\(32\)/);
    assert.doesNotMatch(route, /Math\.random|Date\.now\(\)\.toString/);
  });

  await t.test('reaches the database only as a hash', () => {
    // The RPC is handed sha256(token). If the token itself were ever passed,
    // a database dump would contain working consent links.
    assert.match(route, /p_token_hash:\s*sha256\(token\)/);
    assert.match(route, /p_token_hash:\s*sha256\(parsed\.data\.token\)/);
    assert.ok(
      !/p_token(?!_hash)\s*:/.test(route),
      'a raw token is being passed to the database'
    );
  });

  await t.test('and the column will only accept a hash', () => {
    // Belt and braces, in the database, where a future route cannot skip it.
    assert.match(migrationRaw, /token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  await t.test('is never written to a log line', () => {
    const logCalls = [...routeRaw.matchAll(/logger\.\w+\([^)]*\)/g)].map(([call]) => call);
    assert.ok(logCalls.length > 0, 'the route logs nothing at all - the assertion is vacuous');
    for (const call of logCalls) {
      assert.ok(!/\btoken\b/.test(call), `a log call mentions the token: ${call}`);
    }
  });
});

test('who may do what', async (t) => {
  await t.test('the guardian half mounts ABOVE requireAuth, the athlete half below', () => {
    /**
     * The security property of the whole file, asserted by source position the
     * way the paywall ordering is. app.js states it: "everything under /api is
     * authenticated unless it is visibly, explicitly, above this line."
     */
    const guard = app.indexOf("app.use('/api', requireAuth)");
    const publicMount = app.indexOf("app.use('/api/guardian', guardianPublicRouter)");
    const authedMount = app.indexOf("app.use('/api/guardian', guardianRouter)");

    assert.ok(guard > 0 && publicMount > 0 && authedMount > 0, 'a mount is missing');
    assert.ok(publicMount < guard, 'the guardian decision is mounted behind requireAuth, so no guardian can reach it');
    assert.ok(authedMount > guard, 'the athlete request endpoint is NOT behind requireAuth');
  });

  await t.test('only the decision is public - the request is not', () => {
    assert.match(route, /guardianPublicRouter\.post\('\/decision'/);
    assert.match(route, /guardianRouter\.post\('\/request'/);
    assert.ok(
      !/guardianPublicRouter\.post\('\/request'/.test(route),
      'the athlete request endpoint has been moved onto the public router'
    );
  });

  await t.test('the public path uses the anonymous client, never the service role', () => {
    // ADR-12 keeps the Stripe webhook as the single service-role path. A second
    // one turns a documented exception into a habit.
    assert.match(route, /createAnonymousClient\(\)\.rpc\('record_guardian_consent'/);
    assert.ok(!/supabaseAdmin/.test(route), 'the guardian flow reaches for the service role');
  });

  await t.test('the database grants the redeeming function to anon, and the requesting one not', () => {
    assert.match(migrationRaw, /grant execute on function public\.record_guardian_consent\(text, boolean\) to anon, authenticated/);
    assert.match(migrationRaw, /revoke all on function public\.request_guardian_consent\(text, text, int\) from public, anon/);
  });

  await t.test('and the athlete cannot read a token hash back out', () => {
    // A column grant rather than a table grant, for the same reason as 0039: a
    // policy narrows a privilege and does not create one.
    assert.match(
      migrationRaw,
      /grant select \(id, user_id, guardian_email, created_at, expires_at, decided_at, decision\)/
    );
    assert.ok(
      !/grant select on public\.guardian_consent_requests to authenticated/.test(migrationRaw),
      'a table-wide grant would expose token_hash'
    );
  });
});

test('the age band is enforced in the database, not in the route', async (t) => {
  await t.test('the function refuses adults and under-13s itself', () => {
    // A rule enforced only in a route is a rule the next route forgets.
    assert.match(requestFn, /years >= 18 or years < 13/);
    assert.match(requestFn, /guardian_consent_not_applicable/);
  });

  await t.test('and it refuses when there is no date of birth, rather than assuming', () => {
    assert.match(requestFn, /guardian_consent_requires_date_of_birth/);
  });
});

test('saying no always works; saying yes works once', async (t) => {
  await t.test('the expiry and single-use checks apply only to granting', () => {
    /**
     * The asymmetry the document's "withdraw at any time" promise rests on.
     * Both guards live inside `if p_granted`, so a withdrawal reaches neither.
     */
    const grantBranch = migration.slice(
      migration.indexOf('if p_granted then'),
      migration.indexOf('select v.version')
    );
    assert.match(grantBranch, /already_decided/);
    assert.match(grantBranch, /expired/);

    const outsideBranch = migration.replace(grantBranch, '');
    assert.ok(!/expires_at < now\(\)/.test(outsideBranch), 'expiry is checked outside the grant branch, so withdrawal can expire');
  });

  await t.test('a withdrawal is a new ledger row, never an edit', () => {
    assert.match(migration, /insert into public\.consent_records/);
    assert.ok(
      !/update public\.consent_records/.test(migration),
      'the append-only ledger is being edited'
    );
  });

  await t.test('and the page keeps offering it after an answer', () => {
    // Withdrawal must never be harder than consent.
    assert.match(decisionPage, /Actually, withdraw permission/);
  });
});

test('the email', async (t) => {
  await t.test('carries nothing about the athlete but a name they chose', () => {
    assert.match(route, /athleteName: profile\?\.display_name/);
    for (const forbidden of ['health_restrictions', 'date_of_birth', 'req.user.email', 'best_squat']) {
      assert.ok(!mailer.includes(forbidden), `the mailer references ${forbidden}`);
      assert.ok(!new RegExp(`athleteName:\\s*[^\\n]*${forbidden}`).test(route), `the email carries ${forbidden}`);
    }
  });

  await t.test('is plain text, so the recipient can see the URL', () => {
    // An HTML mail from a service a parent has never heard of, about their
    // child, is the shape of a phishing message.
    assert.match(mailer, /text: guardianMessage/);
    assert.ok(!/\bhtml:/.test(mailer), 'the guardian email has an HTML part');
  });

  await t.test('never logs the recipient', () => {
    const logCalls = [...mailerRaw.matchAll(/logger\.\w+\([^)]*\)/g)].map(([call]) => call);
    assert.ok(logCalls.length >= 3);
    for (const call of logCalls) {
      assert.ok(!/\bto\b\s*[,:)]|recipient|guardian_email/.test(call), `a log call carries the address: ${call}`);
    }
  });

  await t.test('and a failure is reported rather than swallowed', () => {
    /**
     * The one thing this flow must never do. The request row exists either way,
     * so a silent failure leaves the athlete waiting for a message that will
     * never arrive, with an interface that said it was sent.
     */
    assert.match(route, /if \(!outcome\.sent\)/);
    assert.match(route, /email_unavailable/);
    assert.match(mailer, phrase('return { sent: false, reason:'));
  });
});

test('the document exists, and is reachable', async (t) => {
  await t.test('the page carries the version the ledger will record', () => {
    // The defect terms_of_service shipped with: a version string for a document
    // nobody could read. Here the version is in a constant of its own.
    assert.ok(page.includes(GUARDIAN_CONSENT_VERSION), `GuardianConsent.jsx does not print ${GUARDIAN_CONSENT_VERSION}`);
    assert.match(migrationRaw, /policy_versions/);
  });

  await t.test('and the migration seeds the same version', () => {
    const seed = readRaw(new URL('../../supabase/migrations/0036_guardian_consent.sql', import.meta.url));
    assert.ok(seed.includes(GUARDIAN_CONSENT_VERSION), '0036 seeds a different version than the code records');
  });

  await t.test('it is mapped to a route, and the route exists', () => {
    assert.equal(POLICY_DOCUMENTS.guardian_consent, '/policies/guardian-consent');
    const appRaw = readRaw(new URL('../../web/src/App.jsx', import.meta.url));
    assert.match(appRaw, /path="\/policies\/guardian-consent"/);
    assert.match(appRaw, /path="\/guardian\/consent"/);
  });

  await t.test('the guardian page says the unsupervised part before it says anything else', () => {
    /**
     * docs/UNDER_18.md is explicit that this must not be buried: "the consent
     * has to say so in those words rather than in a paragraph nobody reads."
     * Asserted by POSITION, because the sentence existing somewhere near the
     * bottom is exactly the failure being guarded against.
     */
    const unsupervised = page.indexOf('Coach Diaz is not supervision');
    const whatItCollects = page.indexOf('What we collect about your child');
    assert.ok(unsupervised > 0, 'the page no longer says plainly that it is not supervision');
    assert.ok(
      unsupervised < whatItCollects,
      'the unsupervised warning has moved below the feature description'
    );
  });

  await t.test('and it is still NOT a consent the athlete can grant themselves', () => {
    /**
     * The page existing removes one of the three conditions in the note beside
     * GUARDIAN_CONSENT_VERSION. The other two stand: the athlete does not see
     * this on their consent screen and does not manage it. Letting it into
     * POLICY_VERSIONS would put a checkbox in front of a fifteen-year-old that
     * says their parent agreed.
     */
    assert.ok(!('guardian_consent' in POLICY_VERSIONS), 'guardian_consent is in POLICY_VERSIONS');
    assert.ok(!SELF_SERVICE_CONSENT_TYPES.includes('guardian_consent'));
  });
});

test('the athlete can actually start the flow', async (t) => {
  /**
   * ── WHY THIS TEST EXISTS ──────────────────────────────────────────────
   *
   * Migration 0045 built the token, both endpoints and the guardian's page,
   * and NOTHING in the application called POST /api/guardian/request. The
   * refusal told a thirteen-year-old to "ask them to give us their email
   * address on your profile page" and there was no field on the profile page.
   *
   * A half-reachable flow is worse than an unbuilt one: it looks finished from
   * every angle except the one that matters. So the assertion is not that the
   * component exists, it is that the chain from the refusal message to the
   * request endpoint is unbroken.
   */
  const panel = readSource(new URL('../../web/src/components/GuardianPanel.jsx', import.meta.url));
  const intake = readSource(new URL('../../web/src/pages/Intake.jsx', import.meta.url));
  const apiClient = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
  const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));

  await t.test('the refusal names a page that carries the form', () => {
    // The message says "on your profile page". SiteNav maps nav.profile to
    // /intake, so that page is where the panel has to be.
    assert.match(chat, phrase('on your profile page'));
    assert.match(intake, /<GuardianPanel \/>/);
    assert.match(intake, /import \{ GuardianPanel \}/);
  });

  await t.test('and the form reaches the endpoint', () => {
    assert.match(panel, /api\.requestGuardianConsent\(/);
    assert.match(apiClient, /requestGuardianConsent:/);
    assert.match(apiClient, /'\/guardian\/request'/);
    assert.match(apiClient, /getGuardianStatus:/);
  });

  await t.test('the panel renders NOTHING when it does not apply', () => {
    /**
     * Not a disabled section and not an explanation - nothing. An adult has no
     * business seeing a guardian form on their own profile, and a greyed-out
     * one still asks them to work out whether it is about them.
     */
    assert.match(panel, /if \(!state\?\.applicable\) return null;/);
  });

  await t.test('and the server decides whether it applies, not the page', () => {
    // Two implementations of an age band is how somebody sees a form that then
    // refuses them. The copy that decides is the one in the database.
    assert.match(route, /guardianRouter\.get\('\/status'/);
    assert.match(route, /adultGateDecision/);
    assert.ok(
      !/date_of_birth/.test(panel),
      'the panel is recomputing the age band instead of asking the server'
    );
  });

  await t.test('it never asks for the token hash', () => {
    // 0045 does not grant that column, so selecting it fails the whole request
    // rather than omitting the column - the leaderboard lesson from 0039.
    const select = route.slice(route.indexOf("from('guardian_consent_requests')"));
    assert.ok(!/token_hash/.test(select.slice(0, 400)), 'the status route selects token_hash');
  });

  await t.test('the granted state offers no way for the athlete to undo it', () => {
    /**
     * Withdrawal belongs to the guardian, through their own link. A control
     * here would let the person the consent protects remove it - the same
     * reasoning that keeps guardian_consent out of SELF_SERVICE_CONSENT_TYPES.
     */
    const granted = panel.slice(panel.indexOf('state.active ?'), panel.indexOf(') : ('));
    assert.ok(!/withdraw|revoke/i.test(granted), 'the athlete can withdraw their own guardian consent');
  });

  await t.test('every string it renders exists in both catalogues', () => {
    // t() returns the key itself on a miss, so a typo renders as raw dotted
    // text on the page. This caught the block being nested under `auth`.
    const keys = [...panel.matchAll(/t\('([a-z][A-Za-z.]+)'\)/g)].map(([, k]) => k);
    assert.ok(keys.length >= 10, `only found ${keys.length} keys in the panel`);
    for (const key of keys) {
      for (const [lang, cat] of [['en', en], ['es', es]]) {
        const value = key.split('.').reduce((o, part) => (o ?? {})[part], cat);
        assert.equal(typeof value, 'string', `${lang} is missing ${key}`);
      }
    }
  });

  await t.test('and it sits below the sticky header, not inside it', () => {
    // Placed inside <StickyHeader> it renders as part of the pinned chrome,
    // which is where the first attempt put it.
    const closer = intake.indexOf('</StickyHeader>');
    const panelAt = intake.indexOf('<GuardianPanel />');
    assert.ok(closer > 0 && panelAt > closer, 'GuardianPanel is inside the sticky header');
    assert.ok(panelAt < intake.indexOf('<form'), 'GuardianPanel is below the form');
  });
});
