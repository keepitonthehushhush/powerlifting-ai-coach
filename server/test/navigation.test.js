import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Comments stripped, for the assertions that something is ABSENT. */
const code = (p) => readSource(new URL(p, import.meta.url));
const nav = read('../../web/src/components/SiteNav.jsx');
const logo = read('../../web/src/components/Logo.jsx');
const sticky = read('../../web/src/components/StickyHeader.jsx');
const chat = read('../../web/src/pages/Chat.jsx');
const library = read('../../web/src/pages/Library.jsx');
const progress = read('../../web/src/pages/Progress.jsx');
const logSession = read('../../web/src/pages/LogSession.jsx');
const intake = read('../../web/src/pages/Intake.jsx');
const account = read('../../web/src/pages/Account.jsx');

/** Every page a signed-in athlete can reach from the navigation. */
const SIGNED_IN_PAGES = [
  ['Chat', chat],
  ['Library', library],
  ['Progress', progress],
  ['LogSession', logSession],
  ['Intake', intake],
  ['Account', account],
];
const css = read('../../web/src/styles.css');
const en = read('../../web/src/i18n/locales/en.js');

describe('one navigation, used everywhere', () => {
  test('every signed-in page renders the shared nav', () => {
    // Before this, only the coach page had navigation at all and the others
    // carried an ad-hoc "back to coach" link, so moving between logging,
    // progress and the library meant going via the conversation.
    // Log session, Profile and Your data were the three that still did not,
    // and they are exactly the three that felt like leaving the application:
    // the route change was client-side all along, but the header went with
    // it, so the destination looked like a different site.
    for (const [name, page] of SIGNED_IN_PAGES) {
      assert.match(page, /<SiteNav/, `${name} does not use the shared navigation`);
    }
  });

  test('every signed-in page pins that nav rather than scrolling it away', () => {
    for (const [name, page] of SIGNED_IN_PAGES) {
      assert.match(page, /<StickyHeader>/, `${name} lets the navigation scroll out of reach`);
    }
  });

  test('no page carries a second language selector beside the one in the nav', () => {
    // The profile page had its own. Two selectors on one screen disagree the
    // moment somebody uses the far one.
    for (const [name, page] of SIGNED_IN_PAGES) {
      assert.doesNotMatch(page, /<LanguageSwitcher/, `${name} has a duplicate language selector`);
    }
  });

  test('no page keeps its own hand-rolled back link', () => {
    for (const [name, page] of SIGNED_IN_PAGES) {
      assert.doesNotMatch(page, /backToCoach/, `${name} still has a bespoke back link`);
    }
    // And the strings are gone with them, in both catalogues.
    for (const [name, catalogue] of [['en', en], ['es', read('../../web/src/i18n/locales/es.js')]]) {
      assert.doesNotMatch(catalogue, /backToCoach/, `${name} still carries the dead string`);
    }
  });

  test('destinations are ordered by the training loop, not by when they were added', () => {
    // Talk to the coach, READ WHAT YOU ARE DOING TODAY, log what you lifted,
    // see what it did, look up how to do it.
    //
    // /program was inserted at position two rather than appended, and the
    // position is the argument: the program is what you open on the way to
    // the gym, so it sits between being given the plan and reporting back on
    // it. Appending it to the end would have put the reference card after the
    // charts that summarise months of using it.
    const order = [...nav.matchAll(/to: '\/([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(order.slice(0, 5), ['coach', 'program', 'log', 'progress', 'library']);
  });

  test('the rarely-used pages are present but quieter', () => {
    assert.match(nav, /to: '\/intake', key: 'nav\.profile', quiet: true/);
    assert.match(nav, /to: '\/account', key: 'nav\.data', quiet: true/);
  });

  test('the current page is marked for screen readers, not only in colour', () => {
    assert.match(nav, /aria-current=/);
  });

  test('the accent marks the current page and nothing else', () => {
    // One accent doing one job is the whole of the minimal look. If the accent
    // also painted hovers and borders it would stop meaning "you are here".
    const activeRule = css.slice(css.indexOf('.nav-item.active::after'), css.indexOf('.nav-item.active::after') + 300);
    assert.match(activeRule, /background: var\(--accent\)/);
    const hoverRule = css.slice(css.indexOf('.nav-item:hover'), css.indexOf('.nav-item:hover') + 120);
    assert.doesNotMatch(hoverRule, /--accent/);
  });

  test('focus is never removed, only restyled', () => {
    assert.match(css, /\.nav-item:focus-visible \{[^}]*outline:/);
  });
});

describe('the jump control is nowhere near a thumb', () => {
  test('the coach page uses the in-header control, not the floating one', () => {
    // A floating button at the bottom right of the conversation would sit on
    // the send button, which is both the most-used control on the page and
    // where a thumb already rests between sets.
    assert.match(chat, /<JumpToTop/);
    assert.doesNotMatch(chat, /<BackToTop/);
  });

  test('the long scrolling pages keep the floating one, where nothing collides', () => {
    for (const page of [library, progress]) {
      assert.match(page, /<BackToTop/);
    }
  });

  test('both honour reduced motion rather than always animating', () => {
    const occurrences = [...sticky.matchAll(/prefers-reduced-motion/g)];
    assert.ok(occurrences.length >= 2, 'each scroll control must check reduced motion');
  });
});

describe('the mark', () => {
  test('depends on no font being installed', () => {
    // The first draft set the name in Impact. Impact was not present on the
    // machine that rendered it, the browser substituted silently, and the
    // result looked nothing like the design.
    assert.doesNotMatch(logo, /font-family|fontFamily/);
  });

  test('is drawn in theme variables, so it re-themes with everything else', () => {
    for (const variable of ['--surface', '--secondary', '--accent', '--text']) {
      assert.ok(logo.includes(variable), `the mark does not use ${variable}`);
    }
    assert.doesNotMatch(logo, /#[0-9a-fA-F]{6}/, 'no colour should be hardcoded in the mark');
  });

  test('has a simplified variant for small sizes', () => {
    // Below about 32px the inner sleeves merge into a blob - checked by
    // rendering at 48, 32, 24 and 16 rather than assumed.
    assert.match(logo, /FULL_MARK_MINIMUM/);
    assert.match(logo, /compact/);
  });

  test('carries an accessible name rather than being decorative', () => {
    assert.match(logo, /role="img"/);
    assert.match(logo, /aria-label/);
  });
});

describe('the navigation is usable on a phone', () => {
  test('the destinations get their own row on a narrow screen', () => {
    // Squeezing both groups onto one line leaves targets too small to hit
    // standing up in a gym, which is where this app is actually used.
    const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
    assert.match(mobile, /\.nav-row \{[^}]*flex-basis: 100%/s);
  });

  test('the destinations scroll sideways rather than wrapping to three lines', () => {
    assert.match(css, /\.nav-places \{[^}]*overflow-x: auto/s);
    assert.match(css, /\.nav-places \{[^}]*min-width: 0/s);
  });

  test('the product is still identified when the name is hidden', () => {
    // The wordmark text drops below 560px; the badge has to carry identity
    // alone, which is what the compact variant is for.
    const narrow = css.slice(css.indexOf('@media (max-width: 560px)'));
    assert.match(narrow, /\.wordmark-text \{ display: none/);
  });

  test('every nav label is translated', () => {
    const keys = [...nav.matchAll(/key: 'nav\.([a-z]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length >= 6);
    for (const key of keys) {
      assert.match(en, new RegExp(`\\n    ${key}:`), `nav.${key} is missing from the English catalogue`);
    }
  });
});

describe('the header does not fight the scroll position it changes', () => {
  // ── THE BUG THIS PINS ────────────────────────────────────────────────────
  //
  // The header is in normal flow, so condensing it shortens the DOCUMENT. The
  // browser answers by moving the scroll position - clamping at the bottom,
  // re-anchoring elsewhere - and that arrives as a scroll event, in the
  // opposite direction, that nobody made. Acting on it expands the header,
  // which lengthens the document, which moves the scroll position back.
  //
  // Measured against the real stylesheet and this exact source at 390x760:
  // 96 state flips in a couple of seconds at the bottom of a long
  // conversation, document height oscillating 4853 <-> 4896, and a test
  // driver that could not click the message box for thirty seconds because
  // the element "is not stable". With the guards below: zero flips, one
  // document height.
  const stickyCode = code('../../web/src/components/StickyHeader.jsx');

  test('a change in document height is treated as our own doing, not the reader\'s', () => {
    assert.match(stickyCode, /scrollHeight/, 'the header does not watch the document height at all');
    // The guard has to RETURN. Merely noticing the change and carrying on
    // still flips the state, which is the entire bug.
    assert.match(
      stickyCode,
      /if \(docHeight !== lastDocHeight\) \{[^}]*lastDocHeight = docHeight;[^}]*lastY\.current = y;[^}]*return;/s,
      'the height guard must re-synchronise and bail out, not just record',
    );
  });

  test('it holds still within its own height of either end of the page', () => {
    // Symmetric rules for the same reason: at the top there is nothing to get
    // out of the way of, and at the bottom shrinking the document drags the
    // view down with it.
    assert.match(stickyCode, /nearTop = y <= height/);
    assert.match(stickyCode, /nearBottom = y \+ window\.innerHeight >= docHeight - height/);
    assert.match(stickyCode, /!nearBottom && Math\.abs\(delta\) > THRESHOLD/);
  });

  test('it starts from where the page actually is', () => {
    // Starting the previous position at zero means the first event after a
    // reload that restored a scroll position carries a delta of thousands.
    assert.match(stickyCode, /lastY\.current = window\.scrollY;/);
  });
});

describe('the destinations row moves rather than teleporting', () => {
  const cssCode = code('../../web/src/styles.css');
  const mobile = cssCode.slice(cssCode.indexOf('@media (max-width: 700px)'));

  test('the collapse is never done with display, which cannot be animated', () => {
    // This is what "the tabs just appear" was: display has no interpolable
    // values, so there is no animation to run - the row is there or not there
    // on the frame the class changes.
    assert.doesNotMatch(
      mobile,
      /\.sticky-header\.condensed \.nav-(places|row)[^{]*\{[^}]*display:\s*none/s,
      'the condensed row is still being switched off with display',
    );
  });

  test('it collapses on an animatable property, to the content height', () => {
    // grid-template-rows 1fr -> 0fr rather than a max-height larger than the
    // content: a magic number is wrong on every screen but the one it was
    // measured on, and wastes part of the duration doing nothing visible.
    assert.match(cssCode, /\.nav-row \{[^}]*grid-template-rows: 1fr/s);
    assert.match(cssCode, /\.nav-row \{[^}]*transition:[^;]*grid-template-rows/s);
    assert.match(mobile, /\.sticky-header\.condensed \.nav-row \{[^}]*grid-template-rows: 0fr/s);
    // Without this the 0fr track has no effect: a grid item's automatic
    // minimum size is its own content.
    assert.match(cssCode, /\.nav-places \{[^}]*min-height: 0/s);
  });

  test('a collapsed row leaves the tab order instead of hiding in a clipped box', () => {
    assert.match(mobile, /\.sticky-header\.condensed \.nav-places \{[^}]*visibility: hidden/s);
    // Delayed on the way out so it does not blink away mid-movement.
    assert.match(mobile, /visibility 0s linear/);
  });

  test('the whole collapse is off under reduced motion', () => {
    const reduced = cssCode.slice(cssCode.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(reduced, /\.nav-row,[\s\S]{0,200}transition: none/);
  });
});

/**
 * ── THE SAME DEFECT, ONE RING FURTHER OUT ─────────────────────────────────
 *
 * The suite above records that Log session, Profile and Your data "felt like
 * leaving the application: the route change was client-side all along, but the
 * header went with it, so the destination looked like a different site."
 *
 * Those three were fixed. The PUBLIC pages were not - and `/faq` is one of the
 * destinations in SiteNav, so the navigation itself was sending people to a
 * page with no navigation on it. Checked against the live site rather than
 * inferred: coachdiaz.app/faq reported zero nav elements, and the page ends by
 * offering "Create your account".
 *
 * Reported as: "FAQ loads into another page that acts or thinks you log out."
 */
describe('the public pages are part of the application when you are in it', () => {
  const INFORMATIONAL = [
    ['Faq', code('../../web/src/pages/Faq.jsx')],
    ['ForYourClinician', code('../../web/src/pages/ForYourClinician.jsx')],
    ['Terms', code('../../web/src/pages/Terms.jsx')],
    ['HealthDataPolicy', code('../../web/src/pages/HealthDataPolicy.jsx')],
    ['AiProcessing', code('../../web/src/pages/AiProcessing.jsx')],
    ['LeaderboardPolicy', code('../../web/src/pages/LeaderboardPolicy.jsx')],
  ];
  const infoHeader = code('../../web/src/components/InfoHeader.jsx');

  test('EVERY ONE OF THEM USES THE SHARED INFORMATIONAL HEADER', () => {
    for (const [name, page] of INFORMATIONAL) {
      assert.match(page, /<InfoHeader/, `${name} renders its own header and loses the navigation`);
    }
  });

  test('and none of them still hand-rolls a page header', () => {
    // The floor under the assertion above: a page could import InfoHeader and
    // keep its old header beside it.
    for (const [name, page] of INFORMATIONAL) {
      assert.doesNotMatch(page, /<header className="page-header"/, `${name} kept its own header`);
    }
  });

  test('THAT HEADER SHOWS THE REAL NAVIGATION WHEN THERE IS A SESSION', () => {
    assert.match(infoHeader, /const \{ session \} = useAuth\(\)/);
    assert.match(infoHeader, /if \(session\)/);
    assert.match(infoHeader, /<SiteNav \/>/);
    assert.match(infoHeader, /<StickyHeader>/);
  });

  test('and does NOT when there is not, because these pages are public', () => {
    /*
     * The half that keeps the original decision intact: "the person with the
     * most questions is the one who has not signed up yet." A signed-out
     * visitor must not be shown a bar of destinations that all bounce to a
     * password field, nor a sign-out button.
     */
    assert.match(infoHeader, /<p className="policy-link">/);
    assert.match(infoHeader, /to="\/"/);
  });

  test('THE FAQ IS A NAVIGATION DESTINATION, WHICH IS WHY THIS MATTERS', () => {
    // The pairing that made it a bug rather than an inconsistency. If /faq is
    // ever removed from the nav this test should be reconsidered, not deleted.
    assert.match(nav, /to: '\/faq'/);
  });

  test('and it does not ask somebody already signed in to create an account', () => {
    const faq = code('../../web/src/pages/Faq.jsx');
    assert.match(faq, /const \{ session \} = useAuth\(\)/);
    assert.match(faq, /session \?/, 'the sign-up ending is shown to everybody');
  });
});

/**
 * ── "BACK" HAS TO MEAN BACK ───────────────────────────────────────────────
 *
 * "When you click on a link on FAQ and then back, it doesn't take you back
 * from where you came from. It takes you to your privacy choices."
 *
 * Five pages, five hard-coded exits, no two alike - and two of them were
 * labelled "Back" while going to /consent, which is not a mislabel but a
 * statement about the button that was not true. A sixth pointed a signed-in
 * reader at the sign-in screen.
 */
describe('a way back that goes where the reader came from', () => {
  const backLink = code('../../web/src/components/BackLink.jsx');
  const policyFooter = code('../../web/src/components/PolicyFooter.jsx');
  const POLICY_PAGES = [
    ['Terms', code('../../web/src/pages/Terms.jsx')],
    ['HealthDataPolicy', code('../../web/src/pages/HealthDataPolicy.jsx')],
    ['AiProcessing', code('../../web/src/pages/AiProcessing.jsx')],
    ['LeaderboardPolicy', code('../../web/src/pages/LeaderboardPolicy.jsx')],
    ['ForYourClinician', code('../../web/src/pages/ForYourClinician.jsx')],
  ];

  test('NO PAGE HARD-CODES AN EXIT ANY MORE', () => {
    for (const [name, page] of POLICY_PAGES) {
      assert.match(page, /<PolicyFooter/, `${name} does not use the shared ending`);
      assert.doesNotMatch(
        page,
        /to="\/consent"/,
        `${name} still sends the reader to the consent screen by hand`
      );
    }
  });

  test('and no control labelled "Back" points at a fixed destination', () => {
    // The specific lie: a button that says Back and goes somewhere the reader
    // has never been.
    for (const [name, page] of POLICY_PAGES) {
      assert.doesNotMatch(
        page,
        /<Link[^>]*to="\/[^"]*"[^>]*>\s*Back\b/,
        `${name} has a "Back" link with a hard-coded target`
      );
    }
  });

  test('BACK USES THE READER\'S OWN HISTORY', () => {
    assert.match(backLink, /navigate\(-1\)/);
  });

  test('with a fallback for anybody who arrived cold', () => {
    /*
     * navigate(-1) on the first entry of a session leaves the site - into a
     * search results page, or nothing. React Router stamps that first entry
     * with the key `default`, which is the only reliable way to tell "came
     * from inside the app" from "opened this link directly".
     */
    assert.match(backLink, /location\.key !== 'default'/);
    assert.match(backLink, /fallback/);
  });

  test('THE CONSENT SETTINGS ARE OFFERED AS WELL, NOT INSTEAD', () => {
    // What was actually asked for: "can we give the users the option to go
    // back and go to privacy choices to edit their choices?"
    assert.match(policyFooter, /<BackLink/);
    assert.match(policyFooter, /to="\/consent"/);
    assert.match(policyFooter, /editPrivacyChoices/);
  });

  test('and only to somebody who can actually reach that screen', () => {
    // /consent is behind ProtectedRoute. Offering it signed-out is the same
    // trap the clinician page fell into by linking to /login.
    assert.match(policyFooter, /session && offerConsentSettings/);
  });
});

/**
 * ── THE FIX REINTRODUCED THE BUG THROUGH ITS OWN DEFAULT ───────────────────
 *
 * Found on the preview, by loading a policy page cold rather than reading it.
 * Four pages passed `fallback="/faq"` and took BackLink's default label, which
 * reads "Back to Coach Diaz". So a stranger arriving on the Terms page from a
 * search result was handed a control whose words said the front door and whose
 * href said the FAQ.
 *
 * That is the same defect the component was written to remove - a control that
 * says one thing and does another - shipped inside the component that removes
 * it. It is small, and it is exactly the kind of small that this project's
 * whole approach exists to catch: nothing failed, every test passed, and the
 * page looked fine.
 */
describe('a fallback destination and its label cannot disagree', () => {
  const PAGES_WITH_FOOTERS = [
    ['Terms', code('../../web/src/pages/Terms.jsx')],
    ['HealthDataPolicy', code('../../web/src/pages/HealthDataPolicy.jsx')],
    ['AiProcessing', code('../../web/src/pages/AiProcessing.jsx')],
    ['LeaderboardPolicy', code('../../web/src/pages/LeaderboardPolicy.jsx')],
    ['ForYourClinician', code('../../web/src/pages/ForYourClinician.jsx')],
  ];

  test('ANY PAGE CHOOSING ITS OWN FALLBACK MUST ALSO SUPPLY THE WORDS', () => {
    for (const [name, page] of PAGES_WITH_FOOTERS) {
      /*
       * `[^>]*` and not `[^/>]*`. The first version of this excluded the
       * slash, so it stopped inside `fallback="/faq"` and never saw the value
       * - the check passed on a planted violation. A scanner that cannot find
       * the thing it is looking for is worse than no scanner, and the only
       * reason this was caught is that the planted-failure step is part of
       * writing the check rather than an afterthought.
       */
      for (const match of page.matchAll(/<PolicyFooter\b([^>]*?)\/?>/g)) {
        const props = match[1];
        const fallback = /fallback="([^"]*)"/.exec(props)?.[1];
        if (fallback && fallback !== '/') {
          assert.match(
            props,
            /fallbackLabel=/,
            `${name} sends a cold arrival to ${fallback} while the label still says the front door`
          );
        }
      }
    }
  });

  test('and the default destination matches the default label', () => {
    // "Back to Coach Diaz" -> "/". If either moves, the other has to.
    const backLink = code('../../web/src/components/BackLink.jsx');
    assert.match(backLink, /fallback = '\/'/);
    assert.match(backLink, /t\('common\.backHome'\)/);
    assert.match(en, /backHome: 'Back to Coach Diaz'/);
  });
});
