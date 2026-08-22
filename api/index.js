/**
 * Vercel serverless entrypoint.
 *
 * Vercel's Node runtime invokes the default export with (req, res). An Express
 * app IS such a function, so adapting one is a re-export. vercel.json rewrites
 * every /api/* path here, and Express does the routing from there.
 *
 * The app is created at module scope so a warm instance reuses the same
 * routers, Anthropic connection pool, and validated config across invocations
 * instead of rebuilding them per request.
 */
import { createApp } from '../server/src/app.js';

const app = createApp();

export default app;
