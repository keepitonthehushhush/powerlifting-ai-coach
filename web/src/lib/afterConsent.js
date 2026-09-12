/**
 * Where somebody goes once they have agreed.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A STRING ────────────────────────────────
 *
 * It was a string. `navigate('/intake')`, hardcoded, which is right for
 * exactly one person: somebody who has just signed up and has never seen the
 * form. Everybody else reaches this screen a different way.
 *
 * A consent is recorded against a POLICY VERSION, so changing a policy makes
 * every stored agreement to the old wording superseded - correctly; that is
 * the mechanism working. What it means in practice is that an athlete who has
 * been using the product for a month opens it one morning, is stopped by a
 * screen they were not expecting, agrees, and is then dropped on the intake
 * form they completed weeks ago.
 *
 * Nobody reads that as "your consent was renewed". They read it as "it lost my
 * account", and the honest response to that is to close the app.
 *
 * ── THE FALLBACK IS THE OLD BEHAVIOR, DELIBERATELY ─────────────────────────
 *
 * When there is no recorded destination this returns `/intake`, because the
 * one case that reaches /consent with nowhere to come back from is a fresh
 * signup, and intake is where they were going anyway.
 *
 * @param {string|null|undefined} from the path the gate interrupted
 * @returns {string} a path inside this app
 */
export const DEFAULT_AFTER_CONSENT = '/intake';

export function afterConsent(from) {
  if (typeof from !== 'string' || from === '') return DEFAULT_AFTER_CONSENT;

  /*
   * Same-origin, absolutely. `from` arrives through router state, which is
   * ordinary client-side data: it survives a history entry the person can
   * edit, and anything that turns a stored string into a navigation target is
   * an open redirect until it refuses to be. A leading `//` is the one that
   * looks local and is not - `//evil.example` is a protocol-relative URL to
   * another host, and every browser treats it as one.
   */
  if (!from.startsWith('/') || from.startsWith('//')) return DEFAULT_AFTER_CONSENT;

  // Coming back to /consent is the loop this whole screen exists outside of.
  if (from === '/consent' || from.startsWith('/consent?')) return DEFAULT_AFTER_CONSENT;

  return from;
}

/**
 * The button's label has to match where the button goes.
 *
 * "Continue to intake" above a button that returns somebody to their coach is
 * a smaller lie than the navigation bug it came from, and it is still a lie -
 * and this is the screen where a person is deciding whether to trust what the
 * product tells them.
 */
export function continueLabelKey(from) {
  return afterConsent(from) === DEFAULT_AFTER_CONSENT ? 'consent.continue' : 'consent.continueBack';
}
