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
import { config } from './config.js';

// Deliberately no throw here. A missing variable is surfaced by App.jsx as a
// readable screen; throwing at module load prevented React from mounting at
// all and produced a blank page with no explanation. See lib/config.js.
export const supabase = createClient(
  config.supabaseUrl ?? 'https://placeholder.invalid',
  config.supabasePublishableKey ?? 'placeholder'
);
