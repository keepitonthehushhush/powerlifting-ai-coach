import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  /**
   * READ .env FROM THE REPOSITORY ROOT, NOT FROM web/.
   *
   * Vite's `envDir` defaults to the Vite project root, which for this
   * workspace is `web/` - and there is no `web/.env`. So a `VITE_` variable
   * written into the root `.env`, exactly where `.env.example` and the runbook
   * say to put it, was invisible to the build.
   *
   * It did not fail. Vite inlines a missing variable as `undefined`, Rollup
   * then sees a constant-false branch and dead-code-eliminates the feature
   * that depended on it. The Turnstile site key was set correctly in `.env`,
   * and the built bundle contained neither the key nor the loader - no error,
   * no warning, just a widget that never appeared.
   *
   * The variables that DID make it in were coming from the shell environment
   * of whichever terminal happened to have sourced `.env` earlier, which is
   * why this looked like it worked. A build whose correctness depends on what
   * a previous command exported is not reproducible.
   *
   * One `.env` at the root: the server reads it via dotenv, and now so does
   * Vite. Vercel injects its own variables and has no file, so production is
   * unaffected either way.
   */
  envDir: '..',

  /**
   * The build's identity, baked in so the running client can recognise that a
   * newer one exists.
   *
   * VERCEL_DEPLOYMENT_ID is a system variable available at build AND runtime,
   * which is what makes the comparison possible: the bundle carries the value
   * from the build that produced it, and /api/health reports the value of
   * whatever deployment is serving right now. Different means the tab is
   * running yesterday's code.
   *
   * Falls back to 'dev' locally, where there is nothing to skew against.
   */
  define: {
    __BUILD_ID__: JSON.stringify(process.env.VERCEL_DEPLOYMENT_ID ?? 'dev'),
  },
  server: {
    port: 5173,
    // Proxy /api to the local Express server so development and production
    // share one origin-relative API base path. Without this the frontend would
    // need an absolute URL in dev and a relative one in production - a
    // difference that reliably produces a bug the first time someone forgets.
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Emitted so scripts/scan-bundle-for-secrets.mjs can inspect sourcemaps as
    // well as minified output. A secret can survive minification but still be
    // plainly visible in a map file.
    sourcemap: true,
  },
});
