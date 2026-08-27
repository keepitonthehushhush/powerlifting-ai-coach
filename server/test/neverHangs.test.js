import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * THE OUTAGE OF 2026-08-27, AND THE FOUR THINGS UNDER IT.
 *
 * Reported as "I can't message Coach, it's frozen in a loading state". One
 * symptom, and pulling on it found four separate defects - three of which had
 * been live for a day or more without anything failing:
 *
 *   1. consume_rate_limit had lost SECURITY DEFINER, so every rate limit check
 *      raised 42501 and the limiter - the only brute-force and API-spend
 *      protection this product has - was failing open on every request.
 *   2. The program save and the usage row were fired without being awaited. A
 *      serverless function freezes when it responds, so those writes died
 *      mid-socket. usage_events had never received a row.
 *   3. Express served ETagged responses, a repeat GET /api/consent came back
 *      304, and the client treated every non-2xx as a failure.
 *   4. Nothing in the client had a timeout, so a request that never settled
 *      left a `finally` that never ran and a spinner with no way out.
 *
 * The common thread is worth naming: each was a failure that produced no
 * failure. A log line nobody was reading, a promise nobody awaited, a status
 * code nobody had considered, and a promise that simply never resolved.
 */

const api = readSource(new URL('../../web/src/lib/api.js', import.meta.url));
const apiRaw = readRaw(new URL('../../web/src/lib/api.js', import.meta.url));
const app = readSource(new URL('../src/app.js', import.meta.url));
const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
const migration = readRaw(
  new URL('../../supabase/migrations/0022_rate_limiter_was_never_enforcing.sql', import.meta.url)
);
/**
 * Raw, not stripped. The two assertions below are ABOUT the reasoning written
 * into that middleware - that failing open is deliberate - and reasoning lives
 * in comments. Sixth time this suite has tripped on it; see helpers/source.js.
 */
const rateLimitMw = readRaw(new URL('../src/middleware/rateLimit.js', import.meta.url));

describe('the rate limiter actually limits', () => {
  test('THE FUNCTION IS SECURITY DEFINER, WHICH IS THE WHOLE MECHANISM', () => {
    // Counters live in the private schema precisely so `authenticated` cannot
    // reach them. A SECURITY INVOKER function therefore cannot work at all -
    // it runs as the caller, and the caller is the role that was revoked.
    assert.match(migration, /security definer/);
    assert.match(migration, /set search_path = ''/);
    assert.match(migration, /insert into private\.rate_limit_counters/);
  });

  test('the grants are restated rather than assumed to survive a replace', () => {
    assert.match(migration, /revoke all on function public\.consume_rate_limit\(text\) from public, anon/);
    assert.match(migration, /grant execute on function public\.consume_rate_limit\(text\) to authenticated/);
  });

  test('it still cannot be pointed at somebody else, or asked for a bigger quota', () => {
    // What makes definer rights safe here: no user id parameter, and the
    // quotas are constants in the body rather than arguments.
    assert.doesNotMatch(migration, /p_user|p_limit|p_quota/);
    assert.match(migration, /v_user uuid := auth\.uid\(\)/);
    assert.match(migration, /raise exception 'authentication required'/);
  });

  test('failing open is still the behaviour, and still deliberate', () => {
    // Not changed, and worth pinning: refusing every request when the counter
    // breaks turns a counter problem into a total outage. The lesson from this
    // incident is not "fail closed", it is that a silent fail-open needs
    // something louder than a log line.
    assert.match(rateLimitMw, phrase('Fails OPEN on infrastructure error'));
    assert.match(rateLimitMw, /logger\.error\('ratelimit\.check_failed'/);
  });
});

describe('writes that happen after the response do not happen', () => {
  test('the program save is awaited', () => {
    const block = chat.slice(chat.indexOf('if (storable)'));
    assert.match(block.slice(0, 900), /await req\.supabase/);
  });

  test('the usage row is awaited', () => {
    const block = chat.slice(chat.indexOf("from('usage_events')") - 300);
    assert.match(block.slice(0, 400), /await req\.supabase/);
  });

  test('BOTH ARE SWALLOWED, SO THE AWAIT CANNOT COST SOMEBODY THEIR REPLY', () => {
    // The property the fire-and-forget was protecting is real and is kept.
    // It is now carried by try/catch instead of by the absence of an await,
    // which is the version that also actually writes the row.
    const block = chat.slice(chat.indexOf('if (storable)'), chat.indexOf('res.json('));
    assert.equal((block.match(/catch \(err\)/g) ?? []).length, 2);
    assert.match(block, /usage\.record_failed/);
    assert.match(block, /program\.save_failed/);
  });

  test('neither write is between the reply and the athlete seeing it fail', () => {
    // They come after the conversation itself is saved. A metrics row must
    // never be the reason a stored reply is lost.
    assert.ok(chat.indexOf('.eq(\'id\', conversation.id)') < chat.indexOf("from('usage_events')"));
  });
});

describe('the API says do not store any of this', () => {
  test('no-store on every API response', () => {
    // Several of these carry consumer health data. A response sitting in a
    // browser disk cache is that data at rest somewhere nobody reasoned about.
    assert.match(app, /res\.set\('Cache-Control', 'no-store/);
    assert.match(app, /app\.use\('\/api', \(_req, res, next\)/);
  });

  test('ETags are off, which removes the 304 path rather than handling it', () => {
    assert.match(app, /app\.disable\('etag'\)/);
  });

  test('and the client no longer treats a 304 as a failure anyway', () => {
    assert.match(api, /if \(response\.status === 304\) return null/);
  });
});

describe('nothing in the client can hang forever', () => {
  test('every request is bounded by an AbortController', () => {
    assert.match(api, /new AbortController\(\)/);
    assert.match(api, /signal: controller\.signal/);
    assert.match(api, /clearTimeout\(timer\)/);
  });

  test('THE CHAT TIMEOUT IS LONG, BECAUSE A REPLY LEGITIMATELY IS', () => {
    // Production has logged a 77-second reply. A timeout tuned to a normal
    // API would cut off the product's main feature - a worse bug than the one
    // being fixed here.
    const match = api.match(/chat: (\d[\d_]*)/);
    assert.ok(match, 'no chat timeout is declared');
    assert.ok(Number(match[1].replace(/_/g, '')) >= 120_000, 'the chat timeout is too short for a real reply');
    assert.match(apiRaw, phrase('77 seconds'));
  });

  test('reading the session token is bounded too', () => {
    // getSession() can block behind a token refresh that is itself stuck, and
    // it sits in front of every single request.
    assert.match(api, /Promise\.race\(\[/);
    assert.match(api, /supabase\.auth\.getSession\(\)/);
    assert.match(api, /session: \d/);
  });

  test('a timeout becomes an error a person can read, not a silence', () => {
    assert.match(api, /AbortError/);
    assert.match(api, phrase('That took too long and was stopped'));
    assert.match(api, phrase('Could not reach the server'));
  });

  test('a failure to read the token does not become a hang', () => {
    // No token means the request goes out unauthenticated and comes back 401,
    // which is a state every screen already knows how to show.
    const block = api.slice(api.indexOf('async function accessToken'), api.indexOf('async function request'));
    assert.match(block, /return null/);
    assert.match(block, /catch \{/);
  });
});

describe('the sign-in screen offers three things, not one sentence', () => {
  const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
  const css = readSource(new URL('../../web/src/styles.css', import.meta.url));

  test('each alternative is its own block', () => {
    // They were two bare <button className="link"> siblings in a plain block
    // card. Buttons are inline-block, so they landed on one line and read as
    // "Forgot your password? New here? Create an account" - three choices
    // presented as one run of text.
    assert.match(login, /<div className="auth-alternatives">/);
    assert.equal((login.match(/<div className="auth-alternative">/g) ?? []).length, 2);
  });

  test('the container stacks them and rules them off from each other', () => {
    const rule = css.slice(css.indexOf('.auth-alternatives {'), css.indexOf('.auth-alternative {'));
    assert.match(rule, /flex-direction: column/);
    assert.match(rule, /border-top/);
    assert.match(css, /\.auth-alternative \+ \.auth-alternative \{[\s\S]{0,120}border-top/);
  });

  test('each is a question above an answer', () => {
    for (const key of ['auth.forgotPrompt', 'auth.newHerePrompt', 'auth.haveAccountPrompt']) {
      assert.ok(login.includes(`t('${key}')`), `${key} is not used`);
    }
    assert.match(login, /t\('auth\.reset\.forgotAction'\)/);
  });

  test('the new strings exist in both languages', () => {
    for (const file of ['en.js', 'es.js']) {
      const catalogue = readRaw(new URL(`../../web/src/i18n/locales/${file}`, import.meta.url));
      for (const key of ['forgotPrompt', 'newHerePrompt', 'haveAccountPrompt', 'forgotAction']) {
        assert.match(catalogue, new RegExp(`\\b${key}:`), `${file} is missing ${key}`);
      }
    }
  });

  test('the links are a thumb tall', () => {
    assert.match(css, /\.auth-alternative \.link \{[\s\S]{0,140}min-height: 44px/);
  });
});
