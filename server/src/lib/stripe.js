import { config } from '../config.js';

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
    apiVersion: '2025-08-27.basil',
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
  if (!config.stripe.enabled) return 'billing_not_configured';
  return null;
}
