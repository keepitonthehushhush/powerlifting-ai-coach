import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readSource, readRaw } from './helpers/source.js';

/**
 * ── WHY THIS FILE CARRIES THE REASONING ───────────────────────────────────
 *
 * vercel.json is strict JSON. It cannot hold a comment, so a policy that took
 * an afternoon to work out would otherwise ship as an unexplained string that
 * the next person loosens the first time something breaks. Every directive
 * below is asserted here WITH the reason it exists, which is the only place in
 * this repository that reason can live.
 *
 * ── WHY THERE IS A POLICY AT ALL ──────────────────────────────────────────
 *
 * "People worry that we may not have checked all the possibilities of making
 * sure their data is safe."
 *
 * The site was serving no security headers whatsoever - checked against the
 * live deployment, not assumed: one `strict-transport-security`, which Vercel
 * adds by itself, and nothing else. No CSP, no nosniff, no referrer policy, no
 * framing rule.
 *
 * For a product holding injuries and medication answers, a Content-Security
 * -Policy is the highest-value control available for free, because it is the
 * one that changes the CONSEQUENCE of a bug rather than the likelihood of one.
 * Every other defense here - RLS, the consent trigger, the deny-by-default
 * grants - assumes our own code runs. CSP is what holds when somebody else's
 * code runs in our page.
 *
 * ── WHY IT CAN BE THIS STRICT ─────────────────────────────────────────────
 *
 * Because the built page has no inline script. That was verified against the
 * deployed HTML rather than inferred: one external module, one external
 * stylesheet, nothing else. So `script-src` needs no 'unsafe-inline' and no
 * 'unsafe-eval', which is the difference between a policy that stops script
 * injection and a policy that decorates it.
 *
 * `style-src` keeps 'unsafe-inline' and that is a deliberate, narrower
 * concession: ErrorBoundary styles its own crash screen with inline style
 * attributes, and the one moment we must not also break the page is the moment
 * the page has already broken. Inline CSS is a far weaker vector than inline
 * script.
 */

const config = JSON.parse(
  readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')
);

const rule = config.headers?.find((entry) => entry.source === '/(.*)');
const headers = Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
const csp = Object.fromEntries(
  (headers['Content-Security-Policy'] ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    })
);

describe('the site sends security headers at all', () => {
  test('THERE IS A HEADER RULE, AND IT COVERS EVERY PATH', () => {
    // The floor. A rule scoped to something that matches nothing would pass
    // every assertion below it, which is the shape this repository keeps
    // shipping.
    assert.ok(rule, 'vercel.json has no headers rule for /(.*)');
    assert.ok(Object.keys(headers).length >= 7, `only ${Object.keys(headers).length} headers configured`);
    assert.ok(Object.keys(csp).length >= 10, `the CSP has only ${Object.keys(csp).length} directives`);
  });

  test('nosniff, because a JSON error body served as HTML is a scripting bug', () => {
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  });

  test('NO REFERRER, WHICH IS A HEALTH-DATA DECISION RATHER THAN A HABIT', () => {
    /*
     * The usual choice is strict-origin-when-cross-origin. This app links out
     * to third-party exercise demonstrations, and a referrer would tell those
     * sites that the visitor came from a powerlifting coaching app that holds
     * medical answers. That is an inference about a person, leaked to somebody
     * with no need for it, for no benefit to us.
     */
    assert.equal(headers['Referrer-Policy'], 'no-referrer');
  });

  test('the page cannot be framed, said twice for old browsers', () => {
    // Clickjacking a consent checkbox is the specific risk: consent that was
    // clicked without being read is not consent.
    assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
    assert.equal(headers['X-Frame-Options'], 'DENY');
  });

  test('and the powerful browser APIs are all switched off', () => {
    // None of them are used. A permission this app never needs is a permission
    // an injected script should not be able to ask for in its name.
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'display-capture']) {
      assert.match(headers['Permissions-Policy'], new RegExp(`${feature}=\\(\\)`));
    }
  });

  test('HSTS is stated rather than left to the platform', () => {
    // Vercel sets it for custom domains, and .app is HSTS-preloaded anyway.
    // Stated because a header this important should not depend on which
    // platform is in front of the app this month.
    assert.match(headers['Strict-Transport-Security'], /max-age=63072000/);
    assert.match(headers['Strict-Transport-Security'], /includeSubDomains/);
  });
});

describe('THE SCRIPT POLICY IS THE ONE THAT MATTERS', () => {
  test('no unsafe-inline and no unsafe-eval, which is the whole point', () => {
    /*
     * A script-src carrying 'unsafe-inline' permits precisely the thing CSP
     * exists to stop, and is how most policies end up decorative. This one can
     * afford to be strict because the built page has no inline script - checked
     * against the deployed HTML.
     */
    assert.ok(csp['script-src'], 'no script-src at all');
    assert.ok(!csp['script-src'].includes("'unsafe-inline'"), "script-src allows 'unsafe-inline'");
    assert.ok(!csp['script-src'].includes("'unsafe-eval'"), "script-src allows 'unsafe-eval'");
    assert.ok(!csp['script-src'].includes('*'), 'script-src allows any origin');
  });

  test('and the source html it is built from has no inline script either', () => {
    // The property the policy depends on, asserted where it can regress: if
    // somebody adds an inline analytics snippet here, this fails before the
    // deploy does.
    const html = readRaw(new URL('../../web/index.html', import.meta.url));
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    assert.deepEqual(inline, [], 'an inline script would be blocked by our own CSP');
  });

  test('nothing can be injected as a base tag or an object', () => {
    // base-uri hijacking rewrites every relative script URL in the document;
    // object-src is the legacy plugin vector. Both are cheap to close.
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    assert.deepEqual(csp['object-src'], ["'none'"]);
  });

  test('form submissions cannot be redirected off-site', () => {
    // The app has five forms, two of which take a password.
    assert.deepEqual(csp['form-action'], ["'self'"]);
  });
});

/**
 * ── THE HALF THAT KEEPS THE POLICY TRUE ───────────────────────────────────
 *
 * A CSP written once is correct once. The failure mode is a later feature that
 * calls a new host, works fine in development where no policy is enforced, and
 * is blocked in production - or worse, is fixed by widening the policy without
 * anybody deciding to.
 *
 * So the origins are read out of the source rather than listed here. Every
 * external https origin the web app mentions must be either in the CSP or
 * declared below as something we only ever LINK to, with a reason.
 */
const LINK_OUT_ONLY = {
  'https://www.youtube.com':
    'Exercise demonstrations are linked, never embedded - the standing rule about copyrighted video, and a privacy decision on top of it.',
  'https://link.springer.com':
    'A citation in the FAQ. A link to a paper, not a resource this app loads.',
  'https://placeholder.invalid':
    'A sentinel used when Supabase is unconfigured, so the client constructor does not throw. It is deliberately not a real host.',
};

function webSources() {
  const walk = (dir, acc = []) => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) walk(path, acc);
      else if (/\.(js|jsx)$/.test(name)) acc.push(path);
    }
    return acc;
  };
  return walk(new URL('../../web/src', import.meta.url).pathname);
}

describe('the policy and the code cannot drift apart', () => {
  const found = new Map();
  for (const path of webSources()) {
    const source = readSource(new URL(`file://${path}`));
    for (const match of source.matchAll(/https:\/\/[a-zA-Z0-9.*_-]+/g)) {
      if (!found.has(match[0])) found.set(match[0], new Set());
      found.get(match[0]).add(path.split('/web/src/')[1]);
    }
  }

  test('the scan found something, so it is capable of finding something', () => {
    assert.ok(found.size >= 4, `only ${found.size} origins found - the scanner is broken`);
    assert.ok(found.has('https://challenges.cloudflare.com'), 'the Turnstile origin is missing from the scan');
  });

  test('EVERY ORIGIN THE APP MENTIONS IS EITHER ALLOWED OR DECLARED A LINK', () => {
    const allowed = new Set(Object.values(csp).flat());
    const undeclared = [...found.keys()].filter(
      (origin) => !allowed.has(origin) && !(origin in LINK_OUT_ONLY)
    );
    assert.deepEqual(
      undeclared,
      [],
      `these origins are in the code and in neither the CSP nor the link-out list: ${undeclared
        .map((o) => `${o} (${[...found.get(o)].join(', ')})`)
        .join('; ')}`
    );
  });

  test('and a link-out host is never actually fetched or loaded as a script', () => {
    /*
     * The half that stops the declaration being a loophole. Calling something a
     * "link" and then fetching it would pass the check above and be blocked in
     * production, which is the confusing failure this is meant to prevent.
     */
    for (const path of webSources()) {
      const source = readSource(new URL(`file://${path}`));
      for (const origin of Object.keys(LINK_OUT_ONLY)) {
        const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.doesNotMatch(
          source,
          new RegExp(`fetch\\(\\s*['"\`]${escaped}`),
          `${path} fetches ${origin}, which is declared link-out only`
        );
        assert.doesNotMatch(
          source,
          new RegExp(`src\\s*=\\s*['"\`]${escaped}`),
          `${path} loads ${origin} as a resource, which is declared link-out only`
        );
      }
    }
  });

  test('SUPABASE IS A WILDCARD ON PURPOSE, NOT BY LAZINESS', () => {
    /*
     * The project URL is a build-time variable, so it never appears literally
     * in the source for the scan above to find - and previews point at a
     * DIFFERENT project than production by design (ADR-17). A pinned origin
     * would make every preview deployment fail to reach its own database,
     * which is the environment that exists to catch problems before production.
     *
     * The wildcard is still bounded to supabase.co, and which project a
     * deployment may talk to is enforced separately and one-directionally by
     * assertPreviewIsolation.
     */
    assert.ok(csp['connect-src'].includes('https://*.supabase.co'));
    assert.ok(csp['connect-src'].includes("'self'"));
    assert.ok(!csp['connect-src'].includes('*'), 'connect-src allows any origin');
  });

  test('the breached-password check is allowed, because it is ours to keep', () => {
    /*
     * Supabase sells leaked-password protection on a paid plan. This app does
     * the same job on the free one, client-side, using the k-anonymity range
     * API - only the first five characters of the hash ever leave the browser,
     * so the password is never sent anywhere, not even to us. It runs on both
     * sign-up and password reset.
     *
     * It is in the CSP because it is a real outbound request, and it is worth
     * naming here so nobody removes it as an unexplained third party.
     */
    assert.ok(csp['connect-src'].includes('https://api.pwnedpasswords.com'));
  });
});
