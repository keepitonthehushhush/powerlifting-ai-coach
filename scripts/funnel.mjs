#!/usr/bin/env node
/**
 * Where people stop.
 *
 * ── WHY A SCRIPT AND NOT A DASHBOARD ──────────────────────────────────────
 *
 * Because the numbers only matter when somebody reads them, and the person who
 * needs to read them does not write SQL at eleven at night. Every fact below
 * already exists in the database; what did not exist was a way to see it
 * without a query somebody has to remember how to write.
 *
 * ── WHAT IT REFUSES TO DO ─────────────────────────────────────────────────
 *
 * It prints no addresses, no names, no health information, and no training
 * content. Eight characters of each account id, timestamps, and counts. That
 * is enough to say WHERE somebody stopped and nothing about who they are -
 * and a funnel tool that quietly became a way to read the users is a tool that
 * gets used for something else eventually.
 *
 *   set -a; source .env; set +a; npm run funnel
 */

import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'funnel needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.\n' +
      'They are in .env at the repository root. Run it as:\n\n' +
      '  set -a; source .env; set +a; npm run funnel\n'
  );
  process.exit(2);
}

const rest = async (path) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

const short = (id) => String(id).slice(0, 8);
const day = (t) => (t ? String(t).slice(0, 10) : null);

const profiles = await rest(
  'user_profile?select=user_id,created_at,profile_first_read_at,intake_completed_at,coach_first_opened_at&order=created_at'
);
const conversations = await rest('conversations?select=user_id,created_at,messages&order=created_at');

/** How many messages this account has actually sent, and when the first went. */
const sent = new Map();
for (const row of conversations) {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const mine = messages.filter((m) => m?.role === 'user');
  if (mine.length === 0) continue;
  const previous = sent.get(row.user_id) ?? { count: 0, first: row.created_at };
  sent.set(row.user_id, {
    count: previous.count + mine.length,
    first: previous.first < row.created_at ? previous.first : row.created_at,
  });
}

/*
 * The steps, in the order somebody walks them. A person is counted at the
 * furthest step they reached, so the columns fall monotonically and a drop
 * between two of them is a real drop rather than a coincidence of definitions.
 */
const STEPS = [
  ['signed up', () => true],
  ['opened intake', (p) => p.profile_first_read_at != null],
  ['finished intake', (p) => p.intake_completed_at != null],
  ['reached the coach', (p) => p.coach_first_opened_at != null],
  ['sent a message', (p) => sent.has(p.user_id)],
];

/**
 * The furthest step this person reached, as an index into STEPS.
 *
 * ── A LATER STEP PROVES THE EARLIER ONES ──────────────────────────────────
 *
 * The first version of this counted each step independently, and the very
 * first run printed the funnel going UP: "reached the coach 0" followed by
 * "sent a message 3". Three people had plainly reached a page they were
 * talking to, and the report said nobody had - because coach_first_opened_at
 * did not exist when they visited, and an independent filter has no way to
 * know that sending a message is proof of arrival.
 *
 * So the furthest TRUE step wins and everything below it is counted as
 * reached. A missing timestamp then reads as missing evidence rather than as
 * a person who did not get there, which is the difference between a funnel
 * and a rumour.
 */
const furthestStep = (p) => {
  let furthest = 0;
  STEPS.forEach(([, reached], index) => {
    if (reached(p)) furthest = index;
  });
  return furthest;
};

console.log(`\n${profiles.length} account(s).\n`);

const width = Math.max(...STEPS.map(([label]) => label.length));
let previousCount = null;
STEPS.forEach(([label], index) => {
  const count = profiles.filter((p) => furthestStep(p) >= index).length;
  const lost = previousCount === null ? '' : `  (-${previousCount - count})`;
  console.log(`  ${label.padEnd(width)}  ${String(count).padStart(3)}${lost}`);
  previousCount = count;
});

console.log('\nPer account, at the step they stopped:\n');
for (const p of profiles) {
  const messages = sent.get(p.user_id);
  console.log(
    `  ${short(p.user_id)}  joined ${day(p.created_at)}  stopped at: ${STEPS[furthestStep(p)][0]}` +
      (messages ? `  (${messages.count} message${messages.count === 1 ? '' : 's'})` : '')
  );
}

/*
 * ── THE TWO THAT NEED OPPOSITE FIXES ──────────────────────────────────────
 *
 * Called out rather than left in the table, because these are the only two
 * rows anybody should act on and they are easy to miss among the rest.
 */
/**
 * ── WHEN THIS INSTRUMENT STARTED WORKING ────────────────────────────────────
 *
 * coach_first_opened_at arrived in migration 0064, applied to production at
 * 2026-09-08T21:54:17Z (supabase_migrations.schema_migrations, version
 * 20260908215417). Nobody who used the app before that has a stamp, whatever
 * they did.
 *
 * That is not a footnote, it is the difference between two opposite reports.
 * This script used to compute one list and print it twice: once as "N finished
 * the intake and NEVER REACHED the coach page. That is a bug - routing,
 * loading, or an error nobody saw", naming two accounts to go and investigate,
 * and then again, underneath, as "these accounts cannot have a stamp so the
 * split means nothing for them". The two filters were character-for-character
 * identical.
 *
 * A false red is worse than a false green here. It sends somebody hunting a
 * routing bug that there is no evidence for, in an app where the evidence for
 * it CANNOT EXIST for those accounts - and the one real signal in the data,
 * a failed /api/consent read on 2026-09-02, sits unread underneath a louder
 * claim that was never established.
 *
 * So: DID NOT and CANNOT SAY are different answers and are printed as such.
 */
const COACH_STAMP_RECORDING_SINCE = Date.parse('2026-09-08T21:54:17Z');

/*
 * A message is proof they arrived, whatever the timestamp says - the stamp is
 * written on a page load and the earliest athletes here predate it entirely.
 */
const reachedCoach = (p) => p.coach_first_opened_at != null || sent.has(p.user_id);
const measurable = (p) => Date.parse(p.created_at) >= COACH_STAMP_RECORDING_SINCE;

const finishedButNeverArrived = profiles.filter(
  (p) => p.intake_completed_at && !reachedCoach(p) && measurable(p)
);
const cannotSay = profiles.filter(
  (p) => p.intake_completed_at && !reachedCoach(p) && !measurable(p)
);
const arrivedButNeverTyped = profiles.filter(
  (p) => p.coach_first_opened_at && !sent.has(p.user_id)
);

console.log('');
if (finishedButNeverArrived.length > 0) {
  console.log(
    `${finishedButNeverArrived.length} finished the intake and NEVER REACHED the coach page.\n` +
      '  That is a bug - routing, loading, or an error nobody saw. Look at error_events\n' +
      '  for these accounts first:\n' +
      finishedButNeverArrived.map((p) => `    ${short(p.user_id)}`).join('\n')
  );
}
if (arrivedButNeverTyped.length > 0) {
  console.log(
    `${arrivedButNeverTyped.length} reached the coach page and NEVER TYPED.\n` +
      '  That is a design problem, not a bug. Go and read that page as a stranger would:\n' +
      arrivedButNeverTyped.map((p) => `    ${short(p.user_id)}`).join('\n')
  );
}
if (cannotSay.length > 0) {
  console.log(
    `${cannotSay.length} finished the intake and CANNOT BE CLASSIFIED.\n` +
      '  They signed up before coach_first_opened_at existed and sent no messages, so\n' +
      '  there is no record either way. This is not a bug report and must not be read\n' +
      '  as one - it is the instrument saying it was not switched on yet:\n' +
      cannotSay.map((p) => `    ${short(p.user_id)}  joined ${day(p.created_at)}`).join('\n')
  );
}
if (finishedButNeverArrived.length === 0 && arrivedButNeverTyped.length === 0) {
  console.log(
    'No account has finished the intake and then measurably failed to reach or use\n' +
      'the coach. Every drop-off above is either earlier in the funnel or unmeasurable.'
  );
}
