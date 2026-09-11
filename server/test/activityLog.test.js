import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, latestDefinition } from './helpers/source.js';

/**
 * THE CARD THAT SHOWED EIGHT ROWS OF `activity.action.clearance_asserted`.
 *
 * ── HOW A LIVE BUG SURVIVED EVERY TEST IN THIS SUITE ───────────────────────
 *
 * ActivityLog.jsx renders `t(`activity.action.${event.action}`)`, and the
 * catalog had three of the five actions the database could produce. t() returns
 * the KEY when it does not recognize one, on purpose - a visible
 * `intake.goal.label` is a bug report and a blank string is a mystery.
 *
 * The i18n guard could not see it: the key is computed, the branch it looks
 * inside existed, and every key in that branch was used. Nothing compared the
 * branch against the set of values that can actually arrive.
 *
 * On 2026-09-11 production held eight audit rows and every one of them was
 * `clearance_asserted` - so the only thing this card had EVER rendered was a
 * translation key, and it had been doing it for however long the clearance flow
 * has been live. Found by asking the table what was in it rather than by
 * reading the component.
 *
 * This test is the missing comparison. The audit constraint is the list of
 * actions that can exist; both catalogs must have a sentence for every one.
 */

const ACTIONS = [...latestDefinition('constraint audit_events_action_check').body
  .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readSource(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
const component = readSource(new URL('../../web/src/components/ActivityLog.jsx', import.meta.url));

describe('every action the database can record has a sentence', () => {
  test('the constraint was actually parsed', () => {
    // A regex that stops matching turns every assertion below into a passing
    // loop over nothing, which is the shape of the bug this file is about.
    assert.ok(ACTIONS.length >= 5, `parsed ${ACTIONS.length} actions - the regex is wrong`);
    assert.ok(ACTIONS.includes('clearance_asserted'));
  });

  for (const action of ['data_exported', 'account_deleted', 'subscription_changed', 'clearance_asserted', 'mfa_factor_removed', 'tracker_connected', 'tracker_disconnected']) {
    test(`${action} reads as a sentence in both languages`, () => {
      assert.match(en, new RegExp(`\\n\\s+${action}: '`), `en has no sentence for ${action}`);
      assert.match(es, new RegExp(`\\n\\s+${action}: '`), `es has no sentence for ${action}`);
    });
  }

  test('and the list is checked against the constraint, not against itself', () => {
    /*
     * The pinned list above exists so that a NEW action fails here loudly with
     * its own name. This assertion is what makes the pinned list honest: add an
     * action to the constraint without a sentence and the two disagree.
     */
    const missing = ACTIONS.filter((action) => !new RegExp(`\\n\\s+${action}: '`).test(en));
    assert.deepEqual(missing, [], `the audit constraint permits actions the activity card cannot name: ${missing.join(', ')}`);
  });

  test('the card renders the action and nothing else from the row', () => {
    // detail is selected by the route and deliberately not rendered: it is a
    // jsonb column whose contents are not shaped for a reader.
    assert.match(component, /t\(`activity\.action\.\$\{event\.action\}`\)/);
    assert.doesNotMatch(component, /event\.detail/);
  });
});
