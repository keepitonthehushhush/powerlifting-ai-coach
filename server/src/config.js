import { buildConfig } from './lib/env.js';

/**
 * The application's configuration, validated once at module load.
 *
 * The validation itself lives in lib/env.js as pure functions; this module is
 * the single place that applies them to the real process environment. That
 * separation is deliberate - see the note in lib/env.js - but the fail-fast
 * property is preserved here: importing this module throws immediately if the
 * environment is incomplete.
 *
 * Why fail fast at all: a missing ANTHROPIC_API_KEY should crash the process at
 * cold start, loudly, rather than surfacing as a confusing 500 on the first
 * user's first message.
 *
 * Nothing that only needs a type, a class, or a pure helper should import this
 * module. If a test cannot run without production secrets, something imported
 * config.js that did not need to.
 */
export const config = buildConfig(process.env);
