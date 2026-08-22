import { createClient } from '@supabase/supabase-js';

/**
 * The browser's Supabase client. Used for authentication only.
 *
 * Note what this client is NOT used for: reading or writing application data.
 * All domain reads and writes go through our own API, because the coaching
 * logic, the prompt assembly, and the Anthropic key all live server-side. RLS
 * would make direct browser queries safe, but routing through the API keeps a
 * single place where business rules are enforced.
 *
 * Both values below are compiled into the bundle and are public by design. The
 * publishable key grants nothing on its own - every table is behind RLS and
 * every policy requires an authenticated JWT.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.'
  );
}

export const supabase = createClient(url, key);
