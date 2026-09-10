import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Wordmark } from '../components/Logo.jsx';
import { ConversationDemo, ProgramDemo } from '../components/HomeDemo.jsx';
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
                  lie as a field labeled "Username or Email" on a form that
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

      {/*
        * ── SHOW THE THING ──────────────────────────────────────────────────
        *
        * Directly under the offer, before "How it works", because the sentence
        * that follows a promise should be evidence for it rather than three
        * more paragraphs of promise. See components/HomeDemo.jsx for why this
        * is live markup rather than a screenshot.
        */}
      <section className="home-demo-section">
        <ConversationDemo />
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.howTitle')}</h2>
        {/* An ordered list because the order is the point: it cannot program
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

        {/* After the steps rather than beside step 2: a table wedged into a
            three-column grid on a laptop is unreadable, and the claim it
            supports - "specific numbers, worked out in ordinary code" - is
            step 2's whole point, so it reads fine underneath. */}
        <ProgramDemo />
      </section>

      {/*
        * ── THE CLAIM NOTHING ELSE ON THIS PAGE MAKES ──────────────────────
        *
        * Placed immediately after "log what actually happened", because it is
        * the answer to the question that step raises: why would anybody log?
        * Because the next block is built out of it AND says so - see ADR-23.
        *
        * It goes above the general-AI section deliberately. That one argues
        * against an alternative; this one states what the product does, and a
        * page that argues before it says what it is has the order backwards.
        */}
      <section className="home-section">
        <h2 className="home-h2">{t('home.changeTitle')}</h2>
        <p>{t('home.changeBody')}</p>
        <p>{t('home.changeBasis')}</p>
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

      {/*
        * ── THE EVIDENCE, INCLUDING THE PART THAT IS UNFLATTERING ──────────
        *
        * Two peer-reviewed reviews, cited by name and linked, and the second
        * one is deliberately the weaker result: supervision produced a
        * moderate strength advantage and essentially nothing for body
        * composition, and this product is not supervision anyway - it cannot
        * see a bar path.
        *
        * Saying so is not modesty for its own sake. Every competing page in
        * this category claims a transformation; the one thing that separates
        * an honest claim from that noise is being willing to print the
        * finding that does not help.
        *
        * ── AND THE LINKS DO NOT OPEN A NEW TAB ────────────────────────────
        *
        * Same rule as the exercise library: target="_blank" opens a tab with
        * no history, so Back is dead in it and the app is still open behind,
        * which on a phone reads as "it will not let me come back". The link
        * text says where it goes and a line underneath says both leave the
        * site, so the choice is made knowingly rather than sprung.
        */}
      <section className="home-section">
        <h2 className="home-h2">{t('home.evidenceTitle')}</h2>
        <p>{t('home.evidenceBody')}</p>
        <p>
          <a className="link" href="https://link.springer.com/article/10.1007/s40279-022-01717-9">
            {t('home.evidenceLoad')}
          </a>
        </p>
        <p>{t('home.evidenceHonest')}</p>
        <p>
          <a className="link" href="https://journal.iusca.org/index.php/Journal/article/view/101">
            {t('home.evidenceSupervision')}
          </a>
        </p>
        <p className="fineprint">{t('home.evidenceLeaves')}</p>
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.gymTitle')}</h2>
        <p>{t('home.gymBody')}</p>
      </section>

      {/*
        * ── WHO IT IS NOT FOR, IN THE SAME BREATH ──────────────────────────
        *
        * A beginner reading this page cannot currently tell whether they
        * qualify, and the funnel says two of seven signups never opened the
        * intake form at all. Naming the person this suits is the cheap half.
        *
        * Naming the people it does not suit is the half that earns the first
        * half. It costs a few signups from lifters who would have left anyway
        * and it is the only paragraph on the page that a competitor would not
        * write, which is precisely why it belongs beside "what it will not do"
        * rather than buried in an FAQ.
        */}
      <section className="home-section">
        <h2 className="home-h2">{t('home.forTitle')}</h2>
        <p>{t('home.forBody')}</p>
        <h3 className="home-h3">{t('home.forNotTitle')}</h3>
        <p>{t('home.forNotBody')}</p>
      </section>

      <section className="home-section">
        <h2 className="home-h2">{t('home.costTitle')}</h2>
        <p>{t('home.costBody')}</p>
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

      {/*
        * ── WHY THE FOOTER IS BUILT RATHER THAN JUST SPACED ────────────────
        *
        * "Does not look clean at the bottom of the page and looks sort of
        * randomly placed."
        *
        * It was, and no amount of gap would have fixed it. The row held
        * "Questions people ask", "Information for your doctor or
        * physical therapist", "Terms" and "Health data" - a sentence, a longer
        * sentence, and two words - centered inside a 46ch prose column. Four
        * items of wildly unequal length, center-aligned and wrapping, cannot
        * read as a set: every line breaks in a different place and the eye
        * finds no edge to follow.
        *
        * Three changes, in the order they matter:
        *   1. SHORT, PARALLEL LABELS. One or two words each, so the row reads
        *      as four peers. The descriptive labels stay where they belong -
        *      in links people read before clicking, not in a footer people
        *      scan.
        *   2. The links sit in the page container, not the prose measure. The
        *      disclaimer keeps the measure, because it is prose and prose has
        *      one.
        *   3. Each link is its own 44pt target with real padding, so the row
        *      has a rhythm rather than four text fragments floating in space.
        *      Apple's floor for a tap target is also, not coincidentally, what
        *      makes a link row look built.
        */}
      <footer className="home-footer">
        <p className="home-fineprint">{t('medical.disclaimer')}</p>
        <nav className="home-links" aria-label={t('home.footerNav')}>
          <Link className="home-link" to="/faq">
            {t('home.footerFaq')}
          </Link>
          <Link className="home-link" to="/about">
            {t('home.footerClinicians')}
          </Link>
          <Link className="home-link" to="/policies/terms">
            {t('home.terms')}
          </Link>
          <Link className="home-link" to="/policies/privacy">
            {t('home.privacy')}
          </Link>
          <Link className="home-link" to="/policies/health-data">
            {t('home.healthPolicy')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
