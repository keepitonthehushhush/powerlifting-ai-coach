import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A SECOND build, for the review harness, and deliberately not part of the
 * first one.
 *
 * The harness stubs `supabase.auth.getSession` to return a signed-in session.
 * That is exactly what makes it useful and exactly why its output must never
 * reach production: a page that hands itself a session is not a page that
 * belongs on a public origin, even one that can only ever render fixtures.
 *
 * So it gets its own entry, its own outDir, and no place in `npm run build`.
 * `harness-dist/` is gitignored - the SOURCE is reviewable in the repository,
 * the artifact is built on demand by whoever is looking.
 */
export default defineConfig({
  root: 'harness',
  plugins: [react()],
  envDir: '../..',
  define: {
    __BUILD_ID__: JSON.stringify('harness'),
    __VERCEL_ENV__: JSON.stringify('development'),
  },
  build: {
    outDir: '../harness-dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
