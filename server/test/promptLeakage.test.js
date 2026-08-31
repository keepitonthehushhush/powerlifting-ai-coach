import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';

/**
 * Nothing an attacker wants may be in the prompt in the first place.
 *
 * ── WHY THIS IS THE RIGHT PLACE TO STOP IT ────────────────────────────────
 *
 * The safety evaluation already asks the coach to hand over its instructions
 * and checks that the reply contains no key-shaped string. That is a good
 * check and it is the second line, not the first: it grades what the model
 * CHOSE to say, it costs an API call, and it can only ever sample a few of
 * the infinite ways somebody might ask.
 *
 * The first line is that the secret is not in the room. A prompt containing
 * no credential cannot leak one however cleverly it is asked, and a prompt
 * containing no table names cannot be socially engineered into naming them.
 * This runs in milliseconds, on every commit, against the real assembled
 * prompt rather than a description of it.
 *
 * ── WHAT COUNTS AS SENSITIVE HERE ─────────────────────────────────────────
 *
 * Not just credentials. An attacker's first move against an unfamiliar app is
 * to learn what it is built on, because that turns a blind probe into a
 * targeted one. The prompt has no reason to name a database vendor, a host, a
 * table, a file path or an environment variable - so none of them may appear,
 * and the check does not have to decide which of them would be dangerous.
 */

/** Built with a realistic profile: the risk grows with what gets interpolated. */
const PROMPTS = {
  empty: buildSystemPrompt({}),
  populated: buildSystemPrompt({
    profile: {
      experience_level: 'currently_training',
      current_squat: 315,
      current_bench: 225,
      current_deadlift: 405,
      bodyweight: 200,
      health_restrictions: 'left shoulder impingement',
      equipment_available: 'full gym',
      days_per_week: 4,
      goal: 'meet_prep',
      display_name: 'testlifter',
    },
  }),
};

const FORBIDDEN = {
  'an Anthropic API key': /sk-ant-[A-Za-z0-9_-]{8,}/,
  'a Supabase secret or JWT': /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}\./,
  'a generic long secret assignment': /(secret|token|password|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}/i,
  'the name of a database or hosting vendor': /\b(supabase|vercel|postgres|postgresql|cloudflare|stripe)\b/i,
  'an internal table name': /\b(user_profile|workout_programs|workout_sessions|progress_logs|leaderboard_entries|usage_events|consent_records|audit_events|error_events|user_preferences)\b/,
  'a source path': /\b(server\/src|web\/src|scripts\/lib|supabase\/migrations)\b/,
  'an environment variable name': /\b(ANTHROPIC_API_KEY|SUPABASE_URL|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|TURNSTILE_SECRET|STRIPE_SECRET|VITE_[A-Z_]+)\b/,
  'a database connection string': /postgres(ql)?:\/\/|\bpsql\b/i,
};

describe('the system prompt carries nothing worth stealing', () => {
  for (const [shape, name] of [['empty', 'an empty profile'], ['populated', 'a fully populated profile']]) {
    for (const [label, pattern] of Object.entries(FORBIDDEN)) {
      test(`${name}: contains no ${label}`, () => {
        const match = PROMPTS[shape].match(pattern);
        assert.equal(
          match,
          null,
          `the prompt contains ${label}: ${JSON.stringify(match?.[0])}. It cannot leak what it does not hold - take it out rather than instructing the model to keep it quiet.`,
        );
      });
    }
  }

  test('the patterns are real, or every assertion above is vacuous', () => {
    /*
     * The guard on the guard, and it has earned its place in this repo: a
     * regex that silently matches nothing turns nine passing tests into nine
     * confident answers produced without looking.
     */
    const samples = {
      'an Anthropic API key': 'key sk-ant-api03-AbCdEfGhIj',
      'a Supabase secret or JWT': 'token eyJhbGciOiJIUzI1NiIsInR5cCI6.abc',
      'a generic long secret assignment': 'api_key: "abcdefghijklmnop123"',
      'the name of a database or hosting vendor': 'we run on Supabase',
      'an internal table name': 'select * from user_profile',
      'a source path': 'see server/src/app.js',
      'an environment variable name': 'set ANTHROPIC_API_KEY first',
      'a database connection string': 'postgres://user:pw@host/db',
    };
    for (const [label, pattern] of Object.entries(FORBIDDEN)) {
      assert.match(samples[label], pattern, `the pattern for ${label} matches nothing`);
    }
  });
});

describe('what the prompt SHOULD carry, so absence is not mistaken for safety', () => {
  test('the support address is present, because refusing to help is its own failure', () => {
    // A prompt scrubbed until it says nothing useful would pass every
    // assertion above. On 2026-08-30 the coach told an athlete to look for a
    // contact on "the app store listing" - there is no app store listing -
    // because it had no address to give. Silence is not security.
    assert.match(PROMPTS.empty, /privacy@coachdiaz\.app/);
  });

  test('the athlete\'s own data reaches the prompt, which is the whole point', () => {
    assert.match(PROMPTS.populated, /315/);
    assert.match(PROMPTS.populated, /shoulder impingement/i);
  });

  test('and it is fenced as data rather than instruction', () => {
    // The athlete's own text is the one untrusted string in the prompt.
    assert.match(PROMPTS.populated, /never instruction to you/i);
  });
});
