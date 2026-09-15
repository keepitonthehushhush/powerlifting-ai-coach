#!/usr/bin/env node
/**
 * Poll production until it serves the commit that was pushed, or say it did not.
 *
 * The reasoning lives in server/src/lib/deployLanded.js, next to the pure
 * function that makes the decision. In short: post-deploy.yml listens for a
 * successful deployment, and a CANCELED deployment never sends one - so the
 * job that watches production skips exactly when production has failed to
 * update, and a skipped job is green. This asks instead of listening.
 *
 * Usage:  node scripts/check-deploy-landed.mjs <sha> [origin]
 *
 * Exit codes follow this repository's three-valued rule:
 *   0  the commit is serving
 *   1  the deadline passed and production is serving something else
 *   2  could not determine - the health endpoint never answered usefully
 */

import { execFileSync } from 'node:child_process';
import { DEFAULT_DEADLINE_MS, describeLanding, staleMessage } from '../server/src/lib/deployLanded.js';

const UNDETERMINED = 2;
const POLL_MS = 10_000;

const pushed = process.argv[2] ?? readLocalHead();
const origin = (process.argv[3] ?? process.env.DEPLOY_URL ?? 'https://coachdiaz.app').replace(/\/$/, '');
const deadlineMs = Number(process.env.DEPLOY_DEADLINE_MS ?? DEFAULT_DEADLINE_MS);

function readLocalHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** The cache-buster matters: a 15-minute cached answer is the whole failure mode. */
async function readHealth() {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 10_000);
  try {
    const response = await fetch(`${origin}/api/health?cb=${Date.now()}`, {
      signal: control.signal,
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return { healthProblem: `${response.status} ${response.statusText}` };
    return { health: await response.json() };
  } catch (error) {
    return { healthProblem: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!pushed) {
    console.error('COULD NOT DETERMINE - no commit was given and git could not be read.');
    process.exit(UNDETERMINED);
  }
  console.log(`Waiting for ${origin} to serve ${pushed.slice(0, 8)} (up to ${Math.round(deadlineMs / 60000)} minutes).`);

  const startedAt = Date.now();
  let last;
  for (;;) {
    const elapsedMs = Date.now() - startedAt;
    const { health, healthProblem } = await readHealth();
    last = describeLanding({ pushed, health, healthProblem, elapsedMs, deadlineMs });

    if (last.verdict === 'landed') {
      console.log(`PASS - production is serving ${pushed.slice(0, 8)}, the commit that was pushed.`);
      return;
    }
    if (last.verdict !== 'waiting') break;

    console.log(`  ...still ${last.serving ? last.serving.slice(0, 8) : 'unreadable'} after ${Math.round(elapsedMs / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (last.verdict === 'unknown') {
    console.error(`COULD NOT DETERMINE - ${last.reason}`);
    console.error('      This says nothing about whether the deploy landed. It says the question');
    console.error('      could not be asked, which is a different morning from a stale production.');
    process.exit(UNDETERMINED);
  }

  console.error(staleMessage({ pushed, serving: last.serving, deadlineMs }));
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(UNDETERMINED);
});
