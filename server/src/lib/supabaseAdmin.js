import { config } from '../config.js';

/**
 * A Supabase client with elevated privileges. USED IN EXACTLY ONE PLACE.
 *
 * ── THIS IS AN EXCEPTION TO ADR-1, AND IT IS SCOPED ON PURPOSE ────────────
 *
 * ADR-1 says the backend authenticates as the user, never as an admin: every
 * query carries the caller's JWT and RLS decides what it can see. That is the
 * single most important security property in this codebase and it is why a
 * prompt injection cannot reach another athlete's rows.
 *
 * A Stripe webhook has no user. Stripe is not logged in, holds no JWT, and the
 * row it needs to write - the subscription mirror - is deliberately not
 * writable by any client, because a client that could write it could grant
 * itself a subscription. Something has to be able to write it, and that
 * something cannot be the caller.
 *
 * So: a service-role client, and the containment is that it exists only here
 * and is imported only by the webhook handler. A test asserts that. If a
 * second importer ever appears, the exception has stopped being an exception
 * and the decision needs revisiting rather than extending.
 *
 * ── WHAT MAKES THIS SAFE ENOUGH ───────────────────────────────────────────
 *
 * The webhook is not an open door. It rejects anything without a valid Stripe
 * signature computed over the raw body with a secret only Stripe and we hold,
 * and it refuses to process an event id it has already seen. So the path to
 * this client requires forging a signature, and the blast radius if you did is
 * one subscription row - not the health data, which stays behind RLS because
 * nothing in the webhook path touches it.
 *
 * ── IF THE KEY IS ABSENT ──────────────────────────────────────────────────
 *
 * Returns null, and the webhook reports that it cannot record state rather
 * than crashing. A missing key must be visible in a log, not a 500 loop that
 * makes Stripe retry for three days.
 */

let client = null;

export async function supabaseAdmin() {
  const key = config.supabase.secretKey;
  if (!key) return null;
  if (client) return client;

  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(config.supabase.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
