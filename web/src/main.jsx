import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { installCrashReporting, reportRenderCrash } from './lib/crashReporter.js';
import { paintCachedTheme } from './lib/themeCache.js';
import './styles.css';

// The boundary wraps App rather than living inside it. A boundary mounted
// inside the provider tree cannot catch a provider that throws on its first
// render, and the providers - auth, consent, i18n - are exactly where a bad
// token or a broken config surfaces.

// Installed before the first render, so a throw during the very first mount is
// caught, and so the previous page view's marker is settled before anything
// overwrites it. The boundary receives the reporter as a prop rather than
// importing it: ErrorBoundary.jsx imports React and nothing else, on purpose.
installCrashReporting();

// ── BEFORE THE FIRST RENDER, AND THAT IS THE WHOLE POINT ────────────────────
//
// The athlete's theme lives on their account, so it cannot be known until the
// session is restored and a request answers - which is why every cold start
// used to paint the default palette and then snap to theirs. A provider cannot
// fix that: by the time React's first render runs, the browser has already
// painted the stylesheet.
//
// So the last palette the account confirmed is painted here, from a local
// hint, while the module graph is still evaluating. See lib/themeCache.js for
// why that hint is not a second source of truth - nothing is ever written to
// it that the server did not just say.
paintCachedTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary onCrash={reportRenderCrash}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
