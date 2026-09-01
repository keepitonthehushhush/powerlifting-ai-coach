/**
 * Environment parsing and validation, as pure functions.
 *
 * Every function here takes the environment as an argument and returns a value
 * or throws. Nothing runs at import time. `config.js` is the module that
 * actually applies these to `process.env` at load, which is where the
 * fail-fast behavior lives.
 *
 * Splitting it this way is what makes the validation testable at all: before,
 * a test that wanted to check "does this throw when ANTHROPIC_API_KEY is
 * missing?" could not import the code without triggering the very throw it
 * meant to assert on.
 */

import { resolveMaxTokens } from './modelBudget.js';

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
   *
   * ── AND THE SERVICE-ROLE KEY IS PART OF "CONFIGURED" ─────────────────
   *
   * This originally derived `enabled` from the three Stripe values, which
   * described the danger exactly and then failed to guard against it. With
   * all three Stripe keys set and SUPABASE_SECRET_KEY empty, billing reports
   * itself enabled, checkout completes, the card is charged, Stripe delivers
   * the webhook - and supabaseAdmin() returns null, so the subscription is
   * never recorded and the athlete never gets what they paid for. The
   * webhook answers 200 and logs, correctly, so Stripe does not retry: the
   * money moves and nothing anywhere is red.
   *
   * That is the worst failure this file can produce, and it was one
   * environment variable away. The service-role key is not incidental to
   * billing; it is the only thing that can write the row billing exists to
   * write. So it counts.
   */
  const stripe = (() => {
    const secretKey = optional(env, 'STRIPE_SECRET_KEY', '');
    const webhookSecret = optional(env, 'STRIPE_WEBHOOK_SECRET', '');
    const priceId = optional(env, 'STRIPE_PRICE_ID', '');
    const portalReturnUrl = optional(env, 'STRIPE_PORTAL_RETURN_URL', '');
    // Read again rather than reaching across to config.supabase: this is a
    // sibling property of the same object literal and does not exist yet.
    const serviceRoleKey = optional(env, 'SUPABASE_SECRET_KEY', '');

    /**
     * Which piece is missing, so the 503 and the startup log can say. A
     * generic "not configured" sends somebody to check all four.
     */
    const missing = [
      ['STRIPE_SECRET_KEY', secretKey],
      ['STRIPE_WEBHOOK_SECRET', webhookSecret],
      ['STRIPE_PRICE_ID', priceId],
      ['SUPABASE_SECRET_KEY', serviceRoleKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    return {
      secretKey,
      webhookSecret,
      priceId,
      portalReturnUrl,
      missing,
      // All four, not three. See above.
      enabled: missing.length === 0,
      // Guards against the mistake that costs real money: pointing a
      // development deployment at live keys. `sk_live_` is Stripe's own
      // prefix and is stable.
      livemode: secretKey.startsWith('sk_live_'),
    };
  })();

  /**
   * IS THE PAYWALL ON? A SEPARATE QUESTION FROM "CAN WE TAKE MONEY".
   *
   * Conflating the two would be a mistake with a public cost. The FAQ says,
   * live, today: "It is free while it is being built and tested." Deriving the
   * paywall from `stripe.enabled` would mean that the moment Stripe keys land
   * in an environment - which is exactly what you do to TEST checkout - every
   * existing athlete loses the coaching conversation, with no deploy that
   * looks like a decision and no change to the sentence promising otherwise.
   *
   * So it is its own switch, off unless someone deliberately turns it on, and
   * turning it on is the commit where the FAQ sentence changes too. A test
   * holds those two together.
   *
   * ── AND IT CANNOT BE ON WITHOUT A WAY TO PAY ────────────────────────────
   *
   * PAYWALL_ENABLED with no Stripe configuration is a locked door with no
   * handle: the athlete is told to subscribe and the subscribe button returns
   * 503. That is a misconfiguration, and the safe direction is unambiguous -
   * people keep access. It is logged as an error rather than thrown, because
   * refusing to boot would turn a billing mistake into a total outage, and the
   * coaching is the part that matters.
   */
  /**
   * Coaching 13 to 17 year olds, with a guardian's consent. Off by default.
   *
   * ── WHY THIS IS A SWITCH AND NOT A DEPLOY ─────────────────────────────
   *
   * The same reasoning as the paywall. Writing the code is not the decision to
   * ship it, and here the decision has a prerequisite that no amount of code
   * satisfies: the Terms and the health-data policy both still say this
   * service is for adults. Turning this on while they say that puts the
   * documents and the code back into disagreement, which is the exact failure
   * that produced the adult gate in the first place. See docs/UNDER_18.md.
   *
   * While it is off, `adultGateDecision` behaves exactly as it did before any
   * of this existed - 18 and over, one reason code - so the flag is the only
   * thing standing between the two behaviors and it is testable in both
   * positions.
   *
   * There is no misconfiguration branch of the paywall's kind, because the
   * failure mode is not symmetrical: turning this on before the guardian
   * consent flow exists refuses a minor with `guardian_consent_required`
   * instead of `too_young`, which is a better message for a refusal that
   * still happens. Nobody is let in by mistake.
   */
  const minors = {
    enabled: optional(env, 'MINORS_ENABLED', 'false').trim().toLowerCase() === 'true',
  };

  /**
   * SMTP, for the one message this product sends.
   *
   * Optional, and its absence is a normal state rather than an error: local
   * development and every test run have no SMTP, and the rest of the product
   * does not need it. What it must NOT do is fail quietly - see mailer.js.
   * If the guardian mail cannot go, the athlete is left waiting for something
   * that will never arrive, so the route reports it instead of pretending.
   *
   * `from` falls back to the user, because most providers reject a From that
   * is not the authenticated mailbox and the resulting bounce is opaque.
   */
  const smtp = (() => {
    const host = optional(env, 'SMTP_HOST', '').trim();
    const user = optional(env, 'SMTP_USER', '').trim();
    const pass = optional(env, 'SMTP_PASSWORD', '');
    const port = Number.parseInt(optional(env, 'SMTP_PORT', '587'), 10);
    return {
      host,
      user,
      pass,
      port: Number.isFinite(port) ? port : 587,
      from: optional(env, 'SMTP_FROM', '').trim() || user,
      configured: Boolean(host && user && pass),
    };
  })();

  /**
   * Where a guardian consent link points.
   *
   * It goes in an email, so it cannot be a relative path and it cannot be
   * guessed from the request - the request that creates it comes from the
   * ATHLETE'S browser, and Host is attacker-controllable in general. An
   * explicit origin is one variable and no ambiguity.
   */
  const publicOrigin = optional(env, 'PUBLIC_ORIGIN', 'https://coachdiaz.app').trim().replace(/\/+$/, '');

  const paywall = (() => {
    const requested = optional(env, 'PAYWALL_ENABLED', 'false').trim().toLowerCase() === 'true';

    /**
     * ── A PAYWALL IN TEST MODE IS A LOCKED DOOR IN PRODUCTION ────────────
     *
     * `stripe.livemode` was computed and used by NOTHING. So the guard above
     * caught "paywall on, no Stripe keys" and missed the worse case: paywall
     * on, TEST keys, in production. Coaching gated behind a subscribe button
     * that opens a checkout accepting only 4242 4242 4242 4242. Every real
     * person is locked out and none of them can pay, and it looks completely
     * healthy from the operator's side because the button works.
     *
     * That is the same failure the no-keys branch exists to prevent, so it
     * gets the same answer: the paywall stays off and it is logged.
     *
     * Outside production the opposite is wanted - test keys are exactly how
     * you exercise the paywall end to end - so the check is scoped to
     * production rather than applied everywhere.
     */
    const testKeysInProduction = requested && stripe.enabled && !stripe.livemode
      && nodeEnv === 'production';

    return {
      requested,
      active: requested && stripe.enabled && !testKeysInProduction,
      misconfigured: requested && !stripe.enabled,
      testKeysInProduction,
    };
  })();


  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',

    anthropic: {
      apiKey: required(env, 'ANTHROPIC_API_KEY'),
      // Deliberately configuration, not a constant. Changing coaching models is
      // then a deploy-time variable rather than a code change and a review.
      model: optional(env, 'ANTHROPIC_MODEL', 'claude-sonnet-5'),
      /*
       * 8192, raised from 4096 after a reply hit the ceiling in production and
       * came back with nothing in it at all.
       *
       * This is a CEILING, not a spend: output tokens are billed as generated,
       * so a cap that is never reached costs nothing. What it does buy is a
       * program that runs to the end of the week instead of stopping on
       * Thursday. Claude Sonnet 5 permits up to 128K output tokens, so the
       * limit here is ours and it is about latency, not capability - a reply
       * the athlete waits three minutes for is its own failure, and the client
       * abort is sized for the current one.
       *
       * Raising it does not fix a reply that produced NO text; it makes the
       * truncation rarer. coachOutcome.js handles the case where it still
       * happens, and the prompt no longer asks for a whole program when an
       * athlete corrects a single number.
       */
      maxTokens: resolveMaxTokens(env),
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

    stripe,
    paywall,
    minors,
    smtp,
    publicOrigin,
  };
}
