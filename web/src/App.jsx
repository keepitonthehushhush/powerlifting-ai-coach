import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { config, missingConfig, misconfigured } from './lib/config.js';
import { isPreviewBuild, previewPointsAtProduction } from './lib/environment.js';
import { ConfigError } from './components/ConfigError.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ConsentProvider } from './context/ConsentContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { MfaProvider } from './context/MfaContext.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { ScrollToTop } from './components/ScrollToTop.jsx';
import { Home } from './pages/Home.jsx';
import { EasterEggs } from './components/EasterEggs.jsx';
import { Login } from './pages/Login.jsx';
import { Intake } from './pages/Intake.jsx';
import { Chat } from './pages/Chat.jsx';
import { LogSession } from './pages/LogSession.jsx';
import { Account } from './pages/Account.jsx';
import { Consent } from './pages/Consent.jsx';
import { Library } from './pages/Library.jsx';
import { Leaderboard } from './pages/Leaderboard.jsx';
import { NewVersionBanner } from './components/NewVersionBanner.jsx';
import { LeaderboardPolicy } from './pages/LeaderboardPolicy.jsx';
import { Progress } from './pages/Progress.jsx';
import { Program } from './pages/Program.jsx';
import { HealthDataPolicy } from './pages/HealthDataPolicy.jsx';
import { Terms } from './pages/Terms.jsx';
import { PrivacyPolicy } from './pages/PrivacyPolicy.jsx';
import { ResetPassword } from './pages/ResetPassword.jsx';
import { ForYourClinician } from './pages/ForYourClinician.jsx';
import { Faq } from './pages/Faq.jsx';
import { AiProcessing } from './pages/AiProcessing.jsx';

export function App() {
  // Checked before any provider mounts. Nothing below this point can start
  // without configuration, so failing here produces a readable screen instead
  // of an empty body.
  const missing = missingConfig();
  if (missing.length > 0) return <ConfigError missing={missing} />;

  // A variable that is set to the wrong thing fails as loudly as one that is
  // absent. Without this the app boots, the login screen works - it talks to
  // Supabase directly - and every other feature 404s, which puts the symptom
  // nowhere near the cause.
  const wrong = misconfigured();
  if (wrong.length > 0) return <ConfigError problems={wrong} />;

  /**
   * A preview build compiled against the production database.
   *
   * Blocking, not a banner. `VITE_SUPABASE_URL` is baked into this bundle, so
   * the browser talks to whatever it was built with regardless of what the API
   * is configured with - the server refusing to serve does not stop Supabase
   * Auth or a direct PostgREST call from this page. The only place this can be
   * stopped is here, before anything mounts.
   *
   * A warning somebody can scroll past is a warning somebody scrolls past, and
   * on the other side of this one are real athletes' rows.
   */
  if (previewPointsAtProduction(config.supabaseUrl)) {
    return (
      <ConfigError
        problems={[
          'This is a PREVIEW build and it was compiled against the PRODUCTION database. ' +
            'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the Preview ' +
            'environment in the Vercel dashboard, then redeploy the branch. Nothing is ' +
            'rendered until then, deliberately.',
        ]}
      />
    );
  }

  return (
    <I18nProvider>
      <AuthProvider>
        <ThemeProvider>
        <MfaProvider>
        <ConsentProvider>
          <BrowserRouter>
            {/* Inside the router because it reads the router's own history,
                and above the routes because it has to run for every one of
                them. It renders nothing; see the component for why it keys on
                location.key and leaves the browser's back button alone. */}
            <ScrollToTop />
            {/* Mounted once, above the router: the eggs belong to the product
                rather than to any one page. */}
            <EasterEggs />
            {/* Says which build this is, on every preview, always. Confusing a
                preview tab for the live site is the mistake a preview
                environment makes possible, and it is made by looking at a page
                that is identical to production in every other way. */}
            {isPreviewBuild() && (
              <p className="preview-badge" role="status">
                Preview build — not coachdiaz.app
              </p>
            )}
            <NewVersionBanner />
            <Routes>
              {/* The front door. Public, and NOT behind a session check:
                  `/` used to fall through the catch-all to /coach, which is
                  protected, so an anonymous visitor's first sight of this
                  product was a password field. */}
              <Route path="/" element={<Home />} />
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
                path="/leaderboard"
                element={
                  <ProtectedRoute>
                    <Leaderboard />
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
              {/* Outside ProtectedRoute on purpose. Somebody arriving from a
                  recovery email has no session at the moment the router first
                  runs, so a redirect to /login would discard the token in the
                  URL before it could be exchanged - and would be circular
                  anyway, since /login is what they cannot get through. */}
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Public, and that is the point: a page you must create an
                  account to read is useless to a physical therapist holding a
                  phone in a treatment room. */}
              <Route path="/about" element={<ForYourClinician />} />

              {/* Public for the same reason: the person with the most
                  questions is the one who has not signed up yet, and making
                  them create an account to find out what happens to their
                  data is exactly backwards. */}
              <Route path="/faq" element={<Faq />} />

              <Route path="/policies/privacy" element={<PrivacyPolicy />} />
              <Route path="/policies/terms" element={<Terms />} />
              <Route path="/policies/ai-processing" element={<AiProcessing />} />
              <Route path="/policies/health-data" element={<HealthDataPolicy />} />
              <Route path="/policies/leaderboard" element={<LeaderboardPolicy />} />
              {/* The old path, kept so links already in the wild still land. */}
              <Route path="/privacy/health-data" element={<Navigate to="/policies/health-data" replace />} />
              <Route
                path="/program"
                element={
                  <ProtectedRoute>
                    <Program />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/progress"
                element={
                  <ProtectedRoute>
                    <Progress />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/library"
                element={
                  <ProtectedRoute>
                    <Library />
                  </ProtectedRoute>
                }
              />
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
        </MfaProvider>
        </ThemeProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
