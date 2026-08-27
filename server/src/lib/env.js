/**
 * Environment parsing and validation, as pure functions.
 *
 * Every function here takes the environment as an argument and returns a value
 * or throws. Nothing runs at import time. `config.js` is the module that
 * actually applies these to `process.env` at load, which is where the
 * fail-fast behaviour lives.
 *
 * Splitting it this way is what makes the validation testable at all: before,
 * a test that wanted to check "does this throw when ANTHROPIC_API_KEY is
 * missing?" could not import the code without triggering the very throw it
 * meant to assert on.
 */

export function required(env, name) {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in, or set it in the Vercel project settings.`
    );
  }
  return value.trim();
}

export function optional(env, name, fallback) {
  const value = env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Refuse to proceed if a server-only secret has been given a browser-visible
 * prefix. Vite compiles anything prefixed `VITE_` into the bundle, so such a
 * variable is public by construction. There is no legitimate reason for one of
 * these to exist.
 */
export function assertNoLeakedSecrets(env) {
  const forbidden = Object.keys(env).filter(
    (key) => key.startsWith('VITE_') && /ANTHROPIC|SERVICE_ROLE|SECRET|PRIVATE_KEY/i.test(key)
  );

  if (forbidden.length > 0) {
    throw new Error(
      `Refusing to start: server-only secrets are exposed to the browser bundle ` +
        `via ${forbidden.join(', ')}. Anything prefixed VITE_ is compiled into ` +
        `client-side JavaScript and is readable by every visitor. Rename these.`
    );
  }
}

/** Build the validated configuration object. Throws on anything missing. */
export function buildConfig(env) {
  assertNoLeakedSecrets(env);

  const nodeEnv = optional(env, 'NODE_ENV', 'development');

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',

    anthropic: {
      apiKey: required(env, 'ANTHROPIC_API_KEY'),
      // Deliberately configuration, not a constant. Changing coaching models is
      // then a deploy-time variable rather than a code change and a review.
      model: optional(env, 'ANTHROPIC_MODEL', 'claude-sonnet-5'),
      maxTokens: Number(optional(env, 'ANTHROPIC_MAX_TOKENS', '4096')),
    },

    supabase: {
      url: required(env, 'SUPABASE_URL'),
      // The publishable (anon) key. Safe to hold server-side: on its own it
      // grants nothing, because every table is behind RLS and every policy is
      // scoped `to authenticated`. Authority comes from the end user's JWT,
      // which we attach per request. See lib/supabase.js.
      publishableKey: required(env, 'SUPABASE_PUBLISHABLE_KEY'),

      /**
       * The service-role key. OPTIONAL, and used in exactly one place.
       *
       * See lib/supabaseAdmin.js. In short: a Stripe webhook has no user and
       * no JWT, and the subscription mirror is deliberately not writable by
       * any client. Something has to write it and that something cannot be
       * the caller.
       *
       * Optional because everything except the billing webhook works without
       * it, and because a key this powerful should be absent from every
       * environment that does not need it rather than present and unused.
       */
      secretKey: optional(env, 'SUPABASE_SECRET_KEY', ''),
    },

    chat: {
      // How much history to replay to a stateless API. Bounded so a
      // long-running conversation cannot grow the request - and the bill -
      // without limit.
      historyWindow: Number(optional(env, 'CHAT_HISTORY_WINDOW', '30')),
      // 4,000 was under a page of prose, and an athlete describing their
      // training history or pasting a program hit it without warning. The cap
      // still exists, because every character is replayed through the history
      // window on subsequent turns and paid for each time - it just should not
      // be tight enough to catch ordinary use.
      maxMessageLength: Number(optional(env, 'CHAT_MAX_MESSAGE_LENGTH', '12000')),
    },

    /**
     * Billing, and every field is OPTIONAL on purpose.
     *
     * The product works entirely without Stripe configured - logging, charts,
     * the library, the program record and the policy pages are all free, and
     * the coaching conversation is the only thing behind the paywall. So a
     * deployment with no Stripe keys is not a broken deployment, it is the
     * free product, and it must boot.
     *
     * That is not a nicety: it is how this gets developed and tested without
     * putting live payment credentials into every environment, and it is why
     * `enabled` is derived rather than declared. A half-configured Stripe -
     * a secret key with no webhook secret - is the dangerous state, because
     * the checkout would work and the webhook that grants access would not.
     * Either all four are present or billing is off.
     */
    stripe: (() => {
      const secretKey = optional(env, 'STRIPE_SECRET_KEY', '');
      const webhookSecret = optional(env, 'STRIPE_WEBHOOK_SECRET', '');
      const priceId = optional(env, 'STRIPE_PRICE_ID', '');
      const portalReturnUrl = optional(env, 'STRIPE_PORTAL_RETURN_URL', '');
      return {
        secretKey,
        webhookSecret,
        priceId,
        portalReturnUrl,
        enabled: Boolean(secretKey && webhookSecret && priceId),
        // Guards against the mistake that costs real money: pointing a
        // development deployment at live keys. `sk_live_` is Stripe's own
        // prefix and is stable.
        livemode: secretKey.startsWith('sk_live_'),
      };
    })(),
  };
}
