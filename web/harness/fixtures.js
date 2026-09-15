/**
 * Production-SHAPED fixtures for the review harness.
 *
 * ── TWO RULES THIS FILE OBEYS ─────────────────────────────────────────────
 *
 * 1. Every shape is taken from the server route that produces it, never from
 *    what a page appears to want. The first version of this harness put
 *    `units` at the top level because the page read `equipment.units` and the
 *    database column is `units`; the route wraps it in an object. Every weight
 *    on the Program page rendered without its unit and no plate readout could
 *    appear at all, so the layout was tuned against a page that was missing
 *    two things. Shapes come from routes.
 *
 * 2. No real health information. Injuries, restrictions and medical notes are
 *    the athlete's health data; they do not belong in a screenshot, a scratch
 *    file, or a context window. The FIELDS are real so the layout is honest.
 *    The CONTENT is invented.
 *
 * ── AND WHY THERE ARE TWO OF EVERYTHING ───────────────────────────────────
 *
 * `sparse` is production as it actually stands today: four exercises in the
 * library, one logged lift, one leaderboard row. That is what nearly every
 * screen in this product is rendering right now, which makes the empty state
 * the most-seen state and the least-looked-at one.
 *
 * `full` is the same screens carrying a year of training. Layouts break under
 * volume, and a review that only sees an empty app reports that everything is
 * fine.
 */

import { startersFor } from '../../server/src/lib/starters.js';

const LIFTS = ['Squat', 'Bench press', 'Deadlift', 'Overhead press'];

function logsOver(weeks) {
  const out = [];
  const start = new Date('2026-09-14');
  for (let w = 0; w < weeks; w += 1) {
    for (let i = 0; i < LIFTS.length; i += 1) {
      const d = new Date(start);
      d.setDate(d.getDate() - w * 7 - i);
      out.push({
        id: `log-${w}-${i}`,
        date: d.toISOString().slice(0, 10),
        lift: LIFTS[i],
        weight: 405 - w * 5 + i * 12,
        reps: 3 + (i % 3),
        rpe: 7 + (i % 3) * 0.5,
        notes: i === 1 && w % 4 === 0 ? 'Felt heavy off the chest, cut the last set.' : null,
        completed: w % 9 !== 3,
      });
    }
  }
  return out;
}

const EXERCISE = (slug, name, category) => ({
  id: slug,
  slug,
  name,
  category,
  cues: [
    'Bar over mid-foot before you touch it. It does not move to you; you come to it.',
    'Squeeze the chest up to set the back flat before you pull.',
    'Finish standing tall with the hips through - no leaning back at the top.',
  ],
  common_faults: [
    'Rounding the lower back - the one fault worth stopping a set for.',
    'Hips shooting up first so the bar leaves the floor at a worse angle.',
  ],
  video_url: 'https://example.org/demo',
  video_source: 'Starting Strength',
});

const REAL_FOUR = [
  EXERCISE('low-bar-back-squat', 'Low-bar back squat', 'squat'),
  EXERCISE('bench-press', 'Bench press', 'bench'),
  EXERCISE('conventional-deadlift', 'Conventional deadlift', 'deadlift'),
  EXERCISE('overhead-press', 'Overhead press', 'press'),
];

const MORE = [
  ['front-squat', 'Front squat', 'squat'], ['pause-squat', 'Pause squat', 'squat'],
  ['close-grip-bench', 'Close-grip bench press', 'bench'], ['incline-bench', 'Incline bench press', 'bench'],
  ['sumo-deadlift', 'Sumo deadlift', 'deadlift'], ['romanian-deadlift', 'Romanian deadlift', 'deadlift'],
  ['push-press', 'Push press', 'press'], ['barbell-row', 'Barbell row', 'accessory'],
  ['chin-up', 'Chin-up', 'accessory'], ['bulgarian-split-squat', 'Bulgarian split squat', 'accessory'],
].map(([s, n, c]) => EXERCISE(s, n, c));

/*
 * ── FIVE OF THIS OBJECT'S ELEVEN KEYS WERE NOT COLUMNS ───────────────────
 *
 * `experience`, `training_days`, `injuries`, `restrictions` and
 * `leaderboard_opt_in` are names nothing in this repository reads.
 * `GET /api/profile` is `select('*')` on `user_profile` and returns the row
 * unchanged, so the fixture's keys ARE the column names, and the real ones are
 * `experience_level`, `days_per_week`, `health_restrictions` (there is no
 * separate injuries column) and `cleared_to_train`. There is no
 * `leaderboard_opt_in` column at all - opting in is a row in the leaderboard
 * projection, which is the entire point of that design.
 *
 * Two of the values were also outside their CHECK constraints: the database
 * permits no `experience_level` of 'intermediate' and no `goal` of 'strength'.
 *
 * Nothing failed, because the only screen that reads more than `units` and
 * `display_name` is the intake form, and it reads with `Object.entries`: an
 * unknown key is dropped and a missing one leaves its field blank. Measured
 * before this change, the intake screen rendered 3 of its 32 fields filled -
 * so the longest form in the product has been reviewed as a blank one by every
 * sweep this harness has ever run.
 *
 * Every value below is checked against `user_profile`'s CHECK constraints in
 * harnessFixtures.test.js, which is how this stops being true again.
 *
 * Health fields are invented. See the note at the top of this file.
 */
export const PROFILE = {
  display_name: 'Big_Daddy_Ed',
  units: 'lb',
  experience_level: 'over_2_years',
  progress_cadence: 'every_month_or_slower',
  goal: 'general_strength',
  competition_date: null,
  days_per_week: 5,
  bodyweight: 231,
  current_squat: 450,
  current_bench: 315,
  current_deadlift: 505,
  equipment_available: 'Barbell gym: calibrated plates, competition bench, mono, no belt squat.',
  gym_chains: ['barbell_gym'],
  gym_label: null,
  gender: 'man',
  gender_self_described: null,
  pronouns: 'he/him',
  smallest_plate_pair: 2.5,
  date_of_birth: '1994-06-01',
  health_restrictions: 'Sample placeholder - no real health data in this harness.',
  cleared_to_train: true,
  glp1_status: 'none',
  sleep_hours_typical: 7,
  alcohol_units_per_week: 2,
  nicotine_use: 'none',
  nutrition_notes: 'Sample placeholder - no real health data in this harness.',
  intake_completed_at: '2026-04-02T15:04:00.000Z',
};

/**
 * A written-out week, not an export of anybody's.
 *
 * It is shaped to exercise the things that have actually broken: a movement
 * repeated across ascending sets (the rowSpan grouping), an equipment
 * qualifier in parentheses (the warm-up ramp used to return null for the whole
 * week on these), a bodyweight movement with a null weight, a recovery day
 * with no loads, a rest day with one entry, and a summary written as one
 * slash-joined run with nowhere to break, which is how the model writes them.
 */
export const PROGRAM = {
  week: 12,
  phase: 'intermediate',
  summary:
    '5-day push/lower-power/recovery/pull/posterior split - squat to 405 per log, bench top set 275',
  days: [
    {
      name: 'Day 1 - Push',
      exercises: [
        { lift: 'bench press (Smith)', sets: 1, reps: 8, weight: 195, notes: null },
        { lift: 'bench press (Smith)', sets: 1, reps: 6, weight: 225, notes: null },
        { lift: 'bench press (Smith)', sets: 1, reps: 5, weight: 250, notes: null },
        { lift: 'bench press (Smith)', sets: 1, reps: 4, weight: 275, notes: null },
        { lift: 'incline dumbbell press', sets: 4, reps: 10, weight: 65, notes: null },
        { lift: 'cable lateral raise', sets: 3, reps: 20, weight: 10, notes: null },
        { lift: 'triceps pushdown', sets: 3, reps: 12, weight: 130, notes: null },
        { lift: 'push-up finisher', sets: 2, reps: 15, weight: null, notes: 'to failure' },
      ],
    },
    {
      name: 'Day 2 - Lower',
      exercises: [
        { lift: 'squat (Smith)', sets: 3, reps: 5, weight: 365, notes: 'rest 3-5 min' },
        { lift: 'bulgarian split squat', sets: 3, reps: 10, weight: 40, notes: 'per leg' },
        { lift: 'cable hamstring curl', sets: 3, reps: 12, weight: 90, notes: null },
        { lift: 'standing calf raise (Smith)', sets: 4, reps: 15, weight: 180, notes: null },
        { lift: 'cable crunch', sets: 3, reps: 15, weight: 70, notes: null },
      ],
    },
    {
      name: 'Day 3 - Recovery',
      exercises: [
        { lift: 'outdoor walk', sets: 1, reps: 1, weight: null, notes: '45-60 min conversational pace' },
        { lift: 'dead bug', sets: 3, reps: 10, weight: null, notes: 'per side' },
        { lift: 'bird dog', sets: 3, reps: 10, weight: null, notes: 'per side' },
      ],
    },
    {
      name: 'Day 4 - Pull',
      exercises: [
        { lift: 'Smith machine row', sets: 4, reps: 8, weight: 185, notes: null },
        { lift: 'lat pulldown', sets: 3, reps: 12, weight: 150, notes: null },
        { lift: 'chest-supported dumbbell row', sets: 3, reps: 12, weight: 70, notes: null },
        { lift: 'dumbbell curl', sets: 3, reps: 12, weight: 35, notes: null },
        { lift: 'farmer carry', sets: 3, reps: 1, weight: 100, notes: '40 seconds' },
      ],
    },
    { name: 'Day 5 - Full Rest', exercises: [{ lift: 'rest', sets: 1, reps: 1, weight: null, notes: 'no lifting' }] },
  ],
};

/*
 * A week's worth of logged work, invented. Real FIELDS, invented content - the
 * harness's third rule. The movement names are long enough to be honest about
 * how the row wraps, and the last one is deliberately incomplete, because a
 * lifter who stops mid-session is a normal thing this form has to render.
 */
const RECENT_SESSIONS = [
  {
    id: 's1',
    date: '2026-09-13',
    notes: 'Bar speed good through the opener, last single was a grind.',
    exercises: [
      { exercise: 'bench press (Smith)', sets: 4, reps: 5, weight: 275, rpe: 9, completed: true },
      { exercise: 'incline dumbbell press', sets: 4, reps: 10, weight: 65, rpe: 8, completed: true },
      { exercise: 'chest-supported dumbbell row', sets: 3, reps: 12, weight: 70, rpe: 8, completed: true },
      { exercise: 'cable lateral raise', sets: 3, reps: 20, weight: 10, rpe: null, completed: false },
    ],
  },
  {
    id: 's2',
    date: '2026-09-11',
    notes: null,
    exercises: [
      { exercise: 'squat', sets: 3, reps: 3, weight: 405, rpe: 8.5, completed: true },
      { exercise: 'Romanian deadlift', sets: 3, reps: 8, weight: 275, rpe: 8, completed: true },
    ],
  },
  {
    id: 's3',
    date: '2026-09-09',
    notes: 'Recovery day, everything easy.',
    exercises: [{ exercise: 'sled push', sets: 6, reps: 1, weight: 180, rpe: 6, completed: true }],
  },
];

export function fixtures(mode, program) {
  const full = mode === 'full';
  return {
    getProfile: { profile: PROFILE },
    getPreferences: { preferences: { theme: 'default' } },
    getMobilityDetail: { mobility_detail: 'brief' },
    getNutritionDetail: { nutrition_detail: 'brief' },
    getLibrary: { exercises: full ? [...REAL_FOUR, ...MORE] : REAL_FOUR },
    getProgress: { logs: full ? logsOver(26) : [
      { id: 'l1', date: '2026-08-27', lift: 'Squat', weight: 450, reps: 1, rpe: null, notes: null, completed: true },
    ] },
    /*
     * Shape from the route, not from what the page appears to want: GET
     * /api/sessions returns the athlete's unit beside the list, so the weight
     * field can say which one it means.
     *
     * And `full` now has sessions in it. It did not, so the log screen
     * rendered one blank row - which is what a brand new account sees exactly
     * once, and is not the screen anybody spends time on. prefillFrom builds
     * the form out of the last session, so a returning athlete arrives at four
     * movements already named, and that is the layout worth looking at.
     */
    getSessions: { units: 'lb', sessions: full ? RECENT_SESSIONS : [] },
    getLeaderboard: {
      units: 'lb',
      you: 'Big_Daddy_Ed',
      onLeaderboard: true,
      boards: full ? fullBoards() : sparseBoards(),
    },
    getAchievements: { achievements: [] },
    getConsents: { consents: {}, current_versions: {}, required: [] },
    getBillingStatus: { configured: false, paywallActive: false, entitled: true, reason: 'free', status: null },
    getGuardianStatus: { applicable: false, reason: 'feature_off' },
    getHevyConnection: { connected: false },
    getActivity: { days: [] },
    getProgram: program,
    getConversation: conversation(full),
  };
}

/*
 * ── THE SHAPE, AND THE THIRD TIME THIS RULE HAS BEEN LEARNED ──────────────
 *
 * `boards` is an OBJECT KEYED BY LIFT - `{ squat: [...], bench: [...],
 * deadlift: [...] }` - because that is what lib/leaderboard.js `rankEntries`
 * returns and what the route sends. This file invented an ARRAY of
 * `{ lift, entries }`, so `data.boards['squat']` was undefined, `rows` was
 * empty, and the page rendered "Nobody has logged that lift yet" in BOTH
 * modes.
 *
 * The consequence is not cosmetic. The leaderboard's table has therefore never
 * been reviewed with anything in it: not the ranking, not the row that
 * highlights the viewer, not a converted kilogram figure, not what a
 * twenty-nine character display name does to a column on a phone. The
 * computed-styles baseline has been recording the empty state as though it
 * were the page.
 *
 * Entry fields are rankEntries' own: rank, displayName, loggedWeight,
 * loggedUnits, weight, converted.
 */
const LIFTERS = [
  'Big_Daddy_Ed', 'nordic_bench', 'Marisol_R', 'quiet_deadlift', 'PlateCollector99',
  'a_very_long_display_name_here', 'Tom', 'kg_lifter_from_abroad', 'Jules', 'RackPuller',
];

/** One entry, in the viewer's units, marked when it was converted. */
function entry(rank, name, pounds) {
  // One lifter logs in kilograms, because a board that has never shown a
  // converted figure has never shown the note that explains one.
  const inKg = name === 'kg_lifter_from_abroad';
  return {
    rank,
    displayName: name,
    loggedWeight: inKg ? Math.round((pounds / 2.2046226218) * 10) / 10 : pounds,
    loggedUnits: inKg ? 'kg' : 'lb',
    weight: pounds,
    converted: inKg,
  };
}

function sparseBoards() {
  // One board with one entry, and two empty ones - a real state, and the one
  // the very first lifter on this leaderboard sees.
  return { squat: [entry(1, 'Big_Daddy_Ed', 450)], bench: [], deadlift: [] };
}

function fullBoards() {
  const boards = {};
  ['squat', 'bench', 'deadlift'].forEach((lift, l) => {
    boards[lift] = LIFTERS.map((name, i) => entry(i + 1, name, 520 - i * 17 - l * 60));
  });
  return boards;
}

function conversation(full) {
  /*
   * The SHAPE is GET /api/chat/conversation's, not what the page looks like it
   * wants: { conversation: <row>, limits, starters, onboarding? }, with the
   * messages array living on the conversation row. The first draft invented
   * { conversationId, messages } and the harness quietly rendered the empty
   * state for a full conversation - reviewing a screen nobody would ever see
   * in that combination. Shapes come from routes.
   */
  const messages = [
    { id: 'm1', role: 'user', content: 'Can you rewrite week 21? My shoulder has been fine but the Smith bench is starting to feel slow off the chest.', created_at: '2026-09-14T18:40:00.000Z' },
    { id: 'm2', role: 'assistant', content: 'Week 21 is written below. Two changes from last week and the reason for each.\n\n**Bench** comes down to a top set of 310 for 4 rather than 315 for 3. Your last two sessions both went to RPE 9.5 on the opener, which is the signal that the top set is eating the volume behind it.\n\n**Day 5** swaps the second hinge for a hip thrust. Nothing is wrong with the RDL; you have run it for nine weeks and the carryover has flattened.\n\n| Movement | Sets | Reps | Weight |\n| --- | --- | --- | --- |\n| Bench press (Smith) | 1 | 8 | 225 lb |\n| Bench press (Smith) | 1 | 6 | 245 lb |\n| Bench press (Smith) | 1 | 5 | 280 lb |\n| Bench press (Smith) | 1 | 4 | 310 lb |\n\nEverything else holds. Log the session when you are done and I will look at the bar speed note next week.', created_at: '2026-09-14T18:41:00.000Z' },
    { id: 'm3', role: 'user', content: 'Got it, thanks.', created_at: '2026-09-14T18:47:00.000Z' },
  ];
  if (!full) {
    return {
      conversation: null,
      limits: { maxMessageLength: 4000 },
      /*
       * ── THE BUG THIS FIXTURE WAS ──────────────────────────────────────
       *
       * These were `['program', 'formCheck', 'whatIsThis']` - three ids that
       * `startersFor` cannot return and that have no entry in either locale.
       * `t()` returns the key on a miss, so the first screen a new athlete
       * opens rendered three buttons reading `chat.starters.program`,
       * `chat.starters.formCheck` and `chat.starters.whatIsThis`.
       *
       * check-screens.mjs has carried a detector for exactly that since
       * ADR-29 and did not see it, because it ran `mode=full` only and the
       * starters render only when there is NO conversation. It runs both
       * modes now; pointed at this screen before the fix it names all three.
       *
       * Calling the server's own selector is what stops the two lists
       * drifting again - the ids are no longer written down twice.
       */
      starters: startersFor(PROFILE),
      onboarding: {
        steps: [
          { id: 'profile', done: true },
          { id: 'firstMessage', done: false },
          { id: 'program', done: false },
          { id: 'logSession', done: false },
        ],
      },
    };
  }
  return {
    conversation: { id: 'conv-1', messages, created_at: '2026-04-02T15:10:00.000Z' },
    limits: { maxMessageLength: 4000 },
    starters: [],
  };
}
