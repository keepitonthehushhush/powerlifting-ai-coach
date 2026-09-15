import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readSource } from './helpers/source.js';

/**
 * ── EVERY SCREEN NEEDS SOMETHING TO LAND ON ───────────────────────────────
 *
 * Rendered and counted across all eighteen screens on 2026-09-15: seventeen
 * had exactly one `h1` and no heading level skipped. `/coach` had NO HEADING
 * AT ALL - not a missing h1, nothing at any level.
 *
 * That is the screen this product is mostly used on. Heading navigation is
 * one of the main ways a screen-reader user moves through a page, and on the
 * main screen it found nothing, so there was no way to skip the navigation
 * and reach the conversation except by reading forward through everything.
 *
 * WCAG 2.4.6 is about headings being descriptive; nothing in WCAG literally
 * requires an h1. What requires it is that seventeen pages establish a
 * pattern and the eighteenth broke it silently.
 */
const pagesDir = new URL('../../web/src/pages/', import.meta.url);
const PAGES = readdirSync(pagesDir).filter((f) => f.endsWith('.jsx'));

/*
 * Pages that legitimately render no h1 of their own, with the reason. Named
 * rather than inferred, so a NEW page without one fails instead of quietly
 * joining the list.
 */
/*
 * Components that render the page's h1 on its behalf. Asserted to actually
 * contain an h1 below, so this list cannot drift into naming something that
 * has stopped providing one.
 */
const TITLE_COMPONENTS = ['InfoHeader'];

const NO_OWN_H1 = {
  'GuardianDecision.jsx': 'a token-landing screen that renders one of several states, each with its own heading',
};

describe('every page gives a screen reader a heading to land on', () => {
  for (const file of PAGES) {
    test(`${file} puts exactly one h1 on the screen`, () => {
      /*
       * ── WHY THIS FOLLOWS COMPONENTS INSTEAD OF GREPPING FOR <h1> ────────
       *
       * The first version of this counted `<h1` in the page file and failed
       * eight pages that are correct - the policy pages, the FAQ and the
       * clinician page all take their title from <InfoHeader>, which renders
       * the h1 for them. The RENDERED count, measured in a browser, was one
       * on every single page.
       *
       * A test that contradicts a measurement is the test that is wrong. So
       * this resolves the title-rendering components a page mounts rather
       * than assuming the markup is inline.
       */
      const src = readSource(new URL(file, pagesDir));
      const own = (src.match(/<h1[\s>]/g) ?? []).length;
      const viaComponent = TITLE_COMPONENTS.filter((c) => new RegExp(`<${c}[\\s/>]`).test(src)).length;
      const total = own + viaComponent;
      if (file in NO_OWN_H1) {
        assert.ok(total <= 1, `${file} is listed as having no h1 of its own but renders ${total}`);
        return;
      }
      assert.equal(total, 1, `${file} puts ${total} h1 elements on the screen (${own} inline, ${viaComponent} via a title component)`);
    });
  }

  test('the components trusted to supply a title actually supply one', () => {
    /*
     * Weak on purpose, and it knows it. InfoHeader renders an h1 in each of
     * two branches, so this passes while one of them is broken - a planted
     * mutant that changed the first h1 to an h2 survived exactly that way.
     *
     * What actually settles it is the RENDERED count, recorded per screen by
     * scripts/check-computed-styles.mjs under `__structure` and compared to
     * the committed baseline on every CI run. This assertion stays as the
     * cheap first line: it fails in a second rather than after a browser.
     */
    for (const name of TITLE_COMPONENTS) {
      const src = readSource(new URL(`../../web/src/components/${name}.jsx`, import.meta.url));
      assert.match(src, /<h1[\s>]/, `${name} is trusted for the page title and renders no h1`);
    }

    const checker = readSource(new URL('../../scripts/check-computed-styles.mjs', import.meta.url));
    assert.match(checker, /__structure/, 'the rendered heading count is no longer recorded');
    assert.match(checker, /h1Count/, 'the baseline stopped counting h1 elements');
  });

  test('the chat page keeps its heading, and keeps it out of the way', () => {
    /*
     * Both halves matter. A visible title on this screen would push the newest
     * message down on the smallest phones, which is the opposite of what the
     * page is for - so the fix is not "add a title", it is "add a heading that
     * takes no space".
     */
    const chat = readSource(new URL('Chat.jsx', pagesDir));
    assert.match(chat, /<h1 className="visually-hidden">\{t\('chat\.pageTitle'\)\}<\/h1>/);

    for (const locale of ['en', 'es']) {
      const file = readFileSync(new URL(`../../web/src/i18n/locales/${locale}.js`, import.meta.url), 'utf8');
      assert.match(file, /pageTitle: '[^']+'/, `${locale} has no chat.pageTitle`);
    }
  });
});
