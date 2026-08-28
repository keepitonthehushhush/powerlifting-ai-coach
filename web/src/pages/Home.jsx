import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Wordmark } from '../components/Logo.jsx';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';

/**
 * The front door.
 *
 * ── WHAT WAS HERE BEFORE ──────────────────────────────────────────────────
 *
 * A sign-in form. `/` fell through the catch-all to `/coach`, which is behind
 * ProtectedRoute, which sent anybody without a session to `/login`. So the
 * first thing a person who had merely HEARD about this product saw, on typing
 * the address, was a password field - and everything explaining what the thing
 * is lived at `/faq`, which nobody reaches without already being curious
 * enough to go looking.
 *
 * ── WHY IT IS TRANSLATED WHEN THE FAQ IS NOT ──────────────────────────────
 *
 * The FAQ and the policy pages are long English prose and translating them is
 * a different job. This is shell: two dozen short strings, and the first thing
 * anybody sees. A Spanish-speaking visitor who lands on an English headline
 * has decided something about the product before they find the switcher, which
 * is why the switcher is in the header here and not only inside the app.
 *
 * ── EVERY CLAIM IS ONE THE DOCUMENTS ALREADY MAKE ─────────────────────────
 *
 * A landing page is where a product that has been careful everywhere else
 * starts rounding up. "It does not sell your data", "delete everything from
 * the Account page", "free while it is being built" are the FAQ's own
 * sentences at the FAQ's own strength, not stronger ones.
 * server/test/landing.test.js asserts that, and asserts the absence of the
 * things a landing page invents: testimonials nobody gave, counts of users who
 * do not exist, and results the product cannot promise.
 *
 * ── NOT A REDIRECT ────────────────────────────────────────────────────────
 *
 * A signed-in visitor is NOT bounced to /coach. Bouncing needs the session to
 * resolve first, which means either a loading spinner where the headline
 * should be - on the one page whose whole job is to render immediately - or a
 * flash of marketing before the redirect fires. Instead the page renders at
 * once for everybody and the button changes when the answer arrives. The
 * installed app skips this entirely: the manifest's start_url is /coach.
 */
export function Home() {
  const { t } = useI18n();
  const { session } = useAuth();

  return (
    <div className="home">
      <header className="home-top">
        <Wordmark name={t('common.appName')} />
        <LanguageSwitcher />
      </header>

      <section className="home-hero">
        <h1 className="home-headline">{t('home.headline')}</h1>
        <p className="home-subhead">{t('home.subhead')}</p>

        <div className="home-actions">
          {session ? (
            <Link className="cta" to="/coach">
              {t('home.ctaOpen')}
            </Link>
          ) : (
            <>
              {/* Lands on the sign-UP form, because a button that says "create
                  your account" and produces a sign-in form is the same kind of
                  lie as a field labelled "Username or Email" on a form that
                  only accepts email. */}
              <Link className="cta" to="/login?mode=signup">
                {t('home.ctaCreate')}
              </Link>
              <Link className="link strong" to="/login">
                {t('home.ctaSignIn')}
              </Link>
            </>
          )}
        </div>

        <p className="muted small home-free">{t('home.free')}</p>
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.howTitle')}</h2>
        {/* An ordered list because the order is the point: it cannot programme
            for a gym it has not asked about, and it cannot adjust a block it
            has not seen you train. */}
        <ol className="home-steps">
          <li>
            <h3 className="home-h3">{t('home.step1Title')}</h3>
            <p>{t('home.step1Body')}</p>
          </li>
          <li>
            <h3 className="home-h3">{t('home.step2Title')}</h3>
            <p>{t('home.step2Body')}</p>
          </li>
          <li>
            <h3 className="home-h3">{t('home.step3Title')}</h3>
            <p>{t('home.step3Body')}</p>
          </li>
        </ol>
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.aiTitle')}</h2>
        <p>{t('home.aiBody')}</p>
        <p>
          <Link className="link strong" to="/faq">
            {t('home.aiLink')}
          </Link>
        </p>
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.gymTitle')}</h2>
        <p>{t('home.gymBody')}</p>
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.honestTitle')}</h2>
        <ul className="home-honest">
          <li>{t('home.honestDoctor')}</li>
          <li>{t('home.honestOptional')}</li>
          <li>{t('home.honestAds')}</li>
          <li>{t('home.honestDelete')}</li>
        </ul>
      </section>

      <footer className="home-footer">
        <p className="fineprint">{t('medical.disclaimer')}</p>
        <nav className="home-links" aria-label={t('home.honestTitle')}>
          <Link className="link" to="/faq">
            {t('common.faq')}
          </Link>
          <Link className="link" to="/about">
            {t('common.forYourClinician')}
          </Link>
          <Link className="link" to="/policies/terms">
            {t('home.terms')}
          </Link>
          <Link className="link" to="/policies/health-data">
            {t('home.healthPolicy')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
