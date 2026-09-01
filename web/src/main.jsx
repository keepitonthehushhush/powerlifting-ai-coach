import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { installCrashReporting, reportRenderCrash } from './lib/crashReporter.js';
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary onCrash={reportRenderCrash}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
