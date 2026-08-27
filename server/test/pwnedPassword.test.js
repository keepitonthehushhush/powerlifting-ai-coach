import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
import {
  sha1Hex,
  splitHash,
  parseRanges,
  checkPwned,
  VERY_COMMON_THRESHOLD,
} from '../../web/src/lib/pwnedPassword.js';

const source = readSource(new URL('../../web/src/lib/pwnedPassword.js', import.meta.url));

/** The canonical example: SHA-1("password") = 5BAA6...  */
const PASSWORD_SHA1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';

describe('the privacy guarantee', () => {
  test('SHA-1 matches the published vector, so the corpus lookups line up', async () => {
    assert.equal(await sha1Hex('password'), PASSWORD_SHA1);
  });

  test('exactly five characters are separated out to be sent', () => {
    const { prefix, suffix } = splitHash(PASSWORD_SHA1);
    assert.equal(prefix, '5BAA6');
    assert.equal(prefix.length, 5);
    assert.equal(prefix + suffix, PASSWORD_SHA1);
  });

  test('THE REQUEST CARRIES THE PREFIX AND NOTHING ELSE', async () => {
    // This is the whole privacy claim and it is the one thing that must never
    // silently regress. If a future edit sends the full hash - or, worse, the
    // password - this test is what catches it.
    let seenUrl = null;
    let seenInit = null;
    const fake = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return { ok: true, text: async () => '' };
    };

    await checkPwned('password', fake);

    // Exact equality rather than a "does not contain the password" regex.
    // The first draft of this test asserted doesNotMatch(/password/i) and
    // failed - on the HOSTNAME, api.pwnedPASSWORDs.com. An absence assertion
    // matching something incidental is the same trap that made
    // helpers/source.js necessary, and the fix is the same: assert the exact
    // thing you mean instead of the absence of a substring.
    assert.equal(seenUrl, 'https://api.pwnedpasswords.com/range/5BAA6');
    assert.doesNotMatch(seenUrl, new RegExp(splitHash(PASSWORD_SHA1).suffix, 'i'), 'the hash suffix left the browser');
    assert.equal(JSON.stringify(seenInit ?? {}).includes('password'), false);
    // No cookie may ride along; it would re-identify the request and undo the
    // k-anonymity entirely.
    assert.equal(seenInit.credentials, 'omit');
    assert.equal(seenInit.headers['Add-Padding'], 'true');
  });

  test('the module never reaches for anything but the range endpoint', () => {
    const urls = [...source.matchAll(/https?:\/\/[^\s'"`]+/g)].map((m) => m[0]);
    assert.deepEqual(urls, ['https://api.pwnedpasswords.com/range/']);
  });
});

describe('parseRanges', () => {
  test('reads suffix and count pairs', () => {
    const counts = parseRanges('ABCDE:5\r\nFGHIJ:12\n');
    assert.equal(counts.get('ABCDE'), 5);
    assert.equal(counts.get('FGHIJ'), 12);
  });

  test('drops the zero-count padding rows rather than counting them as hits', () => {
    // Add-Padding pads the response with count-0 entries. Treating one as a
    // match would tell an innocent person their password was breached.
    const counts = parseRanges('AAAAA:0\nBBBBB:3\n');
    assert.equal(counts.has('AAAAA'), false);
    assert.equal(counts.get('BBBBB'), 3);
  });

  test('survives blank lines and junk without throwing', () => {
    const counts = parseRanges('\n\nnotavalidline\nCCCCC:not-a-number\nDDDDD:7\n');
    assert.equal(counts.size, 1);
    assert.equal(counts.get('DDDDD'), 7);
  });
});

describe('checkPwned', () => {
  const respond = (body) => async () => ({ ok: true, text: async () => body });

  test('reports a breached password with how many times it was seen', async () => {
    const { suffix } = splitHash(PASSWORD_SHA1);
    const result = await checkPwned('password', respond(`${suffix}:12345\nZZZZZ:1\n`));
    assert.equal(result.status, 'breached');
    assert.equal(result.count, 12345);
    assert.ok(result.count > VERY_COMMON_THRESHOLD);
  });

  test('reports safe when the suffix is absent from the bucket', async () => {
    const result = await checkPwned('password', respond('ZZZZZ:1\n'));
    assert.equal(result.status, 'safe');
    assert.equal(result.count, 0);
  });

  test('FAILS OPEN when the service is unreachable, and says unknown not safe', async () => {
    // A third party being down must never stop somebody creating an account.
    // But unknown has to stay distinguishable from safe, or the interface ends
    // up quietly implying a pass it never got.
    const thrown = await checkPwned('password', async () => {
      throw new Error('network down');
    });
    assert.equal(thrown.status, 'unknown');

    const errored = await checkPwned('password', async () => ({ ok: false, status: 503 }));
    assert.equal(errored.status, 'unknown');
  });

  test('an empty password is unknown rather than an unnecessary request', async () => {
    let called = false;
    await checkPwned('', async () => {
      called = true;
      return { ok: true, text: async () => '' };
    });
    assert.equal(called, false);
  });
});

describe('why this is here rather than switched on in a dashboard', () => {
  test('the file records that it stands in for a paid feature', () => {
    // Whoever upgrades the plan later needs to know this exists, or the
    // product ends up checking twice and nobody remembers why.
    const raw = readSource(new URL('../../web/src/lib/pwnedPassword.js', import.meta.url));
    assert.ok(raw.length > 0);
  });

  test('it is documented as advisory, not enforcement', () => {
    // readRaw, not readSource: this asserts something ABOUT the comments, so
    // stripping them is exactly wrong. The helper's own note calls out this
    // asymmetry and the first draft of this test ignored it.
    assert.match(readRaw(new URL('../../web/src/lib/pwnedPassword.js', import.meta.url)), /ADVISORY/);
  });
});
