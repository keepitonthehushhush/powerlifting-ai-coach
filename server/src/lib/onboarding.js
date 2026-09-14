/**
 * The four things that make up a first week, and which of them have happened.
 *
 * ── WHAT THIS IS FOR, AND HOW IT DIFFERS FROM starters.js ─────────────────
 *
 * `starters.js` answers "what do I type into this box". This answers the
 * question nobody had a place to ask: "what is this thing going to do for me,
 * and where does it come out."
 *
 * The production funnel on 2026-09-14, seven accounts, five of them real
 * people rather than the owner's two:
 *
 *   - two never finished the intake form at all, and today land on an empty
 *     chat page that says nothing about the form being unfinished;
 *   - one finished it in four minutes, faced the composer, sent nothing, and
 *     never signed in again;
 *   - two talked to the coach - one of them for ten exchanges, with a logged
 *     session - and have no program, because the coach was writing training
 *     in prose without ever emitting a block.
 *
 * Three different places to stop, and only the middle one is the blank box
 * that the openers already address. So this is not a second set of openers
 * and it is not a tour of the navigation: it is the shortest honest statement
 * of the road, with each stage marked from what the database already knows.
 *
 * ── WHY THE STEPS TICK THEMSELVES ─────────────────────────────────────────
 *
 * Nothing here is a checkbox anybody sets. `done` is derived from rows -
 * intake_completed_at, the message count, a workout_programs row, a
 * workout_sessions row - so the panel cannot tell somebody they have a
 * program when `workout_programs` is empty. That is not a hypothetical: on
 * 2026-08-30 the coach told an athlete it had saved his program, and it was
 * right by luck. A checklist is a claim about the athlete's own account, and
 * a claim that is not read from the account is a guess.
 *
 * ── WHY IDS AND NOT SENTENCES ─────────────────────────────────────────────
 *
 * The same two constraints as starters.js, for the same two reasons. The copy
 * belongs in the locale files where the American-English guard and the
 * Mexican-Spanish guard can see it, and a Spanish-speaking athlete gets this
 * in Spanish or it is worse than useless to them. And the profile must not
 * travel to a page that does not need it - the chat screen has no business
 * holding somebody's restrictions. `awaitingClearance` is computed on the
 * server by needsMedicalClearance() and only a boolean reaches this function;
 * only ids and booleans leave it.
 */

/** The most steps anybody is shown. */
export const MAX_STEPS = 4;

/**
 * Every step id this module can emit, in no particular order.
 *
 * Exported so a test can hold the locale files to it. A step whose copy is
 * missing renders as a raw key on somebody's first visit, which is the worst
 * possible moment for it - and the catalogue is the only thing that can say
 * the two files are complete, because nothing else enumerates them.
 */
export const STEP_IDS = Object.freeze([
  'profile',
  'firstMessage',
  'program',
  'logSession',
  'clearanceAsk',
]);

/**
 * @param {object} facts
 * @param {boolean} facts.intakeComplete   intake_completed_at is set
 * @param {boolean} facts.hasSentMessage   the athlete has sent at least one message
 * @param {boolean} facts.hasProgram       a workout_programs row exists
 * @param {boolean} facts.hasSession       a workout_sessions row exists
 * @param {boolean} [facts.awaitingClearance] reported a restriction, not cleared
 * @returns {{id: string, done: boolean}[]} steps in the order they happen,
 *          at most MAX_STEPS. The client renders `onboarding.steps.<id>` from
 *          its own catalogue and marks the first undone one as the live one.
 */
export function firstWeekSteps({
  intakeComplete = false,
  hasSentMessage = false,
  hasProgram = false,
  hasSession = false,
  awaitingClearance = false,
} = {}) {
  /*
   * ── THE PROGRAM STEP DOES NOT EXIST FOR A GATED ATHLETE ────────────────
   *
   * FIRST, before anything else, because it removes a step rather than
   * reordering one.
   *
   * The intake has just told this person that the coach will not write them a
   * program until a professional has cleared them, and that it will still
   * answer questions in the meantime. A checklist that then lists "your
   * program lands on the Program tab" as step three is the app forgetting,
   * thirty seconds later, something the person took the trouble to disclose -
   * and it sets them up to go looking for a thing that is not coming.
   *
   * starters.js already refuses to offer them the program opener for exactly
   * this reason. Two features that both speak on the first screen have to
   * agree about what the product is willing to do.
   *
   * They get two steps instead of four: the profile, and the conversation
   * that IS available to them.
   *
   * ── AND WHY THE LIBRARY IS NOT THE THIRD ONE ───────────────────────────
   *
   * It was, in the first draft. The library is genuinely the most useful page
   * in the product for somebody who cannot train yet, so a step pointing at
   * it looked free.
   *
   * It is not free, because nothing records that anybody opened it. Its `done`
   * could only ever have been the literal `false`, which means a gated
   * athlete's list can never complete, which means the panel never stops
   * rendering and the route keeps paying for the counts behind it forever.
   *
   * The rule that falls out of that is worth more than the step: EVERY STEP
   * MUST BE DERIVED FROM A ROW. A step with a hardcoded `done` is a checkbox
   * pretending to be a fact, and the whole point of this module is that it
   * never claims anything it has not read. The library keeps its place as a
   * link inside the copy for `clearanceAsk`, where it costs nothing.
   */
  if (awaitingClearance) {
    return [
      { id: 'profile', done: intakeComplete },
      { id: 'clearanceAsk', done: hasSentMessage },
    ];
  }

  /*
   * The ordinary road, in the order it actually happens. Not in the order the
   * navigation bar lists them, and not grouped by feature: "log the session"
   * comes after "get the program" because that is when a person does it, and
   * a list that is in any other order is describing the software rather than
   * the week.
   *
   * `library` is deliberately absent here. It is a good page and it is not on
   * the critical path to a first program; a fifth step would cost more than it
   * returns - three-step checklists complete at roughly 72% and seven-step
   * ones at 16%, and every step added is paid for.
   */
  return [
    { id: 'profile', done: intakeComplete },
    { id: 'firstMessage', done: hasSentMessage },
    { id: 'program', done: hasProgram },
    { id: 'logSession', done: hasSession },
  ].slice(0, MAX_STEPS);
}

/**
 * True when there is nothing left for the panel to say.
 *
 * The route uses this to stamp the write-once column, so the two counts this
 * feature costs are paid only until the athlete has finished a first week and
 * never again. A panel that keeps rendering after it is complete is clutter on
 * the page somebody uses every day.
 *
 * An empty list is NOT complete. That case means the derivation was skipped or
 * failed, and "we could not work it out" must never be recorded as "they
 * finished" - that is a write that cannot be taken back.
 */
export function firstWeekComplete(steps) {
  return Array.isArray(steps) && steps.length > 0 && steps.every((step) => step.done === true);
}
