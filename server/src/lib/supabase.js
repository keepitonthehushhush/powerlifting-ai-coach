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
 * all, it returns exactly one row - the caller's. Authorisation is enforced by
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
