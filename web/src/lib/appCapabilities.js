/**
 * What this application can actually do, as data.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Asked "what can you do for me?", the coach used to improvise. It had no
 * list. It knew about exactly one page - the clinician page, mentioned once,
 * inside the injury instructions - and nothing about the leaderboard, the
 * progress charts, session logging, the program tab or the FAQ. Measured
 * before this was written: the word "leaderboard" appeared zero times in a
 * two-thousand-line system prompt.
 *
 * So it described the product from its own coaching instructions, which is a
 * confident answer produced without looking - the exact defect this codebase
 * keeps finding, wearing a product-shaped hat. Worse in one direction than a
 * wrong number: a coach that cannot name a feature is a coach that quietly
 * teaches every athlete the feature does not exist.
 *
 * ── WHY IT IS DATA AND NOT PROSE IN THE PROMPT ────────────────────────────
 *
 * Prose in a prompt is a copy of a fact the router already owns. Ship a new
 * page and the prompt is stale; retire one and the coach starts advertising
 * something that 404s, which is worse than silence because the athlete goes
 * looking. A test walks the router and requires every athlete-facing route to
 * appear here or be excluded on purpose, so adding a page forces the decision
 * rather than allowing the omission.
 *
 * ── WHAT THE DESCRIPTIONS MAY AND MAY NOT SAY ─────────────────────────────
 *
 * Each line says what the feature IS, in the plainest available words. None of
 * them says what it will do FOR somebody. That boundary is not modesty, it is
 * the same rule the rest of this prompt already lives under: this product
 * gives training and nutrition guidance to people with injuries and eating
 * disorders in its user base, and a sentence like "get strong fast" is a
 * health claim wearing marketing clothes. Specific beats boastful anyway -
 * "charts every lift you have logged" tells somebody more than "powerful
 * analytics" ever will.
 */

/**
 * @typedef {{ path: string, name: string, whatItIs: string }} Capability
 */

/** @type {Capability[]} */
export const CAPABILITIES = [
  {
    path: '/coach',
    name: 'Coach',
    whatItIs:
      'this conversation - programming, form questions, nutrition, and adjusting the plan ' +
      'when a session does not go as written',
  },
  {
    path: '/intake',
    name: 'Your details',
    whatItIs:
      'the form holding experience, current lifts, bodyweight, equipment, days per week, ' +
      'goal and any injuries; editable at any time, and what everything else is built from',
  },
  {
    path: '/program',
    name: 'Program',
    whatItIs:
      'the current training block, saved so it can be opened without scrolling back through ' +
      'the conversation',
  },
  {
    path: '/log',
    name: 'Log a session',
    whatItIs: 'recording what was actually lifted, set by set, including the sets that were missed',
  },
  {
    path: '/progress',
    name: 'Progress',
    whatItIs: 'charts of every lift that has been logged over time, with missed sets marked',
  },
  {
    path: '/library',
    name: 'Exercise library',
    whatItIs: 'written technique cues for the lifts, with links out to demonstrations',
  },
  {
    path: '/leaderboard',
    name: 'Leaderboard',
    whatItIs:
      'an opt-in ranking against other lifters; nothing appears there unless the athlete ' +
      'turns it on, and it can be turned off again',
  },
  {
    path: '/account',
    name: 'Account',
    whatItIs:
      'settings, the theme picker, and the buttons that export everything stored about them ' +
      'or delete the account outright, without asking anybody',
  },
  {
    path: '/faq',
    name: 'Questions people ask',
    whatItIs: 'the common questions, answered, readable without signing in',
  },
  {
    path: '/about',
    name: 'For your clinician',
    whatItIs:
      'a page written for a doctor or physical therapist, explaining what this is, what it ' +
      'refuses to do, and how they can set training restrictions; needs no account to read',
  },
];

/**
 * Routes deliberately NOT described to the coach, and why.
 *
 * Plumbing and legal text. An athlete asking what the app does is not asking
 * to be read the privacy policy, and a coach that recites route names is a
 * coach nobody talks to twice. The policies are reachable from every page and
 * from the Account page, which IS described.
 */
export const NOT_WORTH_DESCRIBING = {
  '/': 'the front door; whoever is asking is already past it',
  '/login': 'sign-in',
  '/consent': 'the consent screen, shown when it is needed rather than advertised',
  '/reset-password': 'password recovery, reached from an email',
  '/policies/privacy': 'the privacy policy; notice rather than a feature, linked from every page footer',
  '/policies/terms': 'legal text, linked from every page footer',
  '/policies/ai-processing': 'legal text, linked from every page footer',
  '/policies/health-data': 'legal text, linked from every page footer',
  '/policies/leaderboard': 'legal text, linked from the leaderboard itself',
  '/policies/guardian-consent': 'legal text, linked from the guardian consent email',
  /*
   * The one route here that is not skipped for being plumbing or legalese.
   *
   * The coach talks to the ATHLETE. This page is opened by a guardian, from a
   * link in an email, on a device that may never have seen this app, and
   * describing it to the athlete would be describing a page they cannot
   * usefully visit - the token in the link is the whole authorization. It is
   * also behind MINORS_ENABLED, which is off.
   */
  '/guardian/consent': "the guardian's own decision page, reached from an emailed link and not by the athlete",
  '/privacy/health-data': 'the privacy controls, reached from Account',
  '*': 'the not-found page',
};

/** The capability list as prompt lines. Formatting lives here, not in the prompt. */
export function describeCapabilities() {
  return CAPABILITIES.map((c) => `- ${c.name} (${c.path}) - ${c.whatItIs}`).join('\n');
}
