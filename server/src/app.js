import express from 'express';
import cors from 'cors';

import { requireAuth } from './middleware/requireAuth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { chatRouter } from './routes/chat.js';
import { profileRouter } from './routes/profile.js';
import { sessionsRouter } from './routes/sessions.js';
import { programRouter } from './routes/program.js';
import { libraryRouter } from './routes/library.js';
import { accountRouter } from './routes/account.js';
import { consentRouter } from './routes/consent.js';
import { billingRouter } from './routes/billing.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { achievementsRouter } from './routes/achievements.js';
import { billingWebhookRouter } from './routes/billingWebhook.js';
import { initMonitoring } from './lib/monitoring.js';
import { logger } from './lib/logger.js';
import { config } from './config.js';
import { PAID_FEATURE } from './lib/entitlement.js';

/**
 * The Express application, built as a plain app object with no server.listen()
 * and no platform-specific code.
 *
 * That separation is the point. api/index.js adapts this app to Vercel's
 * serverless runtime; server/dev.js binds it to a local port. Neither the
 * routes nor the middleware know which is running them, so moving this to a
 * container on Railway or Fly later is an entrypoint change, not a rewrite.
 * Choosing serverless first was a deployment decision, not an architectural
 * commitment - see ARCHITECTURE.md, ADR-3.
 */
export function createApp() {
  const app = express();

  // Fire and forget: monitoring must never delay or block a request, and the
  // app is fully functional without it.
  initMonitoring().then((status) => {
    if (status.enabled) logger.info('monitoring.enabled');
    else logger.info('monitoring.disabled', { reason: status.reason });
  });

  /**
   * Say what the paywall is doing, once, at startup.
   *
   * A paywall is the kind of setting whose state you want stated rather than
   * inferred from whether anybody is complaining. The misconfigured case -
   * PAYWALL_ENABLED with no Stripe configuration - is an error rather than a
   * warning: it means somebody intended to charge and cannot, and the app has
   * silently kept everyone on the free product to avoid locking a door with no
   * handle. That is the right behavior and the wrong situation.
   */
  if (config.paywall.testKeysInProduction) {
    logger.error('paywall.test_keys_in_production', {
      effect: 'paywall left OFF - a test-mode checkout accepts no real card, so this would have locked everybody out with no way to pay',
    });
  } else if (config.paywall.misconfigured) {
    logger.error('paywall.misconfigured', {
      missing: config.stripe.missing,
      effect: 'paywall left OFF - coaching stays available to everyone',
    });
  } else if (config.paywall.active) {
    logger.info('paywall.active', { feature: PAID_FEATURE });
  } else {
    logger.info('paywall.inactive');
  }

  app.disable('x-powered-by');

  /**
   * Nothing this API returns may be stored by anything.
   *
   * Two reasons, and the weaker one is the one that made it urgent.
   *
   * PRIVACY, which is the real reason: every authenticated response here is
   * one person's data, and several of them carry consumer health data - the
   * profile, the export, the coaching conversation. A response held in a
   * browser's disk cache or by any intermediary is that data at rest
   * somewhere nobody has reasoned about. `no-store` is the only correct
   * answer for an API like this one, and it should have been here from the
   * start.
   *
   * CORRECTNESS, which is how it was found: Express computes an ETag for
   * every JSON response by default, so a repeat request came back 304 Not
   * Modified with no body. The client treated any non-2xx as a failure, so a
   * 304 on /api/consent became "Request failed with status 304" and left the
   * consent gate in a state it could not leave - a permanent spinner on a
   * page whose data was, in fact, perfectly fine.
   *
   * Turning ETags off removes the conditional-request path entirely rather
   * than teaching every client to handle it.
   */
  app.disable('etag');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    next();
  });

  /**
   * THE STRIPE WEBHOOK MOUNTS BEFORE THE JSON PARSER, AND BEFORE requireAuth.
   *
   * Both are deliberate and both are load-bearing.
   *
   * Before express.json() because the signature Stripe sends is an HMAC over
   * the exact BYTES of the body. A parsed-then-restringified body is not the
   * same bytes - key order and whitespace both move - so verification fails
   * with an error that looks exactly like a wrong secret. The route brings its
   * own express.raw().
   *
   * Before requireAuth because Stripe is not logged in and never will be. The
   * signature is what replaces authentication, and it is stronger than a
   * session for this purpose: it proves the message came from Stripe, which a
   * bearer token could not.
   *
   * Mounting it here rather than punching an exception into requireAuth keeps
   * the guard's property intact - everything under /api is authenticated
   * unless it is visibly, explicitly, above this line.
   */
  app.use('/api/billing/webhook', billingWebhookRouter);

  app.use(express.json({ limit: '256kb' }));

  // In production the frontend is served from the same Vercel origin, so no
  // cross-origin request occurs at all. CORS exists purely so the Vite dev
  // server on :5173 can talk to the API on :3001, and is scoped accordingly.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    })
  );

  // Unauthenticated: a liveness probe that touches nothing and reveals nothing.
  /**
   * Health, plus the identity of the deployment answering.
   *
   * The client compares this against the id compiled into its own bundle. When
   * they differ, the person is looking at a page built by an older deployment
   * - which is exactly the situation where a refresh mid-fix produces
   * behavior nobody can explain, because the JavaScript in the tab and the
   * API answering it are from different commits.
   *
   * Unauthenticated on purpose: it is already the maintenance page's poll
   * target, and a deployment id is not a secret.
   */
  app.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? 'dev',
      /*
       * ── WHY THE OUTPUT BUDGET IS PUBLISHED HERE ───────────────────────────
       *
       * On 2026-08-30 the safety evaluation was found to be running at
       * max_tokens 2048 while production ran on ANTHROPIC_MAX_TOKENS. Five of
       * its sixteen scenarios failed as a result, one of them on a real
       * assertion, because replies were being cut off before they reached the
       * part the assertion was about. Reading the same variable fixed it and
       * the suite went to 48/48.
       *
       * That fix is only half of one. The eval reads the budget from the
       * developer's .env; production reads it from the Vercel project. Nothing
       * compares the two, so the suite can go green against a budget the
       * deployed coach does not have - which is the same defect wearing a
       * different hat.
       *
       * A token ceiling is an operational number, not a secret: it says how
       * long a reply may be. It reveals nothing about the prompt, the key or
       * any athlete, and deploymentId - already here - is the same kind of
       * fact. scripts/verify-deployment.mjs reads this and compares it against
       * the local value, so the two can no longer drift in silence.
       */
      maxOutputTokens: config.anthropic.maxTokens,
    }));

  // Everything past this line requires a verified session. Applying requireAuth
  // to the whole /api surface at once, rather than route by route, means a new
  // router added later is protected by default. Forgetting to add auth is the
  // easy mistake; this makes forgetting the safe outcome.
  app.use('/api', requireAuth);

  // Rate limits are applied per router rather than globally, because the
  // buckets differ by cost: a model call is expensive, a profile write is not,
  // and a full data export is expensive in a different way.
  app.use('/api/chat', rateLimit('chat'), rateLimit('chat_daily'), chatRouter);
  // Rate limited on the write bucket: creating checkout sessions is cheap for
  // us and not free for Stripe, and a loop here is somebody's bad afternoon.
  app.use('/api/billing', rateLimit('write'), billingRouter);
  app.use('/api/leaderboard', rateLimit('write'), leaderboardRouter);
  // 'write', not a new 'read' bucket. consume_rate_limit() knows four buckets -
  // chat, chat_daily, write, export - and raises on anything else. The
  // middleware catches that, logs, and calls next(), so an invented bucket name
  // produces an unlimited endpoint that writes an error line on every request.
  // Adding a bucket means changing the function, not the call site.
  app.use('/api/achievements', rateLimit('write'), achievementsRouter);
  app.use('/api/profile', rateLimit('write'), profileRouter);
  app.use('/api/sessions', rateLimit('write'), sessionsRouter);
  app.use('/api/program', programRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/account', accountRouter);
  // Not rate limited as a write: a user must always be able to withdraw
  // consent, and MHMDA requires withdrawal to be no harder than granting.
  app.use('/api/consent', consentRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
