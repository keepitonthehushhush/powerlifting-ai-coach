import express from 'express';
import cors from 'cors';

import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { chatRouter } from './routes/chat.js';
import { profileRouter } from './routes/profile.js';
import { sessionsRouter } from './routes/sessions.js';
import { libraryRouter } from './routes/library.js';

/**
 * The Express application, built as a plain app object with no server.listen()
 * and no platform-specific code.
 *
 * That separation is the point. api/index.js adapts this app to Vercel's
 * serverless runtime; server/dev.js binds it to a local port. Neither the
 * routes nor the middleware know which is running them, so moving this to a
 * container on Railway or Fly later is an entrypoint change, not a rewrite.
 * Choosing serverless first was a deployment decision, not an architectural
 * commitment - see ARCHITECTURE.md.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
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
    })
  );

  // Unauthenticated: a liveness probe that touches nothing and reveals nothing.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Everything past this line requires a verified session. Applying requireAuth
  // to the whole /api surface at once, rather than route by route, means a new
  // router added later is protected by default. Forgetting to add auth is the
  // easy mistake; this makes forgetting the safe outcome.
  app.use('/api', requireAuth);

  app.use('/api/chat', chatRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/library', libraryRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
