import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

/**
 * The public landing page.
 *
 * ── WHY THIS FILE IS MOSTLY ABOUT WHAT IS *NOT* ON THE PAGE ────────────────
 *
 * Everything else in this repository has been held to a standard of not saying
 * more than it can defend - the FAQ defers to the policy documents, the
 * comparison answers each name somebody who should use the competitor, the
 * coach is forbidden from claiming a belt prevents injury. A landing page is
 * where all of that quietly stops applying, because a landing page is the one
 * artefact whose purpose is persuasion.
 *
 * So the assertions below are the same guard rails, pointed at the front door:
 * every claim is one a document already makes at the same strength; nothing
 * invents social proof; nothing promises a result; and the page does not
 * describe the roadmap in the present tense.
 */

const home = readRaw(new URL('../../web/src/pages/Home.jsx', import.meta.url));
const homeCode = readSource(new URL('../../web/src/pages/Home.jsx', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
const styles = readSource(new URL('../../web/src/styles.css', import.meta.url));
const indexHtml = readRaw(new URL('../../web/index.html', import.meta.url));
const faq = readRaw(new URL('../../web/src/pages/Faq.jsx', import.meta.url));
const manifest = JSON.parse(
  readRaw(new URL('../../web/public/manifest.webmanifest', import.meta.url))
);

/** Every visible string on the page, in English. */
const COPY = Object.values(en.home).join('\n');

describe('the front door is a door', () => {
  test('/ IS ROUTED, AND NOT BEHIND A SESSION', () => {
    // The bug this page exists for: `/` fell through the catch-all to /coach,
    // which is protected, so the first thing a curious stranger saw was a
    // password field.
    const at = app.indexOf('path="/"');
    assert.ok(at > 0, '/ is not routed');
    const route = app.slice(at, app.indexOf('/>', at) + 2);
    assert.doesNotMatch(route, /ProtectedRoute/);
    assert.match(route, /<Home\s*\/>/);
  });

  test('it does not redirect a signed-in visitor, it changes the button', () => {
    // A redirect needs the session resolved first, which means a spinner where
    // the headline should be, on the one page whose job is to render at once.
    assert.doesNotMatch(homeCode, /<Navigate/);
    assert.match(homeCode, /session \?/);
    assert.match(homeCode, /home\.ctaOpen/);
    assert.match(homeCode, /home\.ctaCreate/);
  });

  test('AND THE CREATE-ACCOUNT BUTTON PRODUCES THE CREATE-ACCOUNT FORM', () => {
    // "Create your account" landing on a sign-in form is the same class of
    // untruth as "Username or Email" on a form that only takes an email.
    assert.match(homeCode, /to="\/login\?mode=signup"/);
    assert.match(login, /get\('mode'\)/);
    assert.match(login, /=== 'signup' \? 'signup' : 'signin'/);
  });

  test('the installed app opens the app, not the shop window', () => {
    // start_url was `/`, which was the sign-in form and is now marketing.
    // Neither is where somebody who installed this wants to land.
    assert.equal(manifest.start_url, '/coach');
    assert.equal(manifest.scope, '/', 'the landing page must stay inside scope');
  });

  test('a shared link renders as something rather than as a bare URL', () => {
    for (const tag of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image']) {
      assert.match(indexHtml, new RegExp(`property="${tag}"`), `missing ${tag}`);
    }
    // summary, not summary_large_image: the image is the square app icon and
    // the wide card would crop it.
    assert.match(indexHtml, /name="twitter:card" content="summary"/);
  });
});

describe('every claim is one the documents already make', () => {
  /**
   * The specific risk: a landing page that says "we will never sell your data"
   * where the policy says something narrower, or "delete anything instantly"
   * where the product means one page and one button. Each pair below is the
   * page's sentence and the FAQ's, and they have to agree in strength.
   */
  test('the free promise is the FAQ\'s promise, word for word', () => {
    assert.match(en.home.free, /free while it is being built and tested/i);
    assert.match(faq, phrase('It is free while it is being built and tested'));
  });

  test('the no-advertising claim is the FAQ\'s claim, not a stronger one', () => {
    assert.match(en.home.honestAds, /no advertising or analytics scripts/i);
    assert.match(faq, phrase('There are no advertising or analytics scripts anywhere'));
    assert.match(faq, phrase('no shopping links anywhere in the app'));
  });

  test('the deletion claim names the page and does not overstate the scope', () => {
    assert.match(en.home.honestDelete, /Account page/);
    assert.match(faq, phrase('Yes, from the Account page, and it is immediate'));
  });

  test('the clearance gate is described as the product behaves', () => {
    // It stops writing PROGRAMMES and keeps answering questions. Saying it
    // "stops" would be wrong in the direction that makes somebody not sign up.
    assert.match(en.home.honestDoctor, /stops writing programmes until/i);
    assert.match(faq, phrase('it stops writing you programmes until you confirm'));
  });

  test('and the health questions are described as optional, because they are', () => {
    assert.match(en.home.honestOptional, /optional/i);
    assert.match(faq, phrase('Those questions are optional and you can leave every one of them blank'));
  });

  test('the medical disclaimer is the shared string, not a softened retelling', () => {
    assert.match(homeCode, /t\('medical\.disclaimer'\)/);
  });
});

describe('WHAT A LANDING PAGE IS NOT ALLOWED TO INVENT', () => {
  test('no testimonials, no names, no quoted praise', () => {
    // There are three users and none of them said anything. Invented social
    // proof on a product holding health data is not a marketing decision.
    assert.doesNotMatch(COPY, /testimonial|"[^"]{20,}"\s*[-—]\s*[A-Z]/);
    assert.doesNotMatch(COPY, /\b(loved by|trusted by|join \d|\d+[,\d]* (?:lifters|users|athletes|members))\b/i);
  });

  test('NO PROMISED RESULTS', () => {
    // "Add 50lb to your squat" is the sentence this product must never print.
    // It is also the sentence every competitor prints.
    assert.doesNotMatch(COPY, /\bguarantee|guaranteed\b/i);
    assert.doesNotMatch(COPY, /add \d+\s*(lb|kg|pounds|kilos)/i);
    assert.doesNotMatch(COPY, /\b(get|be) (?:stronger|jacked|shredded) in \d+/i);
    // Not a bare "best": "what your best lifts are" is a question about the
    // athlete, and forbidding the word rather than the boast is how a rule
    // like this ends up being deleted. What is banned is the product praising
    // itself.
    assert.doesNotMatch(COPY, /\bthe (?:best|fastest|only)\b/i);
    assert.doesNotMatch(COPY, /\b(#1|number one|world.class|revolutionary|cutting.edge)\b/i);
  });

  test('no urgency, no countdowns, no manufactured scarcity', () => {
    assert.doesNotMatch(COPY, /\b(limited time|act now|only \d+ (?:spots|places|left)|hurry)\b/i);
  });

  test('and no capability the product does not have', () => {
    // Wearables are the live temptation - the FAQ says plainly that Coach Diaz
    // cannot read one. The landing page must not quietly imply otherwise.
    assert.doesNotMatch(COPY, /\b(Apple Watch|Whoop|Oura|Garmin|Fitbit|wearable|heart.rate)\b/i);
    assert.doesNotMatch(COPY, /\b(video|form check|camera|upload a clip)\b/i);
  });

  test('no tracking or affiliate parameters anywhere on it', () => {
    // homeCode: the page's own comments discuss what it does not do.
    assert.doesNotMatch(homeCode, /utm_|\?ref=|affiliate|amazon\.|amzn\./i);
  });
});

describe('the page works for somebody who does not read English', () => {
  test('it is fully translated, unlike the FAQ', () => {
    const missing = Object.keys(en.home).filter((key) => typeof es.home?.[key] !== 'string');
    assert.deepEqual(missing, [], 'the first page anybody sees cannot be half-translated');
  });

  test('and nothing was left in English by copying it across', () => {
    const identical = Object.keys(en.home).filter((key) => en.home[key] === es.home[key]);
    assert.deepEqual(identical, []);
  });

  test('the switcher is on the page itself, not only inside the app', () => {
    // A visitor who lands on an English headline has decided something about
    // the product before they find a switcher in a nav they cannot see.
    assert.match(homeCode, /<LanguageSwitcher\s*\/>/);
  });
});

describe('the stylesheet cannot reach off this page', () => {
  test('EVERY NEW SELECTOR IS PREFIXED', () => {
    /*
     * This stylesheet has already produced one bug of exactly this shape:
     * `form > button.primary { min-width: 320px }`, written for a form's
     * submit button, matched the chat composer's send button and crushed the
     * textarea to 24px on a 390px phone. A page-specific block that is not
     * namespaced is that bug waiting to happen again.
     */
    const start = styles.indexOf('.home {');
    assert.ok(start > 0, 'the landing page block is not in the stylesheet');
    const block = styles.slice(start);

    // One selector per line, ending in `{`. Anchored and brace-free so it
    // cannot start at a closing brace and swallow the `@media` line after it,
    // which is what the first version of this did.
    // No newline anywhere in the class: `\s*` will otherwise backtrack across
    // one and let `[^@{}]` match the newline itself, so `@media (...)` gets
    // captured as a selector with a leading blank line. Found by running it.
    const selectors = [...block.matchAll(/^[ \t]*([^@{}\n][^{}\n]*?)[ \t]*\{[ \t]*$/gm)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    assert.ok(selectors.length > 8, `expected the whole block, found ${selectors.length} selectors`);

    const unscoped = selectors.filter((selector) => !/(^|[\s,>])\.home[-\s.:>]|\.home$|\.home\b/.test(selector));
    assert.deepEqual(unscoped, [], 'these rules can match elements on other pages');
  });

  test('and the call to action is an anchor, so it does not inherit button rules', () => {
    // `.primary` carries min-width rules from two other layouts. The CTA
    // navigates, so it is a link, and it is styled on its own terms - and it
    // is `.cta`, not `.home-cta`, because the FAQ uses it too. A class named
    // for one page and used on two invites somebody to "tidy" it later.
    assert.match(homeCode, /className="cta"/);
    assert.doesNotMatch(homeCode, /className="primary/);
  });

  test('the tap targets are big enough to hit', () => {
    const cta = styles.slice(styles.indexOf('.cta {'), styles.indexOf('}', styles.indexOf('.cta {')));
    assert.match(cta, /min-height:\s*44px/);
  });
});

describe("it follows Apple's guidelines, in the ways that are checkable", () => {
  const block = styles.slice(styles.indexOf('.home {'));

  test('EVERY TYPE SIZE IS IN rem, NEVER px', () => {
    /*
     * Dynamic Type means the reader's own text size wins. The web equivalent
     * is rem; a px font-size is a refusal to scale, and on a page whose whole
     * job is to be read by somebody who has not signed up yet, that is the one
     * accessibility failure with a direct cost.
     */
    const sizes = [...block.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(sizes.length > 4, `found ${sizes.length} font-size declarations`);
    const inPixels = sizes.filter((value) => /\d+px/.test(value));
    assert.deepEqual(inPixels, []);
  });

  test('and the type scale is anchored to the HIG roles', () => {
    // Body is 17pt in the HIG, not the 16px the web defaults to. It is the
    // single value that makes a page feel like an Apple one.
    assert.match(styles, /--text-body:\s*1\.0625rem/);
    assert.match(styles, /--text-large-title:/);
    assert.match(styles, /--text-headline:/);
    assert.match(styles, /--text-caption:/);
  });

  test('spacing comes off one scale rather than being invented per rule', () => {
    // 8pt with 4pt subdivisions. A convention rather than an Apple mandate,
    // and worth following because an arbitrary 22px beside a 24px is visible
    // even when nobody can say why.
    assert.match(styles, /--space-1:\s*0\.25rem/);
    assert.match(styles, /--space-3:\s*1rem/);
    const raw = [...block.matchAll(/(?:padding|margin|gap):\s*([^;]+);/g)]
      .map((m) => m[1])
      .filter((value) => /\b\d+(\.\d+)?rem\b/.test(value) && !value.includes('var(--space'));
    assert.deepEqual(raw, [], 'these spacings bypass the scale');
  });

  test('SPACE SEPARATES THE SECTIONS, NOT HAIRLINES', () => {
    // The first version drew a rule between every section. Apple separates
    // with air, and the borders were the main thing making the page read as a
    // settings screen rather than a front door.
    const section = block.slice(block.indexOf('.home-section {'), block.indexOf('}', block.indexOf('.home-section {')));
    assert.doesNotMatch(section, /border/);
  });

  test('and the call to action clears the 44pt tap floor', () => {
    // The one number in the HIG that is a hard minimum rather than a
    // convention, unchanged since the original iPhone.
    const cta = styles.slice(styles.indexOf('.cta {'), styles.indexOf('}', styles.indexOf('.cta {')));
    assert.match(cta, /min-height:\s*44px/);
  });

  test('motion is dropped for anybody who has asked for less of it', () => {
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.cta/);
  });

  test('THREE STEPS SIT IN ONE ROW OR THREE, NEVER TWO AND A BIT', () => {
    // auto-fit fitted exactly two inside the measure, so the third sat alone
    // beneath a column-wide hole. Found by rendering it.
    assert.doesNotMatch(block, /\.home-steps[\s\S]{0,200}auto-fit/);
    assert.match(block, /grid-template-columns:\s*repeat\(3, 1fr\)/);
  });
});

describe('the reasoning survives', () => {
  test('the page records what was there before it', () => {
    assert.match(home, phrase('the first thing a person who had merely HEARD about this product saw'));
  });

  test('and why a signed-in visitor is not redirected', () => {
    assert.match(home, phrase('A signed-in visitor is NOT bounced to /coach'));
  });
});
