import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * The Stripe client, created once and only when billing is configured.
 *
 * ── WHY LAZY ──────────────────────────────────────────────────────────────
 *
 * Because a deployment with no Stripe keys is not a broken deployment, it is
 * the free product, and it must boot. Constructing a client at module load
 * would make importing anything in this directory require payment credentials,
 * which is how test files end up needing production secrets.
 *
 * ── AND WHY THE IMPORT IS DYNAMIC ─────────────────────────────────────────
 *
 * The `stripe` package is a dependency of the billing feature, not of the
 * product. Someone running the free version, or a test run on a clean machine,
 * should not need it installed. A static import would make it mandatory for
 * everybody the moment any route file imported this one.
 */

let client = null;

/**
 * @returns {Promise<object|null>} null when billing is not configured
 */
export async function stripeClient() {
  if (!config.stripe.enabled) return null;
  if (client) return client;

  let Stripe;
  try {
    ({ default: Stripe } = await import('stripe'));
  } catch {
    throw new Error(
      'Billing is configured but the `stripe` package is not installed. Run `npm install stripe`.'
    );
  }

  client = new Stripe(config.stripe.secretKey, {
    // Pinned rather than floating. Stripe ships breaking API changes behind
    // dated versions, and an integration that silently follows the newest one
    // is an integration that breaks on a day nobody deployed anything.
    //
    // ── WHERE THIS NUMBER COMES FROM, AND HOW TO CHECK IT ────────────────
    //
    // It is not a preference. stripe-node pins its own API version in
    // src/apiVersion.ts, and this must MATCH the version declared in
    // package.json, because the SDK's request and response handling is
    // written against that version. Pinning older than the SDK means the
    // wire format and the library disagree.
    //
    // Verified 2026-08-27 against stripe-node v22.6.0, whose
    // src/apiVersion.ts reads '2026-08-26.dahlia', and against Stripe's own
    // changelog, where Dahlia is the current major release train.
    //
    // On `npm update stripe`, re-read that file in the new version and
    // update this line in the same commit. See RUNBOOK.md.
    apiVersion: '2026-08-26.dahlia',
    // Shows up in Stripe's logs next to each request, which is what makes a
    // support conversation about a specific charge tractable.
    appInfo: { name: 'Coach Diaz', url: 'https://coachdiaz.app' },
  });
  return client;
}

/**
 * A guard for routes that cannot work without billing.
 *
 * Returns a reason rather than throwing, because "billing is switched off" is
 * a legitimate state to report to the frontend, not an error condition.
 */
export function billingUnavailableReason() {
  if (!config.stripe.enabled) {
    warnOnceAboutMissingConfig();
    return 'billing_not_configured';
  }
  return null;
}

let warned = false;

/**
 * Say WHICH variable is missing - in the log, not in the response.
 *
 * The code the client gets stays generic. Naming the specific environment
 * variables in an HTTP body tells an unauthenticated caller about the
 * deployment's configuration, and they cannot act on it anyway. The operator
 * can, so the operator gets the list.
 *
 * Once, not per request. A partially configured deployment answers every
 * billing call this way, and a line repeated on every request is a line
 * nobody reads - which is how the rate limiter sat broken for a day.
 */
function warnOnceAboutMissingConfig() {
  if (warned) return;
  warned = true;
  logger.warn('billing.not_configured', { missing: config.stripe.missing });
}
