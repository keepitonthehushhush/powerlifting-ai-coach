import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * THE KEY ARCHITECTURAL DECISION OF THIS BACKEND.
 *
 * There are two ways to let a Node backend talk to Supabase:
 *
 *   (a) Use the SERVICE ROLE key. It has the `bypassrls` attribute, so every
 *       query ignores Row Level Security entirely. Isolation between users
 *       then depends on the backend remembering to write
 *       `.eq('user_id', currentUser.id)` on every single query, forever, in
 *       every route anyone ever adds. One forgotten filter is a health-data
 *       breach that no test suite reliably catches, because the query still
 *       returns rows - just the wrong ones.
 *
 *   (b) Use the PUBLISHABLE key plus the end user's own JWT, forwarded on the
 *       Authorization header. PostgREST then executes the query as the
 *       `authenticated` role with `auth.uid()` bound to that user, and the RLS
 *       policies in migration 0002 filter rows inside Postgres.
 *
 * This project uses (b). The consequence is worth stating plainly: if a route
 * in this codebase runs `select * from user_profile` with no WHERE clause at
 * all, it returns exactly one row - the caller's. Authorization is enforced by
 * the database, not by the diligence of whoever writes the next route. The
 * application layer becomes incapable of leaking cross-user data even when it
 * is buggy.
 *
 * The cost of that choice, stated honestly: the service role is genuinely
 * needed for legitimate admin work (backfills, cross-user analytics, cron
 * jobs). Phase 1 has none of those, so the key is not present in the
 * environment at all. When it is eventually needed, it should live behind a
 * separate, narrowly-scoped module rather than becoming the default client.
 */
export function createUserScopedClient(accessToken) {
  return createClient(config.supabase.url, config.supabase.publishableKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      // This is a stateless request handler, not a browser. Persisting or
      // refreshing sessions here would leak one request's identity into the
      // next one on a warm serverless instance.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * A client with no user attached, executing as the `anon` role.
 *
 * ── THE ONE THING IT IS FOR ───────────────────────────────────────────────
 *
 * A guardian answering a consent link. They have no account and should not
 * need one: requiring a parent to sign up to a service they are being asked to
 * PERMIT rather than use is both hostile and worse for privacy, since it would
 * create a second account holding a second address.
 *
 * ── AND WHY IT IS NOT THE SERVICE ROLE ────────────────────────────────────
 *
 * That was the obvious alternative and it is refused. ADR-12 makes the Stripe
 * webhook the single service-role path in this product so the exception stays
 * countable; a second one turns a documented exception into a habit. This key
 * is the same publishable key the browser holds, so this client can do exactly
 * what an anonymous browser can do - which is almost nothing, by design.
 *
 * ── CORRECTION, 2026-09-15: THE PARAGRAPH BELOW WAS WRONG ────────────────
 *
 * It used to read: "What it CAN do is call `record_guardian_consent`, a
 * SECURITY DEFINER function granted to `anon` that takes a token and no user
 * id (migration 0045). The privilege is scoped to one function rather than to
 * a role that bypasses RLS, and THE TOKEN IS WHAT AUTHORIZES THE WRITE."
 *
 * Every sentence of that is true and the conclusion does not follow. The
 * REQUESTER chose the token, so the requester could always authorize
 * themselves - and the requester is a 13-to-17 year old whose guardian is
 * supposed to be the one deciding. Measured on production inside a rolled-back
 * transaction: a 15 year old produced a granted guardian consent on their own
 * account in two direct PostgREST calls. Migration 0077 revokes both guardian
 * functions from `anon` and `authenticated`; the routes use the service-role
 * client, and ADR-12 records why the exception now covers two paths.
 *
 * The lesson worth keeping: this comment reasoned carefully about WHICH CLIENT
 * may call the function and never asked WHO KNOWS THE TOKEN.
 *
 * What this client is still for: the database-reachability probe in
 * lib/databaseReachable.js, which calls a definer function that returns true
 * and touches nothing.
 */
export function createAnonymousClient() {
  return createClient(config.supabase.url, config.supabase.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
