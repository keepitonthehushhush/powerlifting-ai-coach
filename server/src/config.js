/**
 * Configuration, validated once at module load.
 *
 * Two things happen here that are worth understanding:
 *
 * 1. FAIL FAST. A missing ANTHROPIC_API_KEY should crash the process on boot,
 *    not surface as a confusing 500 on the first user's first message. In a
 *    serverless deployment this means a misconfigured environment fails at
 *    cold start, loudly, instead of degrading quietly in production.
 *
 * 2. THE LEAK GUARD. Vite compiles any variable prefixed `VITE_` directly into
 *    the browser bundle. If someone ever names the Anthropic key
 *    `VITE_ANTHROPIC_API_KEY` - a completely natural mistake when wiring up a
 *    new environment - the key ships to every visitor. assertNoLeakedSecrets()
 *    turns that mistake into a boot failure rather than a breach. It is
 *    belt-and-braces alongside scripts/scan-bundle-for-secrets.mjs, which
 *    checks the built output for the same thing.
 */

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in, or set it in the Vercel project settings.`
    );
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Refuse to boot if a server-only secret has been given a browser-visible
 * prefix. There is no legitimate reason for any of these to exist.
 */
export function assertNoLeakedSecrets(env = process.env) {
  const forbidden = Object.keys(env).filter(
    (key) =>
      key.startsWith('VITE_') &&
      /ANTHROPIC|SERVICE_ROLE|SECRET|PRIVATE_KEY/i.test(key)
  );

  if (forbidden.length > 0) {
    throw new Error(
      `Refusing to start: server-only secrets are exposed to the browser bundle ` +
        `via ${forbidden.join(', ')}. Anything prefixed VITE_ is compiled into ` +
        `client-side JavaScript and is readable by every visitor. Rename these.`
    );
  }
}

assertNoLeakedSecrets();

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
    // Deliberately configuration, not a constant. Changing coaching models is
    // then a deploy-time variable rather than a code change and a review.
    model: optional('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    maxTokens: Number(optional('ANTHROPIC_MAX_TOKENS', '4096')),
  },

  supabase: {
    url: required('SUPABASE_URL'),
    // The publishable (anon) key. Safe to hold server-side: on its own it
    // grants nothing, because every table is behind RLS and every policy is
    // scoped `to authenticated`. Authority comes from the end user's JWT,
    // which we attach per request. See lib/supabase.js.
    publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  },

  chat: {
    // How much history to replay to a stateless API. Bounded so a long-running
    // conversation cannot grow the request - and the bill - without limit.
    historyWindow: Number(optional('CHAT_HISTORY_WINDOW', '30')),
    maxMessageLength: Number(optional('CHAT_MAX_MESSAGE_LENGTH', '4000')),
  },
};
