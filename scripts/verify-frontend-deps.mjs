#!/usr/bin/env node
/**
 * Refuse to ship a server-only package as a frontend dependency.
 *
 * Written after `npm audit fix --force` silently added `@sentry/node` - a Node
 * server SDK, with the whole OpenTelemetry tree behind it - to
 * web/package.json while resolving a real advisory. Nothing imported it, so
 * the built bundle was unaffected and every other check stayed green. It was a
 * landmine, not a fire: the day someone writes `import * as Sentry from
 * '@sentry/node'` in a component, the bundler starts trying to resolve Node
 * internals for the browser, and the DSN travels with it.
 *
 * The bundle scanner cannot catch this, because it only inspects what was
 * actually bundled. This checks the dependency manifest instead - the
 * intention rather than the output - which is the layer where the mistake
 * lives.
 *
 * Two rules:
 *   1. An explicit denylist of packages that exist only to run on a server.
 *   2. A heuristic for the Anthropic SDK, which holds the API key and must
 *      never appear in a browser dependency tree under any circumstances.
 */
import { readFileSync } from 'node:fs';

const MANIFEST = new URL('../web/package.json', import.meta.url);

/**
 * Packages that are server-only by nature. This is not about whether they are
 * currently imported - it is about whether a frontend has any business
 * declaring them at all.
 */
const SERVER_ONLY = [
  '@anthropic-ai/sdk',   // holds the API key. Never, under any circumstances.
  '@sentry/node',
  '@sentry/profiling-node',
  '@opentelemetry/sdk-node',
  'express',
  'cors',
  'dotenv',
  'pg',
  'mysql2',
  'jsonwebtoken',
  'bcrypt',
  'nodemailer',
  'stripe',              // the server SDK; @stripe/stripe-js is the browser one
];

/** Anything matching these is server-side by construction. */
const SERVER_PATTERNS = [/^@sentry\/(node|bun|deno|profiling)/, /-node$/, /^node-/];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const declared = Object.keys({
  ...(manifest.dependencies ?? {}),
  ...(manifest.devDependencies ?? {}),
  ...(manifest.optionalDependencies ?? {}),
  ...(manifest.peerDependencies ?? {}),
});

const findings = declared.filter(
  (name) => SERVER_ONLY.includes(name) || SERVER_PATTERNS.some((re) => re.test(name))
);

console.log(`Checked ${declared.length} declared frontend dependencies in web/package.json.`);

if (findings.length > 0) {
  console.error('\nFAIL - server-only packages declared as frontend dependencies:');
  for (const name of findings) console.error(`  ${name}`);
  console.error(
    '\nThese belong in the root package.json, which is the server workspace.\n' +
      'A server SDK in the frontend manifest is a bundling accident waiting to\n' +
      'happen - and in the case of @anthropic-ai/sdk, a credential leak.\n' +
      '\nIf a package here is genuinely browser-safe, remove it from the list in\n' +
      'this script deliberately, with a note saying why.'
  );
  process.exit(1);
}

console.log('PASS - no server-only packages in the frontend dependency manifest.');
