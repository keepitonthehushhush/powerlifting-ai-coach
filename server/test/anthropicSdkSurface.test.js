import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { readSource } from './helpers/source.js';

const require = createRequire(import.meta.url);

/**
 * The installed package's own directory.
 *
 * `require.resolve('@anthropic-ai/sdk/package.json')` and the same for a .d.ts
 * both fail: the package publishes an `exports` map, which is exactly what an
 * exports map is for, and Node appends `.js` to what it cannot find. So the
 * root is derived from the one entry point the map does expose, and the files
 * are read off disk. Reading node_modules is the point of this file - the
 * question being asked is what SHIPPED, not what the package chooses to
 * export.
 */
const SDK_DIR = (() => {
  let dir = dirname(require.resolve('@anthropic-ai/sdk'));
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(dir, 'package.json'))
        && JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === '@anthropic-ai/sdk') {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error('could not locate the installed @anthropic-ai/sdk directory');
})();

/**
 * The few pieces of the Anthropic SDK this product actually depends on.
 *
 * ── WHY AN UPGRADE NEEDED A TEST AND NOT JUST A GREEN SUITE ───────────────
 *
 * Going from 0.71 to 0.122 - fifty-one releases - the suite stayed green
 * before the upgrade and after it, because nothing in it calls the SDK. Every
 * test mocks the coach, the safety evaluation talks to the API with raw
 * fetch, and `createCoachReply` is the single function in the codebase that
 * touches the client at all.
 *
 * So a rename in the response would not have failed anything. It would have
 * made `response.stop_details` undefined, and the only visible consequence
 * would be a diagnosis quietly going missing from an error record - months
 * later, in the one situation where somebody needed it. That is this
 * project's recurring shape, and a dependency upgrade is a good place for it
 * to hide.
 *
 * ── ASKED OF THE INSTALLED PACKAGE, NOT THE CHANGELOG ─────────────────────
 *
 * The changelog says there were no breaking changes in that range. That is
 * evidence and it is not proof: a changelog describes what somebody meant to
 * do. node_modules is what shipped. So the field list below is read out of
 * the installed .d.ts, the same way this project asserts against pg_proc
 * rather than a migration file.
 */

describe('the client surface createCoachReply relies on', () => {
  test('the default export constructs, and takes an apiKey', () => {
    const client = new Anthropic({ apiKey: 'sk-ant-shape-check-only-not-a-credential' });
    assert.equal(typeof Anthropic, 'function');
    assert.equal(client.apiKey, 'sk-ant-shape-check-only-not-a-credential');
  });

  test('messages.create is still the call', () => {
    const client = new Anthropic({ apiKey: 'sk-ant-shape-check-only-not-a-credential' });
    assert.ok(client.messages, 'client.messages is gone');
    assert.equal(typeof client.messages.create, 'function', 'messages.create is gone');
  });
});

describe('the response fields createCoachReply reads', () => {
  /** The Message interface out of the installed package, brace-matched. */
  function messageFields() {
    const source = readFileSync(join(SDK_DIR, 'resources/messages/messages.d.ts'), 'utf8');
    const start = source.indexOf('export interface Message {');
    assert.notEqual(start, -1, 'the SDK no longer declares an interface named Message');
    const open = source.indexOf('{', start);
    let depth = 1;
    let i = open + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    const body = source.slice(open + 1, i - 1);
    return new Set([...body.matchAll(/^ {4}([a-z_]+)\??:/gm)].map((m) => m[1]));
  }

  test('the parser found a real interface', () => {
    // Floor assertion. A parser that returned nothing would pass every
    // assertion below it without reading a line.
    const fields = messageFields();
    assert.ok(fields.size >= 6, `only ${fields.size} fields parsed - the parser is broken`);
    assert.ok(fields.has('id'), 'a Message without an id is not a Message');
  });

  test('every field the code reads is declared by the SDK', () => {
    /*
     * Derived from the code, not typed here: the list is scraped out of
     * anthropic.js, so a new field read tomorrow is covered without anybody
     * remembering to add it.
     */
    const code = readSource(new URL('../src/lib/anthropic.js', import.meta.url));
    const read = new Set(
      [...code.matchAll(/\bresponse\.([a-z_]+)/g)].map((m) => m[1])
    );

    assert.ok(read.size >= 4, `only found ${read.size} field reads - the scrape is broken`);
    // The four that carry a diagnosis. Named so the scrape cannot silently
    // stop finding them and pass.
    for (const expected of ['content', 'usage', 'stop_reason', 'stop_details', 'model']) {
      assert.ok(read.has(expected), `anthropic.js stopped reading ${expected}`);
    }

    const fields = messageFields();
    const missing = [...read].filter((field) => !fields.has(field));
    assert.deepEqual(
      missing,
      [],
      'these are read from the response and no longer declared by the installed SDK, ' +
        'so they would be undefined at runtime with nothing failing'
    );
  });
});

describe('the declared version and the installed one agree', () => {
  test('package.json and node_modules have not drifted', () => {
    // npm ci refuses when the lockfile disagrees, but a machine with no
    // registry access can leave package.json ahead of what is installed - and
    // then every check here runs against the OLD library while the manifest
    // claims the new one.
    const declared = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ).dependencies['@anthropic-ai/sdk'];
    const installed = JSON.parse(readFileSync(join(SDK_DIR, 'package.json'), 'utf8')).version;

    const floor = declared.replace(/^[^\d]*/, '');
    assert.equal(
      installed.split('.').slice(0, 2).join('.'),
      floor.split('.').slice(0, 2).join('.'),
      `package.json asks for ${declared} and node_modules holds ${installed}`
    );
  });
});
