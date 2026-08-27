import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import './styles.css';

// The boundary wraps App rather than living inside it. A boundary mounted
// inside the provider tree cannot catch a provider that throws on its first
// render, and the providers - auth, consent, i18n - are exactly where a bad
// token or a broken config surfaces.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
