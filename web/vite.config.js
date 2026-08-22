import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
