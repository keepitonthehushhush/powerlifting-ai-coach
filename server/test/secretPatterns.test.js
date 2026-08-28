import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECRET_PATTERNS, findSecrets } from '../../scripts/lib/secretPatterns.mjs';

/**
 * The deploy gate had no test.
 *
 * `verify:bundle` is described in CI as the thing that must block a merge,
 * because a secret in the browser bundle is readable by every visitor. It has
 * been running on every push for months and nobody had ever confirmed that its
 * patterns match a secret. A scanner that finds nothing and a scanner that
 * cannot find anything produce identical output, which is the shape of defect
 * this project keeps meeting.
 *
 * It surfaced through the linter, of all things: `no-useless-escape` flagged
 * `[A-Za-z0-9_\-]`, the hyphen at the end of a character class already being
 * literal. Removing a backslash from a security-critical regex is exactly the
 * change nobody should make on reasoning alone - so the test that should have
 * existed anyway got written first, and then the backslash came out.
 *
 * ── THE KEYS BELOW ARE NOT KEYS ─────────────────────────────────────────────
 *
 * Every string here is invented to have the right SHAPE and nothing else.
 * There is no way to write this test without something that looks like a
 * credential; the mitigation is that these are structurally valid and
 * cryptographically meaningless, and that the file says so.
 */

/**
 * Shape-valid, value-meaningless - and ASSEMBLED AT RUNTIME.
 *
 * The prefixes are split across concatenations on purpose. `sk-ant-api03-` is
 * on GitHub's partner secret-scanning list, and push protection blocks a push
 * containing one whether or not the key is real. A test fixture that cannot be
 * pushed is not a test. Splitting the literal costs nothing: the strings the
 * assertions run against are identical, and the file is honest about why it
 * looks like this.
 */
const FAKES = {
  'Anthropic API key': `sk-${'ant'}-api03-AAAAbbbbCCCCddddEEEEffffGGGGhhhh_-11223344`,
  'Supabase service role JWT': `{"iss":"supabase","${'role'}":"service_role","exp":1}`,
  'Supabase secret key': `sb_${'secret'}_AAAAbbbbCCCCdddd_-11`,
  'Generic private key block': `-----BEGIN RSA ${'PRIVATE'} KEY-----\nnot a key\n`,
};

/**
 * Text a real bundle contains that must NOT trip the scanner.
 *
 * A false positive here is not a harmless nuisance: it fails the deploy gate
 * on a clean build, and a gate that cries wolf is a gate somebody switches
 * off. The publishable key is the important one - it is public by design, it
 * is compiled into every build, and its prefix is one character from the
 * secret key's.
 */
const INNOCENT = [
  `sb_${'publishable'}_AAAAbbbbCCCCddddEEEEffff`,
  'const role = "service_role_docs_link";',
  'https://example.supabase.co/rest/v1/',
  'sk-ant-',
  'BEGIN PRIVATE KEY',
  'Anthropic',
  'the service role key lives server-side only',
];

describe('the bundle scanner can actually find a secret', () => {
  test('the pattern list is not empty', () => {
    // A parser that finds nothing passes every assertion below it.
    assert.ok(SECRET_PATTERNS.length >= 4, `expected the full list, found ${SECRET_PATTERNS.length}`);
  });

  test('EVERY PATTERN MATCHES SOMETHING OF ITS OWN SHAPE', () => {
    // Named individually so a broken pattern says which one, rather than
    // "expected true to be false".
    const blind = SECRET_PATTERNS.filter(({ name, re }) => {
      const fake = FAKES[name];
      assert.ok(fake, `no fixture for pattern "${name}" - add one when adding a pattern`);
      return !re.test(fake);
    }).map(({ name }) => name);

    assert.deepEqual(blind, [], 'these patterns would not notice the thing they exist to catch');
  });

  test('and findSecrets names them', () => {
    const contents = Object.values(FAKES).join('\n');
    assert.deepEqual(findSecrets(contents).sort(), Object.keys(FAKES).sort());
  });

  test('a clean bundle scans clean', () => {
    assert.deepEqual(findSecrets(INNOCENT.join('\n')), []);
  });

  test('THE PUBLISHABLE KEY IS NOT MISTAKEN FOR THE SECRET ONE', () => {
    // sb_publishable_ and sb_secret_ differ by a prefix, and the publishable
    // one is compiled into every build on purpose. Confusing them would fail
    // the deploy gate on a correct bundle, every time.
    assert.deepEqual(findSecrets(`VITE_SUPABASE_PUBLISHABLE_KEY="sb_${'publishable'}_AAAAbbbbCCCCddddEEEEffff"`), []);
  });

  test('a key with a hyphen in it is still caught', () => {
    // The direct assertion for the escape that `no-useless-escape` removed:
    // `[A-Za-z0-9_\\-]` and `[A-Za-z0-9_-]` are the same class, and this is
    // what proves it rather than asserting it.
    assert.deepEqual(findSecrets(`sk-${'ant'}-api03-aaaa-bbbb-cccc-dddd-eeee-ffff`), ['Anthropic API key']);
    assert.deepEqual(findSecrets(`sb_${'secret'}_aaaa-bbbb-cccc`), ['Supabase secret key']);
  });

  test('one list, shared by both scanners', () => {
    // Local build and deployed artefact are different questions and must be
    // judged against one list, or "passes locally" and "passes in production"
    // stop meaning the same thing.
    for (const scanner of ['scan-bundle-for-secrets.mjs', 'verify-deployment.mjs']) {
      const source = readScanner(scanner);
      assert.match(source, /secretPatterns\.mjs/, `${scanner} does not use the shared list`);
      assert.doesNotMatch(source, /SECRET_PATTERNS\s*=/, `${scanner} declares its own patterns`);
    }
  });
});

function readScanner(name) {
  return readFileSync(new URL(`../../scripts/${name}`, import.meta.url), 'utf8');
}
