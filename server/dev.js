/**
 * Local development entrypoint.
 *
 * Loads .env (which Vercel does for you in production, hence the dev-only
 * dependency) and binds the same Express app to a port.
 */
import 'dotenv/config';
import { createApp } from './src/app.js';
import { logger } from './src/lib/logger.js';

const port = Number(process.env.PORT) || 3001;

createApp().listen(port, () => {
  logger.info('server.listening', { port, url: `http://localhost:${port}` });
});
