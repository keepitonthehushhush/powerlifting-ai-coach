import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../src/i18n/index.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { ConsentProvider } from '../src/context/ConsentContext.jsx';
import { MfaProvider } from '../src/context/MfaContext.jsx';
import { api } from '../src/lib/api.js';
import { supabase } from '../src/lib/supabase.js';
/* The REAL warm-up engine, imported rather than copied. A second copy is how
   the harness would stop reviewing the product and start reviewing itself. */
import { warmupForProgram } from '../../server/src/lib/warmup.js';
import { fixtures, PROGRAM } from './fixtures.js';
import '../src/styles.css';

import { Home } from '../src/pages/Home.jsx';
import { Login } from '../src/pages/Login.jsx';
import { Chat } from '../src/pages/Chat.jsx';
import { Program } from '../src/pages/Program.jsx';
import { LogSession } from '../src/pages/LogSession.jsx';
import { Progress } from '../src/pages/Progress.jsx';
import { Library } from '../src/pages/Library.jsx';
import { Leaderboard } from '../src/pages/Leaderboard.jsx';
import { Account } from '../src/pages/Account.jsx';
import { Intake } from '../src/pages/Intake.jsx';
import { Faq } from '../src/pages/Faq.jsx';
import { NotFound } from '../src/pages/NotFound.jsx';
import { Terms } from '../src/pages/Terms.jsx';
import { PrivacyPolicy } from '../src/pages/PrivacyPolicy.jsx';
import { HealthDataPolicy } from '../src/pages/HealthDataPolicy.jsx';
import { AiProcessing } from '../src/pages/AiProcessing.jsx';
import { LeaderboardPolicy } from '../src/pages/LeaderboardPolicy.jsx';
import { ForYourClinician } from '../src/pages/ForYourClinician.jsx';
import { Consent } from '../src/pages/Consent.jsx';

const PAGES = {
  home: Home, login: Login, coach: Chat, program: Program, log: LogSession,
  progress: Progress, library: Library, leaderboard: Leaderboard, account: Account,
  intake: Intake, faq: Faq, terms: Terms, privacy: PrivacyPolicy,
  notfound: NotFound,
  health: HealthDataPolicy, ai: AiProcessing, lbpolicy: LeaderboardPolicy,
  clinician: ForYourClinician, consent: Consent,
};

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'sparse' ? 'sparse' : 'full';
const page = params.get('page') ?? 'program';

/*
 * ── THE NOT-FOUND SCREEN IS ABOUT ITS OWN URL ────────────────────────────
 *
 * NotFound reads `window.location.pathname` and prints it, because naming the
 * address is the whole point - it is what tells somebody a link is stale
 * rather than that they mistyped it. Under the harness that pathname is `/`,
 * so the screen would be reviewed showing a single character and the one
 * property worth reviewing would be invisible.
 *
 * So the harness gives it a path to show. `replaceState` before React mounts,
 * query string kept intact so `?page=` still resolves on a reload, and a
 * realistic length rather than `/x` - a long path is what tests the wrapping.
 */
if (page === 'notfound') {
  history.replaceState(null, '', `/policies/pricing${location.search}`);
}

/*
 * A signed-in session, invented. Every page behind ProtectedRoute reads one,
 * and a harness that rendered them signed-out would be reviewing the login
 * screen eighteen times.
 */
const SESSION = {
  access_token: 'harness', token_type: 'bearer', expires_in: 3600,
  user: { id: 'harness-user', email: 'athlete@example.com', user_metadata: {} },
};
/* `?auth=out` renders the signed-out screens. The Login page redirects when a
   session exists, so with one hard-coded session it rendered a blank body and
   looked like a harness failure rather than correct behavior. */
const signedOut = params.get('auth') === 'out';
const currentSession = signedOut ? null : SESSION;
supabase.auth.getSession = async () => ({ data: { session: currentSession }, error: null });
supabase.auth.getUser = async () => ({ data: { user: currentSession?.user ?? null }, error: null });
supabase.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
supabase.auth.mfa = { listFactors: async () => ({ data: { all: [], totp: [] }, error: null }) };

/*
 * Shaped like GET /api/program's own res.json - `equipment` is an OBJECT there,
 * and a fixture that flattened it rendered every weight without its units.
 */
const EQUIPMENT = { units: 'lb', smallestPlatePair: null };
const programResponse = {
  active: {
    id: 'harness-program',
    week_number: PROGRAM.week,
    phase: PROGRAM.phase,
    created_at: '2026-09-14T18:47:11.786Z',
    program_data: PROGRAM,
    is_active: true,
  },
  history: [],
  adherence: null,
  equipment: EQUIPMENT,
  warmup: warmupForProgram({
    program: PROGRAM,
    units: EQUIPMENT.units,
    smallestPlatePair: EQUIPMENT.smallestPlatePair,
  }),
  changes: null,
  previousProgram: null,
};

/*
 * Every method is replaced, not only the ones this page is known to call.
 * A page that quietly fetches something the harness did not anticipate would
 * otherwise reach the network, fail, and be reviewed in its error state - and
 * the reviewer would be looking at a bug in the harness believing it was a bug
 * in the product. An unlisted method resolves empty rather than throwing.
 */
const canned = fixtures(mode, programResponse);
for (const key of Object.keys(api)) {
  if (typeof api[key] !== 'function') continue;
  api[key] = async () => (key in canned ? canned[key] : {});
}

const Page = PAGES[page] ?? Program;

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <AuthProvider>
      <MfaProvider>
        <ThemeProvider>
          <ConsentProvider>
            <MemoryRouter>
              <Page />
            </MemoryRouter>
          </ConsentProvider>
        </ThemeProvider>
      </MfaProvider>
    </AuthProvider>
  </I18nProvider>,
);
