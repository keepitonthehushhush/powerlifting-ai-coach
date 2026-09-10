import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw, readSource } from './helpers/source.js';
import { SELLING, SELLING_ES } from './helpers/selling.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

const page = readRaw(new URL('../../web/src/pages/Home.jsx', import.meta.url));
/*
 * The same file with the comments stripped. An absence check against the raw
 * text is satisfied by a comment EXPLAINING the absence, which is how the
 * target="_blank" assertion below passed nothing on its first run - the only
 * occurrence in this file is the paragraph saying why there is none. The same
 * trap caught a CSS rule quoted in a comment twelve hundred lines away
 * earlier in this codebase's life.
 */
const pageCode = readSource(new URL('../../web/src/pages/Home.jsx', import.meta.url));
const programRoute = readSource(new URL('../src/routes/program.js', import.meta.url));

/**
 * THE LANDING PAGE IS HELD TO THE CODE, THE SAME AS THE POLICIES ARE.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * policyDisclosure.test.js exists because three privacy documents passed every
 * structural check while describing an application that had moved on. A
 * marketing page has the same failure mode and a worse incentive: it is the
 * one page where somebody is trying to persuade, so it is the page where a
 * claim outlives the feature and where the words that sell arrive first.
 *
 * A test cannot read English and decide whether a paragraph is true. What it
 * can do is tie a claim to the code that would have to exist for it to be
 * true, and refuse the vocabulary of a promise.
 */

/** Every string the landing page renders, in one locale. */
const homeCopy = (catalog) => Object.values(catalog.home).filter((v) => typeof v === 'string');

describe('the page does not sell', () => {
  test('no English string promises a result', () => {
    /*
     * The rule the coach's own capability descriptions live under, applied
     * where it matters more. A description may say what a feature IS; it may
     * not say what it will do FOR somebody. Some of the people reading this
     * page are injured or have a difficult relationship with food.
     */
    for (const line of homeCopy(en)) {
      for (const pattern of SELLING) {
        assert.doesNotMatch(line, pattern, `landing copy makes a promise: "${line.slice(0, 80)}"`);
      }
    }
  });

  test('nor any Spanish one', () => {
    // es.js is copy too, and a guard that stops at the border is half a guard.
    for (const line of homeCopy(es)) {
      for (const pattern of SELLING_ES) {
        assert.doesNotMatch(line, pattern, `Spanish landing copy makes a promise: "${line.slice(0, 80)}"`);
      }
    }
  });

  test('and both checks can actually fail', () => {
    // Otherwise the two loops above are lists of regexes nobody has seen match.
    const sells = (line, list) => list.some((p) => p.test(line));
    assert.ok(sells('we guarantee a 500 lb squat in just 8 weeks', SELLING));
    assert.ok(sells('the best powerlifting app there is', SELLING));
    assert.ok(sells('it will get you jacked', SELLING));
    assert.ok(sells('te garantiza resultados', SELLING_ES));
    assert.ok(sells('la mejor app de powerlifting', SELLING_ES));
  });

  test('and the narrowed patterns still let honest prose through', () => {
    /*
     * The other half, and the one that matters more. Both superlative patterns
     * and the "get strong" one were widened out of false positives on real
     * copy - "what your best lifts are", "when a general AI is the better
     * choice", "enough for a beginner to get stronger". A check that cries
     * wolf is a check somebody switches off, so the sentences that made it
     * cry wolf are pinned here as sentences it must accept.
     */
    const sells = (line, list) => list.some((p) => p.test(line));
    for (const honest of [
      'what your best lifts are',
      'including when a general AI is the better choice',
      'it is enough for a beginner to get stronger',
      'the best version of what your gym can do',
    ]) {
      assert.equal(sells(honest, SELLING), false, `false positive: "${honest}"`);
    }
    for (const honest of [
      'incluido cuándo una IA general es la mejor opción',
      'suficiente para que un principiante se haga más fuerte',
    ]) {
      assert.equal(sells(honest, SELLING_ES), false, `falso positivo: "${honest}"`);
    }
  });
});

describe('a claim on the page is a claim about code that exists', () => {
  test('"the next block says what changed" is backed by a route that returns it', () => {
    /*
     * The page tells a stranger that their program page will list what moved
     * and where each change came from. If that ever stops being served, the
     * page becomes a lie told to somebody deciding whether to sign up - and
     * nothing else in the suite would connect the two.
     */
    assert.match(page, /home\.changeTitle/);
    assert.match(programRoute, /changes: previous/, 'the page promises a change list the route does not return');
    assert.match(programRoute, /diffPrograms\(/);
  });

  test('the two bases the page describes are the two the code produces', () => {
    // "either your logged sets asked for it, or the coach decided it" - and
    // the third case, no log at all, is deliberately not sold as either.
    assert.match(en.home.changeBasis, /logged sets asked for it/i);
    assert.match(en.home.changeBasis, /the coach decided it/i);
    assert.doesNotMatch(en.home.changeBasis, /always|never wrong|guaranteed/i);
  });

  test('the clearance claim matches the gate that enforces it', () => {
    // "it will stop and ask you to get cleared" is enforced in code, not in
    // the prompt - re-checked in chat.js after the model replies.
    const chat = readSource(new URL('../src/routes/chat.js', import.meta.url));
    assert.match(en.home.forNotBody, /cleared/i);
    assert.match(chat, /program\.refused_while_gated/);
  });
});

describe('the evidence section keeps the part that does not help', () => {
  test('the unflattering finding survives', () => {
    /*
     * THE SENTENCE SOMEBODY WILL IMPROVE AWAY. Pooling twelve trials and 577
     * people, supervision produced a moderate strength advantage and
     * essentially nothing for body composition. Printing the result that does
     * not sell is the only thing separating a cited claim from the noise every
     * competing page in this category makes.
     */
    /*
     * ── ASSERT THE DIRECTION, NOT THE TOPIC ────────────────────────────────
     *
     * The first version of this checked only that the words "body
     * composition" appeared. A mutant that changed "essentially none in body
     * composition" to "a real one in body composition" - inverting the finding
     * into the exact overclaim this section exists to refuse - passed it.
     *
     * Matching a topic is not matching a claim. What has to hold is the
     * NEGATION beside the topic.
     */
    const negated = /(?:essentially none|virtually none|no|little|trivial|nothing|none)\b[^.]{0,40}body composition/i;
    assert.match(en.home.evidenceHonest, negated, 'the body-composition finding no longer reads as a null result');
    assert.match(
      es.home.evidenceHonest,
      /(?:pr[áa]cticamente ninguna|ninguna|nada|casi nada)[^.]{0,40}composici[óo]n corporal/i,
      'el hallazgo sobre composición corporal ya no se lee como resultado nulo'
    );
    // And it must not have grown into a claim in the other direction.
    assert.doesNotMatch(en.home.evidenceHonest, /(?:a real|significant|large|meaningful)[^.]{0,30}body composition/i);
  });

  test('it does not claim to supervise, because it cannot', () => {
    // The supervision studies are about a person in the room. This is not
    // that, and borrowing their result would be the overclaim the section is
    // otherwise built to avoid.
    assert.match(en.home.evidenceHonest, /not standing next to you/i);
    assert.match(en.home.evidenceHonest, /bar path/i);
  });

  test('every number on the page has a source beside it', () => {
    /*
     * A figure with no citation is the shape of a made-up figure, and this
     * page now carries four: 18 studies, 368 people, 53%, twelve trials, 577
     * people. Each block that states one must also name where it came from.
     */
    for (const [key, source] of [
      ['evidenceBody', 'evidenceLoad'],
      ['evidenceHonest', 'evidenceSupervision'],
    ]) {
      assert.match(en.home[key], /\d/, `${key} no longer states a figure`);
      assert.match(en.home[source], /\d{4}/, `${source} does not name a year`);
      assert.match(en.home[source], /Steele|Fisher/, `${source} does not name the authors`);
      assert.ok(page.includes(`home.${key}`), `${key} is not rendered`);
      assert.ok(page.includes(`home.${source}`), `${source} is not rendered`);
    }
  });

  test('both citations are linked, and both links are declared origins', () => {
    // The link-out list in the CSP test is the other half of this; here it is
    // only that the citation is a LINK rather than a name a reader must trust.
    assert.match(page, /href="https:\/\/link\.springer\.com\/article\/10\.1007\/s40279-022-01717-9"/);
    assert.match(page, /href="https:\/\/journal\.iusca\.org/);
  });

  test('the links do not open a new tab', () => {
    /*
     * The exercise library's rule, and it was learned from a complaint:
     * target="_blank" opens a tab with no history, so Back is dead in it and
     * the app is still open behind, which on a phone reads as "it will not let
     * me come back".
     */
    assert.doesNotMatch(pageCode, /target="_blank"/);
    assert.match(page, /home\.evidenceLeaves/, 'nothing tells the reader the links leave the site');
  });
});

describe('who it is for says who it is not for', () => {
  test('the page names people it is a bad fit for', () => {
    /*
     * The paragraph a competitor would not write, which is exactly why it is
     * load-bearing. It is also the cheapest possible answer to the funnel:
     * two of seven signups never opened the intake form, and a stranger
     * currently cannot tell from this page whether they qualify.
     */
    /*
     * Again the direction rather than the topic. Checking for "already have a
     * coach" passed a mutant that turned "it is a worse fit if you already
     * have a coach you trust" into "it works even if you already have a
     * coach" - which is the opposite paragraph and precisely the one every
     * competing page writes.
     */
    const disqualifies = /(?:worse fit|bad fit|not for you|will not beat|is not going to|not the right)/i;
    assert.match(en.home.forNotBody, disqualifies, 'the section no longer rules anybody out');
    assert.match(
      es.home.forNotBody,
      /(?:encaja peor|no es para ti|no le va a ganar|no es lo indicado)/i,
      'la sección ya no descarta a nadie'
    );
    assert.doesNotMatch(en.home.forNotBody, /works? (?:even |just fine )?(?:if|when) you already have a coach/i);
    assert.match(en.home.forNotBody, /advanced/i);
    assert.ok(page.includes('home.forNotBody'), 'the section is written and not rendered');
  });

  test('the cost paragraph states a promise the app can keep', () => {
    // "on this page before anybody is asked for a card" - the paywall ships
    // OFF and refuses to activate on test keys (ADR-13), so the promise has
    // something behind it rather than being a good intention.
    assert.match(en.home.costBody, /before anybody is asked for a card/i);
    // env.js, not config.js: the paywall is computed there and config.js
    // re-exports it. Asserted against the file that decides rather than the
    // one that forwards.
    const env = readSource(new URL('../src/lib/env.js', import.meta.url));
    assert.match(env, /const paywall = /);
  });

  test('it does not name a price it has not set', () => {
    // There is no price. A page that implies one is a page that will be wrong
    // the day one exists.
    assert.doesNotMatch(en.home.costBody, /\$\d+(\.\d+)? ?(\/|per )?(mo|month)/i);
    assert.match(en.home.costBody, /Nothing, while it is being built/i);
  });
});
