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
import { initMonitoring } from './lib/monitoring.js';
import { logger } from './lib/logger.js';

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
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Everything past this line requires a verified session. Applying requireAuth
  // to the whole /api surface at once, rather than route by route, means a new
  // router added later is protected by default. Forgetting to add auth is the
  // easy mistake; this makes forgetting the safe outcome.
  app.use('/api', requireAuth);

  // Rate limits are applied per router rather than globally, because the
  // buckets differ by cost: a model call is expensive, a profile write is not,
  // and a full data export is expensive in a different way.
  app.use('/api/chat', rateLimit('chat'), rateLimit('chat_daily'), chatRouter);
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
