import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { missingConfig } from './lib/config.js';
import { ConfigError } from './components/ConfigError.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ConsentProvider } from './context/ConsentContext.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Login } from './pages/Login.jsx';
import { Intake } from './pages/Intake.jsx';
import { Chat } from './pages/Chat.jsx';
import { LogSession } from './pages/LogSession.jsx';
import { Account } from './pages/Account.jsx';
import { Consent } from './pages/Consent.jsx';
import { HealthDataPolicy } from './pages/HealthDataPolicy.jsx';
import { Terms } from './pages/Terms.jsx';
import { AiProcessing } from './pages/AiProcessing.jsx';

export function App() {
  // Checked before any provider mounts. Nothing below this point can start
  // without configuration, so failing here produces a readable screen instead
  // of an empty body.
  const missing = missingConfig();
  if (missing.length > 0) return <ConfigError missing={missing} />;

  return (
    <I18nProvider>
      <AuthProvider>
        <ConsentProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/intake"
                element={
                  <ProtectedRoute>
                    <Intake />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/log"
                element={
                  <ProtectedRoute>
                    <LogSession />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach"
                element={
                  <ProtectedRoute>
                    <Chat />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/consent"
                element={
                  <ProtectedRoute requireConsent={false}>
                    <Consent />
                  </ProtectedRoute>
                }
              />
              {/* Policies are reachable without signing in: people are entitled
                  to read what they would be agreeing to before they agree.
                  Every consent type has one, and web/src/lib/policyDocuments.js
                  is the mapping a test holds the router to. */}
              <Route path="/policies/terms" element={<Terms />} />
              <Route path="/policies/ai-processing" element={<AiProcessing />} />
              <Route path="/policies/health-data" element={<HealthDataPolicy />} />
              {/* The old path, kept so links already in the wild still land. */}
              <Route path="/privacy/health-data" element={<Navigate to="/policies/health-data" replace />} />
              <Route
                path="/account"
                element={
                  <ProtectedRoute requireConsent={false}>
                    <Account />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/coach" replace />} />
            </Routes>
          </BrowserRouter>
        </ConsentProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
