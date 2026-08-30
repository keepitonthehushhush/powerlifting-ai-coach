#!/usr/bin/env node
/**
 * Verify the deployed site, not the local build.
 *
 * WHY THIS EXISTS. `npm run verify:bundle` scans web/dist and passed on every
 * run while production served a black page. Both statements were true at once:
 * the build on this machine was correct, and the build Vercel produced was
 * not, because VITE_SUPABASE_URL had never been created: Vercel refuses a
 * public framework prefix combined with sensitive visibility, and every
 * attempt to add it was rejected. Vite therefore inlined `undefined`, the
 * Supabase client threw before React mounted, and the page rendered as an
 * empty body.
 *
 * The lesson is narrow and worth keeping: a local artifact is not evidence
 * about a remote one. This script asks the only question that matters after a
 * deploy - what is the public actually downloading? - and answers it by
 * downloading it.
 *
 * Two assertions, and they pull in opposite directions on purpose:
 *
 *   NEGATIVE  no server-side secret appears in any shipped asset.
 *   POSITIVE  the public configuration that is SUPPOSED to be there is there.
 *
 * A build with the environment missing passes the negative check trivially -
 * that is exactly the state that shipped the black page. Checking only for
 * secrets would have called that deploy healthy.
 *
 * Usage:  node scripts/verify-deployment.mjs [url]
 *         DEPLOY_URL=https://... npm run verify:deployment
 *
 * Exit codes: 0 pass, 1 finding, 2 could not check.
 */
import { findSecrets } from './lib/secretPatterns.mjs';
import { resolveMaxTokens, describeBudgetAgreement } from '../server/src/lib/modelBudget.js';

const target = process.argv[2] || process.env.DEPLOY_URL;

if (!target) {
  console.error('Usage: node scripts/verify-deployment.mjs <url>   (or set DEPLOY_URL)');
  process.exit(2);
}

const base = new URL(target);

/**
 * Configuration that MUST be inlined for the app to boot.
 *
 * Matched by shape rather than by literal value so this script needs no
 * secrets, no .env, and no coupling to a particular project - which means CI
 * can run it against a preview URL without being trusted with anything.
 */
const REQUIRED_CONFIG = [
  { name: 'VITE_SUPABASE_URL', re: /https:\/\/[a-z0-9]{16,}\.supabase\.co/ },
  { name: 'VITE_SUPABASE_PUBLISHABLE_KEY', re: /sb_publishable_[A-Za-z0-9_-]{16,}/ },
];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

let html;
try {
  html = await get(base.href);
} catch (err) {
  console.error(`Could not fetch ${base.href}: ${err.message}`);
  process.exit(2);
}

// Asset URLs are read out of the served HTML rather than guessed from
// web/dist, so this reflects what the host built - content hash included.
const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

if (assetPaths.length === 0) {
  console.error('No /assets/ references in the served HTML. Nothing to verify - is this the app?');
  process.exit(2);
}

const documents = [{ path: '/', body: html }];
for (const path of assetPaths) {
  try {
    documents.push({ path, body: await get(new URL(path, base).href) });
  } catch (err) {
    console.error(`Could not fetch asset ${path}: ${err.message}`);
    process.exit(2);
  }
}

const scripts = documents.filter((d) => d.path.endsWith('.js'));
const leaks = documents.flatMap((d) => findSecrets(d.body).map((what) => ({ path: d.path, what })));

// Any script may carry the config; Vite's chunking is not ours to predict.
const allScript = scripts.map((d) => d.body).join('\n');
const missing = REQUIRED_CONFIG.filter(({ re }) => !re.test(allScript)).map(({ name }) => name);

console.log(`Checked ${documents.length} documents from ${base.origin}:`);
for (const d of documents) console.log(`  ${d.path}  ${d.body.length.toLocaleString()} bytes`);

let failed = false;

if (leaks.length) {
  failed = true;
  console.error('\nFAIL - server-side secrets are being served to browsers:');
  for (const l of leaks) console.error(`  ${l.path}: ${l.what}`);
  console.error('Rotate the credential first, then fix the build. It is public until rotated.');
} else {
  console.log('\nPASS - no server-side secrets in any served asset.');
}

if (missing.length) {
  failed = true;
  console.error(`\nFAIL - required public configuration was not compiled in: ${missing.join(', ')}`);
  console.error(
    'The build ran without these set. On Vercel the usual cause is that the variable was\n' +
      'never created: a public framework prefix (VITE_) combined with sensitive visibility\n' +
      'is rejected on Production and Preview, and a rejected create is easy to miss.\n' +
      'See docs/DEPLOYMENT.md. Setting the variable is also not enough on its own -\n' +
      'build-time values are read once, so an existing deployment must be rebuilt.'
  );
} else {
  console.log('PASS - required public configuration is present in the served JavaScript.');
}

/**
 * ── THE SIGN-UP PROBE ───────────────────────────────────────────────────────
 *
 * On 2026-08-29 a real person could not create an account. CAPTCHA protection
 * had been switched on in the Supabase dashboard while the deployed bundle
 * carried no VITE_TURNSTILE_SITE_KEY, so the browser sent no token and every
 * attempt came back 400 captcha_failed. Nothing in the build was wrong; nothing
 * in the dashboard was wrong; the two disagreed, and no check could see it
 * because each half only ever looked at itself.
 *
 * Checking that the site key is in the bundle would not have caught it either -
 * the key is OPTIONAL by design, and a build without one is correct whenever
 * CAPTCHA is off. The thing that is never correct is the DISAGREEMENT.
 *
 * So this asks the actual question, end to end: does the server demand a token
 * the deployed client cannot produce?
 *
 * ── WHY SIGN-IN AND NOT SIGN-UP ─────────────────────────────────────────────
 *
 * A sign-up probe that succeeded would create a real account, and a check with
 * a side effect is a check somebody eventually disables. Sign-in with junk
 * credentials creates nothing and distinguishes the two states exactly, because
 * Supabase evaluates CAPTCHA before credentials:
 *
 *     captcha required, no token   -> 400 captcha_failed
 *     captcha not required         -> 400 invalid_credentials
 *
 * Both were observed in the production logs during the incident, which is what
 * makes this probe trustworthy rather than assumed.
 *
 * It needs no secrets: the URL and the publishable key are read out of the
 * bundle that was just downloaded, which is the point - this can run against a
 * preview URL from CI without being trusted with anything.
 */
const TURNSTILE_SITE_KEY = /0x4[A-Za-z0-9_-]{20,}/;

const supabaseUrl = allScript.match(/https:\/\/[a-z0-9]{16,}\.supabase\.co/)?.[0];
const publishableKey = allScript.match(/sb_publishable_[A-Za-z0-9_-]{16,}/)?.[0];
const bundleHasSiteKey = TURNSTILE_SITE_KEY.test(allScript);

if (supabaseUrl && publishableKey) {
  /**
   * ── THE FALSE PASS THIS ALMOST SHIPPED WITH ───────────────────────────────
   *
   * The first version of this probe was `serverWantsCaptcha = /captcha/i.test(
   * body)`, and the first time it ran the sandbox returned:
   *
   *     403  "Host not in allowlist: <project>.supabase.co"
   *
   * No "captcha" in that string, so the probe concluded CAPTCHA was not
   * required and printed a PASS. A check written to catch "nobody can sign up"
   * would have reported everything fine while talking to a proxy instead of to
   * Supabase.
   *
   * That is the same defect as every other one this repository has found the
   * hard way: the check ran, produced a green result, and had not looked at the
   * thing it was named for.
   *
   * So the answer is now THREE-valued, and only a response that is recognizably
   * GoTrue's counts as an answer at all. Anything else - a proxy, a 404, a
   * captive portal, an HTML error page - is `null`, which is reported and never
   * treated as a pass.
   */
  let serverWantsCaptcha = null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publishableKey },
      // An address that cannot exist, and a password that could not be right.
      body: JSON.stringify({
        email: 'deployment-probe@verify.invalid',
        password: 'not-a-real-password-and-never-will-be',
      }),
    });
    const body = await res.text();

    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON: not GoTrue */ }

    // GoTrue always answers a rejected grant with error_code or msg. Requiring
    // one of those is what separates "Supabase said no" from "something else
    // answered".
    const isAuthResponse =
      parsed !== null && typeof parsed === 'object' &&
      (typeof parsed.error_code === 'string' || typeof parsed.msg === 'string'
        || typeof parsed.error === 'string');

    if (!isAuthResponse) {
      console.error(
        `\nCould not reach Supabase Auth - HTTP ${res.status}, and the body was not an auth ` +
        `response:\n  ${body.slice(0, 200)}\n` +
        'Something between here and Supabase answered instead. The sign-up check did NOT run.'
      );
    } else {
      serverWantsCaptcha = /captcha/i.test(`${parsed.error_code ?? ''} ${parsed.msg ?? ''} ${parsed.error ?? ''}`);
    }
  } catch (err) {
    console.error(`\nCould not probe the auth endpoint: ${err.message}`);
    console.error('The sign-up check did NOT run. This is not a pass.');
  }

  if (serverWantsCaptcha === true && !bundleHasSiteKey) {
    failed = true;
    console.error('\nFAIL - NOBODY CAN CREATE AN ACCOUNT.');
    console.error(
      'Supabase is enforcing CAPTCHA on sign-in and sign-up, and the deployed bundle\n' +
        'carries no Turnstile site key - so the browser sends no token and every attempt\n' +
        'is refused with "captcha protection: request disallowed (no captcha_token found)".\n' +
        '\n' +
        'This is the 2026-08-29 incident. Fix it in this order, which is the only one\n' +
        'that never locks anybody out:\n' +
        '  1. Set VITE_TURNSTILE_SITE_KEY in the host and REBUILD - build-time values are\n' +
        '     read once, so setting it without a rebuild changes nothing.\n' +
        '  2. Re-run this check and confirm it passes.\n' +
        '  3. Only then leave CAPTCHA enabled in Supabase.\n' +
        '\n' +
        'To unblock sign-ups immediately instead, turn CAPTCHA off in Supabase\n' +
        '(Authentication > Attack Protection). The site key is public; the SECRET key\n' +
        'belongs only in the Supabase dashboard and must never enter the repository.'
    );
  } else if (serverWantsCaptcha === true) {
    console.log('PASS - Supabase requires CAPTCHA and the bundle carries a site key.');
  } else if (serverWantsCaptcha === false) {
    console.log(
      bundleHasSiteKey
        ? 'PASS - the bundle carries a site key; Supabase is not enforcing CAPTCHA yet (safe order).'
        : 'PASS - CAPTCHA is off on both sides.'
    );
  }
} else {
  console.error('\nCould not read the Supabase URL or key from the bundle; sign-up probe skipped.');
}

/*
 * ── THE OUTPUT BUDGET THE DEPLOYED COACH ACTUALLY HAS ─────────────────────
 *
 * The safety evaluation grades the coach at whatever ANTHROPIC_MAX_TOKENS says
 * on the machine running it. Production reads the same variable from the
 * Vercel project. Nothing compared the two, so a green suite proved nothing
 * about the deployed coach - the same defect that had the eval running at 2048
 * against a production default of 8192 until 2026-08-30, wearing a different
 * hat.
 *
 * Three-valued on purpose. An unreachable endpoint, a non-JSON body, or a
 * deployment too old to publish the field are all "could not determine", and
 * none of them may print a PASS. The whole reason this file exists is that a
 * check which reports the reassuring answer when it could not look is worse
 * than no check.
 */
const localMaxTokens = resolveMaxTokens(process.env);

let health = null;
let healthProblem = null;
try {
  health = JSON.parse(await get(new URL('/api/health', base)));
} catch (error) {
  healthProblem = error.message;
}

// The verdict is computed by a pure function so its unhappy paths can be
// exercised without a network - see server/test/modelBudget.test.js.
const budget = describeBudgetAgreement({ local: localMaxTokens, health, healthProblem });

console.log('');
if (budget.verdict === 'unknown') {
  console.error(
    `COULD NOT DETERMINE - the deployed output budget is unknown (${budget.reason}).\n` +
      `      A passing safety evaluation therefore says nothing about the coach that is\n` +
      `      actually serving athletes. If this deployment predates the maxOutputTokens\n` +
      `      field on /api/health, deploy current main and run this again.`
  );
} else if (budget.verdict === 'differ') {
  failed = true;
  console.error(
    `FAIL - the safety evaluation and production disagree about reply length.\n` +
      `      here:       ${budget.local} output tokens (ANTHROPIC_MAX_TOKENS)\n` +
      `      production: ${budget.remote}\n` +
      `      A suite run here grades a coach that is not the deployed one. Lower here\n` +
      `      manufactures truncation failures; higher here hides real ones. Set them equal.`
  );
} else {
  console.log(`PASS - production and this machine agree on ${budget.local} output tokens.`);
}

process.exit(failed ? 1 : 0);
