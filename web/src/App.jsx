import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { missingConfig } from './lib/config.js';
import { ConfigError } from './components/ConfigError.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Login } from './pages/Login.jsx';
import { Intake } from './pages/Intake.jsx';
import { Chat } from './pages/Chat.jsx';
import { Account } from './pages/Account.jsx';
import { Consent } from './pages/Consent.jsx';
import { HealthDataPolicy } from './pages/HealthDataPolicy.jsx';

export function App() {
  // Checked before any provider mounts. Nothing below this point can start
  // without configuration, so failing here produces a readable screen instead
  // of an empty body.
  const missing = missingConfig();
  if (missing.length > 0) return <ConfigError missing={missing} />;

  return (
    <I18nProvider>
      <AuthProvider>
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
                <ProtectedRoute>
                  <Consent />
                </ProtectedRoute>
              }
            />
            {/* The policy is reachable without signing in: people are entitled
                to read what they would be agreeing to before they agree. */}
            <Route path="/privacy/health-data" element={<HealthDataPolicy />} />
            <Route
              path="/account"
              element={
                <ProtectedRoute>
                  <Account />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/coach" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
