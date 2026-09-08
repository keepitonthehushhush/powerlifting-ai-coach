import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../scripts/set-vercel-env.sh', import.meta.url), 'utf8');

/**
 * Which Vercel variables are created unreadable, and which are left readable.
 *
 * ── WHY THIS TEST EXISTS ──────────────────────────────────────────────────
 *
 * set-vercel-env.sh shipped with SMTP_USER in the readable group, because the
 * split was made on the NAMES: the one called PASSWORD is the secret, the rest
 * is configuration. That is right for most providers and wrong for the one
 * this app uses. Postmark authenticates SMTP with the Server API Token as BOTH
 * the username and the password, so the readable field held the same secret as
 * the hidden one - and an attacker needs the value, not the variable it came
 * from. Marking SMTP_PASSWORD sensitive while SMTP_USER sat in plain sight
 * bought nothing at all.
 *
 * The bug is invisible in every place a person would look: `vercel env ls`
 * shows both variables present, the dashboard shows one Hidden and one not,
 * and mail sends correctly either way. Nothing fails. That is precisely the
 * shape of defect this suite exists to catch, so the grouping is asserted
 * rather than re-reasoned the next time this file is edited.
 *
 * The assertions parse the two lists rather than matching the source text, so
 * that reordering a list or rewording the comment above it does not fail a
 * test that has no opinion about either.
 */

/** The words assigned to one of the script's `NAME="a b c"` list variables. */
function listNamed(name) {
  const match = script.match(new RegExp(`^${name}="([^"]*)"`, 'm'));
  assert.ok(match, `${name} is not assigned in set-vercel-env.sh at all`);
  return match[1].split(/\s+/).filter(Boolean);
}

describe('set-vercel-env.sh variable sensitivity', () => {
  const readable = [...listNamed('BUILD_VARS'), ...listNamed('SMTP_VARS')];
  const sensitive = [...listNamed('SECRET_VARS'), ...listNamed('SMTP_SECRET_VARS')];

  test('SMTP_USER is created sensitive, because it holds the Postmark token', () => {
    assert.ok(
      sensitive.includes('SMTP_USER'),
      'SMTP_USER holds the same Server API Token as SMTP_PASSWORD. Creating it ' +
        'readable publishes the secret and makes the sensitive flag on ' +
        'SMTP_PASSWORD decorative.'
    );
    assert.ok(!readable.includes('SMTP_USER'));
  });

  test('the credentials are sensitive and the routing is not', () => {
    for (const name of ['ANTHROPIC_API_KEY', 'SMTP_PASSWORD']) {
      assert.ok(sensitive.includes(name), `${name} must be created sensitive`);
    }
    // Host, port and From are what make a bad send debuggable without
    // touching the token. Hiding them would cost something and protect
    // nothing: none of the three is a secret.
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM']) {
      assert.ok(readable.includes(name), `${name} is config and should stay readable`);
    }
  });

  test('nothing the browser bundle needs is sensitive', () => {
    // Vercel REFUSES sensitive on production and preview for a variable the
    // build must read back, and a refused create means the variable does not
    // exist. That is how VITE_SUPABASE_URL went missing and the app shipped a
    // black page for three deploys.
    for (const name of sensitive) {
      assert.ok(!name.startsWith('VITE_'), `${name} is compiled into public JavaScript`);
    }
  });

  test('no variable is in both groups', () => {
    const both = sensitive.filter((name) => readable.includes(name));
    assert.deepEqual(both, [], 'a variable in both groups is written twice, last write wins');
  });
});
