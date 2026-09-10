#!/usr/bin/env node
/**
 * Whether they came back.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * funnel.mjs stops at "sent a message", which is the BEGINNING of this product
 * rather than the end of it. A strength program is a claim about the next
 * three months; nothing in this repository could say whether a single athlete
 * had been present for the second week of one.
 *
 * That gap made every other decision unmeasurable. Turn the paywall on, defer
 * the intake, build the next feature - each of those is an argument about
 * retention, and there was no retention number to argue against.
 *
 * The arithmetic is in scripts/lib/retention.mjs, where it can be tested
 * against fixtures. This file is the database and the printing.
 *
 * ── WHAT COUNTS AS COMING BACK ─────────────────────────────────────────────
 *
 * Four things, unioned:
 *
 *   a message to the coach   conversations.messages[].at
 *   a logged workout         workout_sessions.created_at
 *   a program written        workout_programs.created_at
 *   a day the app was used   activity_days.day          (migration 0068)
 *
 * The first three are WRITES. Before activity_days existed, an athlete who
 * opened the app, read the session they were about to do, and put the phone
 * away left no row anywhere - so for any cohort older than activity_days,
 * every number here is a floor rather than a measurement, and says so at the
 * bottom of the report.
 *
 * ── WHY NOT usage_events, WHICH IS RIGHT THERE ─────────────────────────────
 *
 * Because it began recording on 2026-08-27T21:47:23Z, in migration 0020, and
 * two of the first three athletes had already had their entire relationship
 * with this app before that. Built on usage_events, this report would state
 * that d0513497 - ten messages across two days - never once used the product.
 *
 * That is the exact failure funnel.mjs shipped and had to retract: an
 * instrument's start date read as a person's behavior. conversations.messages
 * carries an `at` on every entry back to 2026-08-25, the first day anyone used
 * this app, so activity is taken from there and usage_events is not read here
 * at all.
 *
 * ── AND WHY NOT auth.sessions, WHICH IS ALSO RIGHT THERE ───────────────────
 *
 * Because it forgets, and because it invents. Both measured against this
 * production database on 2026-09-10:
 *
 *   645ed72f has server-written proof of activity on twelve separate days
 *   between 08-25 and 09-10, and exactly ONE row in auth.sessions, created
 *   that morning. Supabase Auth deletes sessions progressively once they
 *   expire or are superseded - the table lists who is signed in NOW. It is not
 *   a history and does not claim to be.
 *
 *   8bc672cb sent its last message on 08-27 and has refresh-token activity on
 *   four days through 09-04. A token refresh is a browser tab waking up, not a
 *   person deciding to train.
 *
 * One direction loses visits that happened and the other invents visits that
 * did not, which is why the auth schema is read here for nothing at all.
 *
 * ── PRIVACY, SAME RULES AS funnel.mjs ──────────────────────────────────────
 *
 * Eight characters of each account id, dates, and counts. No addresses, no
 * names, no health information, no training content. Message BODIES are
 * fetched - PostgREST cannot project into a jsonb array - and are dropped at
 * the boundary below without ever being read, printed or retained.
 *
 *   set -a; source .env; set +a; npm run retention
 */

import 'dotenv/config';
import {
  DAY,
  WINDOWS,
  calendarDays,
  concentration,
  curve,
  distinctVisits,
} from './lib/retention.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'retention needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.\n' +
      'They are in .env at the repository root. Run it as:\n\n' +
      '  set -a; source .env; set +a; npm run retention\n'
  );
  process.exit(2);
}

const rest = async (path) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  // A table this database does not have yet is a fact about the deployment,
  // not an error. activity_days is younger than this script's oldest cohort.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

const short = (id) => String(id).slice(0, 8);
const day = (t) => (t == null ? null : new Date(t).toISOString().slice(0, 10));

const now = Date.now();

const profiles = await rest('user_profile?select=user_id,created_at&order=created_at');
const conversations = await rest('conversations?select=user_id,messages');
const sessions = await rest('workout_sessions?select=user_id,created_at,client_key');
const programs = await rest('workout_programs?select=user_id,created_at');
const activityDays = await rest('activity_days?select=user_id,day');

const instants = new Map();
const note = (userId, at) => {
  if (userId == null || at == null) return;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return;
  if (!instants.has(userId)) instants.set(userId, []);
  instants.get(userId).push(t);
};

for (const row of conversations ?? []) {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  for (const message of messages) {
    // The only two fields read. `content` is never touched and the array goes
    // out of scope with this loop.
    if (message?.role === 'user') note(row.user_id, message.at);
  }
}
for (const row of sessions ?? []) note(row.user_id, row.created_at);
for (const row of programs ?? []) note(row.user_id, row.created_at);
/*
 * A day, not a moment. Noon UTC is the least wrong instant to stand for a
 * whole calendar day: it cannot fall on the far side of a window boundary
 * from the day it represents, whichever timezone the athlete was in.
 */
for (const row of activityDays ?? []) note(row.user_id, `${row.day}T12:00:00Z`);

const accounts = profiles.map((p) => {
  const raw = instants.get(p.user_id) ?? [];
  return {
    id: short(p.user_id),
    joinedAt: Date.parse(p.created_at),
    joined: day(p.created_at),
    events: raw.length,
    days: calendarDays(raw),
    instants: distinctVisits(raw),
  };
});

console.log(`\n${accounts.length} account(s), measured at ${new Date(now).toISOString()}.\n`);
console.log('"visits" collapses writes within half an hour of each other into one');
console.log('moment; "days" is UTC calendar days, which can split a late evening in two.\n');

const pad = (s, n) => String(s ?? '-').padEnd(n);
const num = (s, n) => String(s ?? '-').padStart(n);
console.log(`  ${pad('acct', 10)}${pad('joined', 12)}${num('events', 7)}${num('visits', 8)}${num('days', 6)}${num('span', 6)}  last`);
for (const a of accounts) {
  const last = a.instants.length > 0 ? a.instants[a.instants.length - 1] : null;
  console.log(
    `  ${pad(a.id, 10)}${pad(a.joined, 12)}${num(a.events, 7)}${num(a.instants.length, 8)}${num(a.days, 6)}` +
      `${num(last == null ? null : Math.floor((last - a.joinedAt) / DAY), 6)}  ${day(last) ?? '-'}`
  );
}

console.log('\nReturn curve, measured in elapsed hours from each account\'s own signup so');
console.log('that it means the same thing in every timezone. Denominators are accounts');
console.log('old enough for the window to have closed - the rest are not late, they are early.\n');

const width = Math.max(...WINDOWS.map((w) => w.label.length));
for (const row of curve(accounts, now)) {
  if (row.eligible === 0) {
    console.log(`  ${row.label.padEnd(width)}    -      (no account is old enough yet)`);
    continue;
  }
  console.log(
    `  ${row.label.padEnd(width)}  ${String(row.active).padStart(3)} of ${String(row.eligible).padStart(3)}` +
      `   ${String(row.percent).padStart(3)}%` +
      (row.who.length > 0 ? `   ${row.who.join(' ')}` : '')
  );
}

for (const heavy of concentration(accounts)) {
  console.log(
    `\n${heavy.id} is ${heavy.percent}% of every visit in the database (${heavy.events} of ${heavy.total}).\n` +
      '  Read the curve above as a statement about this account until that stops\n' +
      '  being true. If it is a test account, the real curve is the table with this\n' +
      '  row removed - and that is a judgment for a person, not for a script.'
  );
}

/*
 * ── THE LOOP, WHICH IS THE THING RETENTION IS MADE OF ──────────────────────
 *
 * prescribe -> train -> log -> adapt. The first and last steps are built and
 * tested; the middle one is the only one that needs a person, and it is the
 * one that decides whether any of the rest means anything. Every prescription
 * after the first is computed from the log.
 *
 * On 2026-09-10 this read: three programs written, two sessions logged, ONE
 * progress_logs row - and neither session came from a coach card, because both
 * predate the column that marks one. An adaptation engine reading an empty log
 * is a very good answer to a question nobody asked it.
 *
 * `client_key` is non-null exactly when a row came from the coach's card
 * (migration 0065), so accepted offers are countable here. Offers MADE are
 * not - they leave no row - which is why chat.js logs `session.log_offered`.
 * Offered-minus-accepted is the decline rate, and the two halves live in
 * different places on purpose: the acceptance is durable because it is a
 * record, the offer is a log line because it is a diagnostic.
 */
console.log('\nThe loop: prescribe -> train -> log -> adapt.\n');

const countBy = (rows, id) => (rows ?? []).filter((r) => r.user_id === id).length;
const fromCard = (rows, id) => (rows ?? []).filter((r) => r.user_id === id && r.client_key != null).length;

console.log(`  ${pad('acct', 10)}${num('programs', 10)}${num('sessions', 10)}${num('from a card', 13)}`);
let anyLogged = 0;
for (const p of profiles) {
  const id = short(p.user_id);
  const written = countBy(programs, p.user_id);
  const logged = countBy(sessions, p.user_id);
  if (logged > 0) anyLogged += 1;
  if (written === 0 && logged === 0) continue;
  console.log(`  ${pad(id, 10)}${num(written, 10)}${num(logged, 10)}${num(fromCard(sessions, p.user_id), 13)}`);
}
if (anyLogged === 0) {
  console.log('  Nobody has logged a session. Every number above the line is about');
  console.log('  people talking to a coach, not about anybody training with one.');
}

/*
 * ── THE PART THE TABLES CANNOT SEE ─────────────────────────────────────────
 *
 * Printed on every run rather than left in a comment, because the numbers
 * above will be quoted in rooms this file is not in.
 */
console.log('');
if (activityDays == null) {
  console.log('activity_days is not in this database yet, so a visit that wrote nothing -');
  console.log('opened the app, read the session, went to the gym - is invisible to every');
  console.log('number above. They are floors, not measurements.');
} else {
  const covered = new Set(activityDays.map((r) => r.user_id)).size;
  const earliest = activityDays.map((r) => r.day).sort()[0] ?? null;
  console.log(
    `activity_days has been recording since ${earliest ?? 'nothing yet'}, covering ${covered} account(s).\n` +
      '  Cohorts older than that date are still measured by writes alone, so their\n' +
      '  numbers remain floors. Nobody who joined earlier gained a visit.'
  );
}
