import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { beltWorthMentioning, BELT_THRESHOLDS } from '../src/lib/equipment.js';
import { describeKit, COACH_ROLE, buildSystemPrompt } from '../src/prompts/systemPrompt.js';
import { CONTACT_EMAIL, CONTACT_LIVE } from '../../web/src/lib/contact.js';

const faq = readRaw(new URL('../../web/src/pages/Faq.jsx', import.meta.url));
const faqCode = readSource(new URL('../../web/src/pages/Faq.jsx', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
const nav = readSource(new URL('../../web/src/components/SiteNav.jsx', import.meta.url));
const login = readSource(new URL('../../web/src/pages/Login.jsx', import.meta.url));
const en = readRaw(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const es = readRaw(new URL('../../web/src/i18n/locales/es.js', import.meta.url));
const equipmentRaw = readRaw(new URL('../src/lib/equipment.js', import.meta.url));
const runbook = readRaw(new URL('../../docs/RUNBOOK.md', import.meta.url));
const checkContact = readRaw(new URL('../../scripts/check-contact-route.mjs', import.meta.url));

describe('the belt threshold', () => {
  const profile = { bodyweight: 200, units: 'lb' };

  test('a beginner is not sold anything', () => {
    // The failure mode this module exists to prevent: a model eyeballing
    // "is this heavy" tells somebody squatting 95 lb they need a belt.
    const { lifts } = beltWorthMentioning({ profile, prescriptions: { squat: { weight: 95 } } });
    assert.deepEqual(lifts, []);
    assert.equal(describeKit(profile, { squat: { weight: 95 } }), null);
  });

  test('it fires once the load is genuinely bodyweight-relative heavy', () => {
    const { lifts, ratio } = beltWorthMentioning({
      profile,
      prescriptions: { squat: { weight: 275 }, deadlift: { weight: 315 } },
    });
    assert.deepEqual(lifts.sort(), ['deadlift', 'squat']);
    // 315/200 is 1.575, and Number((1.575).toFixed(2)) is 1.57 rather than
    // 1.58 - binary floating point stores 1.575 as slightly less than it. Not
    // worth correcting for a number shown to a person as "about this heavy",
    // but worth writing down so the next reader does not think it is a bug.
    assert.equal(ratio, 1.57);
  });

  test('the bench never triggers it, because a belt does little there', () => {
    assert.equal(BELT_THRESHOLDS['bench press'], Infinity);
    const { lifts } = beltWorthMentioning({
      profile,
      prescriptions: { 'bench press': { weight: 400 } },
    });
    assert.deepEqual(lifts, []);
  });

  test('kilograms and pounds reach the same answer', () => {
    const lb = beltWorthMentioning({ profile: { bodyweight: 220, units: 'lb' }, prescriptions: { squat: { weight: 330 } } });
    const kg = beltWorthMentioning({ profile: { bodyweight: 100, units: 'kg' }, prescriptions: { squat: { weight: 150 } } });
    assert.deepEqual(lb.lifts, kg.lifts);
  });

  test('no bodyweight means no suggestion, rather than a guessed one', () => {
    assert.deepEqual(beltWorthMentioning({ profile: {}, prescriptions: { squat: { weight: 405 } } }).lifts, []);
    assert.deepEqual(beltWorthMentioning({}).lifts, []);
  });
});

describe('WHAT THE COACH IS ALLOWED TO SAY ABOUT A BELT', () => {
  test('IT MUST NOT CLAIM A BELT PREVENTS INJURY', () => {
    // This was requested as safety equipment "to minimise injuries", and that
    // half is not what the evidence says. A belt is unlikely to reduce the
    // risk of first-time low back pain. Somebody who believes it protects them
    // takes the rep they should have put down - so the false version of this
    // is actively more dangerous than saying nothing.
    assert.match(COACH_ROLE, phrase('WHAT IT DOES NOT DO IS PREVENT INJURY'));
    assert.match(COACH_ROLE, phrase('you must not say or imply that it'));
    assert.match(COACH_ROLE, phrase('unlikely to reduce the risk of first-time low back pain'));
  });

  test('it says what a belt does do, with the actual mechanism', () => {
    assert.match(COACH_ROLE, phrase('raises intra-abdominal pressure and trunk stiffness'));
    assert.match(COACH_ROLE, phrase('lets you brace harder'));
  });

  test('it kills the core-weakness myth, because that myth costs people a tool', () => {
    assert.match(COACH_ROLE, phrase('does NOT weaken your core'));
  });

  test('NO BRANDS AND NO SHOPPING LINKS ANYWHERE', () => {
    // A health-adjacent recommendation the recommender profits from is a
    // conflict of interest, and it would contradict the health data policy's
    // promise that no advertising runs on this site. Specifications survive a
    // product going out of stock; brands do not.
    assert.match(COACH_ROLE, phrase('Never name a brand or point at a shop'));
    assert.match(equipmentRaw, phrase('does not turn a health-adjacent recommendation into a transaction'));
    // And nothing in the prompt smuggles a link in.
    assert.doesNotMatch(COACH_ROLE, /amazon\.|amzn\.|\?tag=|affiliate/i);
  });

  test('it is mentioned once, not made into a running theme', () => {
    assert.match(COACH_ROLE, phrase('Raise it when it is earned, once, and never again unless asked'));
    const d = describeKit({ bodyweight: 200, units: 'lb' }, { squat: { weight: 275 } });
    assert.match(d, phrase('Mention it ONCE'));
    assert.match(d, phrase('Do not raise it again unless they ask'));
  });

  test('somebody who cannot spend money is told the programme works anyway', () => {
    assert.match(COACH_ROLE, phrase('none of it is necessary'.replace('none of it', 'none of it')));
    const d = describeKit({ bodyweight: 200, units: 'lb' }, { squat: { weight: 275 } });
    assert.match(d, phrase('the program works without it'));
  });

  test('it is suppressed while the clearance gate is up', () => {
    // "Buy a belt" next to "see a physiotherapist" reads as a way to train
    // through the thing the gate exists to stop.
    const gated = buildSystemPrompt({
      profile: {
        units: 'lb', bodyweight: 200, current_squat: 315,
        health_restrictions: 'sharp back pain', cleared_to_train: false,
      },
    });
    assert.doesNotMatch(gated, /- KIT: this athlete/);
  });

  test('running shoes get named as the actual beginner mistake', () => {
    assert.match(COACH_ROLE, phrase('Running shoes are'));
    assert.match(COACH_ROLE, phrase('the actual equipment mistake most beginners are making'));
  });
});

describe('the FAQ', () => {
  test('it is public and reachable before signing up', () => {
    // The person with the most questions has not signed up yet. Making them
    // create an account to find out what happens to their data is backwards.
    const at = app.indexOf('path="/faq"');
    assert.ok(at > 0, '/faq is not routed');
    const line = app.slice(at, app.indexOf('/>', at) + 2);
    assert.doesNotMatch(line, /ProtectedRoute/);
    assert.match(login, /to="\/faq"/);
  });

  test('and it is a tab once you are in', () => {
    assert.match(nav, /\{ to: '\/faq', key: 'nav\.faq'/);
    for (const [name, catalogue] of [['en', en], ['es', es]]) {
      assert.match(catalogue, /faq: '/, `${name} has no nav.faq label`);
    }
  });

  test('CANCELLING IS PROMISED BEFORE THERE IS ANYTHING TO BUY', () => {
    // The point of saying it early: a subscription somebody is worried about
    // escaping is a subscription they will not start.
    assert.match(faq, phrase('cancel at any time, from inside your'));
    assert.match(faq, phrase('without emailing anybody or explaining yourself'));
    assert.match(faq, phrase('canceling does not delete anything'));
    // And it is written into the runbook so it survives a later push to convert.
    assert.match(runbook, phrase('Cancelling must be possible at any time'));
  });

  test('it says what stays free', () => {
    assert.match(faq, phrase('logging your'));
    assert.match(faq, phrase('will stay free'));
  });

  test('it does not overpromise beyond the documents', () => {
    // A friendly summary that is stronger than the policy it summarises is
    // worse than no summary. Every data answer points at the governing page.
    assert.match(faqCode, /to="\/policies\/health-data"/);
    assert.match(faqCode, /to="\/policies\/terms"/);
    assert.match(faq, phrase('those are the ones that count'));
  });

  test('it answers the questions people are actually nervous about', () => {
    for (const fragment of [
      'Is it a real person?',
      'Will you sell my data?',
      'Can I delete everything?',
      'Can my teenager use it?',
      'Is my data gone?',
    ]) {
      assert.ok(faq.includes(fragment), `the FAQ does not answer: ${fragment}`);
    }
  });

  test('it is honest about Planet Fitness rather than reassuring', () => {
    assert.match(faq, phrase('no barbell and no squat rack'));
    assert.match(faq, phrase('you will eventually need a barbell'));
  });

  /**
   * ── THE COMPARISON ANSWERS ──────────────────────────────────────────────
   *
   * "Why would I use this when I already pay for an AI, or my ring has a
   * coach in it?" is the question that decides whether somebody signs up, and
   * the page did not answer it. It does now, which means the page has become
   * marketing - and marketing is where a product that has been careful about
   * every other claim starts making sloppy ones about somebody else's.
   *
   * These assertions are the guard rails for that.
   */
  describe('it says why to use this rather than the alternatives', () => {
    test('it answers all three versions of the question', () => {
      for (const fragment of [
        'Why use this when I already pay for ChatGPT or Claude?',
        'My watch or ring already has an AI coach. Is this the same thing?',
        'What about the dedicated powerlifting apps?',
        'Should I use this instead of a real coach?',
      ]) {
        assert.ok(faq.includes(fragment), `the FAQ does not answer: ${fragment}`);
      }
    });

    test('EVERY COMPARISON NAMES SOMEBODY WHO SHOULD USE THE OTHER THING', () => {
      // A comparison with no such case is an advertisement. Each of these is
      // a real concession, and losing one would be the first sign this page
      // had drifted from honest into promotional.
      assert.match(faq, phrase('a general AI is a fine sounding board and you are already paying for it'));
      assert.match(faq, phrase('you should probably use it'));
      assert.match(faq, phrase('not if you have a good one and can afford them'));
      assert.match(faq, phrase('Nothing here competes with that'));
    });

    test('the claim about other AI is sourced, not asserted', () => {
      // Numbers about somebody else's product, with no citation, are the exact
      // thing this page would be criticised for. The study is linked.
      assert.match(faq, /link\.springer\.com\/article\/10\.1186\/s13102-025-01409-7/);
      assert.match(faq, phrase('Seven strength-and-conditioning experts'));
      assert.match(faq, phrase('fifteen repetitions at 85% of maximum'));
    });

    test('AND A COMPETITOR PRICE CARRIES THE DATE IT WAS CHECKED', () => {
      // Prices move. A dated figure that has gone stale reads as stale; an
      // undated one reads as a lie. Any dollar amount on this page has to say
      // when it was true.
      const amounts = [...faq.matchAll(/\$\d[\d.,]*/g)].map((m) => m[0]);
      assert.ok(amounts.length > 0, 'the comparison quotes no price at all - has the answer changed?');
      for (const amount of amounts) {
        const at = faq.indexOf(amount);
        const sentence = faq.slice(at, at + 240);
        assert.match(
          sentence,
          /when this answer was written, in [A-Z][a-z]+ \d{4}/,
          `${amount} is quoted with no date - it will be wrong and nothing will say so`
        );
      }
    });

    test('and it earns nothing from any of it', () => {
      // The same rule the equipment answer states, applied to the one place a
      // comparison page would be tempted to break it.
      //
      // faqCode, not faq: this is an ABSENCE assertion, and the page carries a
      // comment saying there are no affiliate links, which the raw text
      // matches. Sixth time. readSource exists for exactly this.
      assert.doesNotMatch(faqCode, /amazon\.|amzn\.|\?tag=|affiliate|utm_|\?ref=/i);
    });

    test('it does not claim a capability the product does not have', () => {
      // Wearable integration does not exist. Saying so is the difference
      // between a roadmap and a lie, and this page is read by people deciding
      // whether to trust the rest of it.
      assert.match(faq, phrase('Coach Diaz cannot read your wearable'));
      assert.match(faq, phrase('on the list, not in the product'));
    });
  });

  test('AND SOMEBODY CONVINCED BY IT CAN ACT ON IT', () => {
    // The page ended in policy links. A person who read fourteen answers,
    // decided yes, and found nothing to press is the most expensive kind of
    // visitor to lose - and this page is the one most likely to be reached
    // from a search rather than from the front door.
    assert.match(faqCode, /to="\/login\?mode=signup"/);
    assert.match(faqCode, /to="\/"/, 'there is no way back to the landing page');
  });

  test('it states that no equipment recommendation earns us anything', () => {
    assert.match(faq, phrase('We do not earn anything'));
    assert.match(faq, phrase('no shopping links anywhere in the app'));
  });
});

describe('WE ASK FOR LESS THAN PEOPLE WILL VOLUNTEER', () => {
  const contact = readRaw(new URL('../../web/src/lib/contact.js', import.meta.url));
  const terms = readRaw(new URL('../../web/src/pages/Terms.jsx', import.meta.url));

  test('the mailto opens with a template, not an empty box', () => {
    // The strongest lever available, and it is design rather than law: the
    // message opens already written, so most people send it as-is. It shapes
    // the message before it exists, which no footer can do.
    assert.match(contact, /export function removalMailto/);
    assert.match(contact, /encodeURIComponent\(subject\)/);
    assert.match(contact, /encodeURIComponent\(body\)/);
    assert.match(terms, /href=\{removalMailto\(\)\}/);
  });

  test('the template asks for two fields and says what to leave out', () => {
    assert.match(contact, phrase('Account email address:'));
    assert.match(contact, phrase('Please do not include medical details'));
    assert.match(contact, phrase('The email'));
  });

  test('NO CONFIDENTIALITY DISCLAIMER, AND THE REASON IS WRITTEN DOWN', () => {
    // A disclaimer tries to bind the recipient by appending text. Contract
    // formation needs both parties to agree and nobody agrees to a footer -
    // and it addresses the wrong risk anyway. The danger is not that they
    // misuse it, it is that we are holding it.
    assert.match(contact, phrase('the obvious answer is worthless'));
    assert.match(contact, phrase('nobody agrees to a footer'));
    assert.match(runbook, phrase('does not fix this and is not used here'));
  });

  test('a web form was considered and rejected, with the tradeoff recorded', () => {
    // It would minimise harder - you cannot type what has no field - but it
    // lands in a table somebody must remember to open, which is the exact
    // failure this contact route was built to fix.
    assert.match(contact, phrase('A web form would minimise harder'));
    assert.match(contact, phrase('a commitment nobody can invoke'));
  });

  test('both documents promise deletion after acting, not filing', () => {
    assert.match(terms, phrase('act on your request and then delete the message'));
    assert.match(terms, phrase('we will not file it, forward it, or keep'));
    assert.match(faq, phrase('gets deleted once we have dealt with your request'));
  });

  test('the runbook says how, including the copies people forget', () => {
    assert.match(runbook, phrase('including from Trash and any Sent copy'));
    assert.match(runbook, phrase('Every copy is another place it has to be deleted from'));
  });
});

describe('the contact route is treated as something that breaks', () => {
  test('the address is live now, and both places agree', () => {
    assert.equal(CONTACT_LIVE, true);
    const page = readRaw(new URL('../../web/public/maintenance.html', import.meta.url));
    assert.ok(page.includes(CONTACT_EMAIL));
    assert.match(page, /var CONTACT_READY = true;/);
  });

  test('there is a check, and it explains why DNS is the first suspect', () => {
    assert.match(checkContact, phrase('Because it is always DNS'));
    assert.match(checkContact, /resolveMx/);
    assert.match(checkContact, phrase('fail in the worst possible way: silently'));
  });

  test('it knows what it cannot prove', () => {
    // MX resolving is not the same as a human reading the message.
    assert.match(checkContact, phrase('It CANNOT prove a message arrives in a human'));
    assert.match(runbook, phrase('Send a real test message to the address'));
  });

  test('a broken route has a documented fallback that needs no DNS', () => {
    assert.match(checkContact, phrase('CONTACT_LIVE to false in web/src/lib/contact.js'));
    assert.match(runbook, phrase('which needs no DNS and no inbox'));
  });

  test('DNS is first in the triage order', () => {
    assert.ok(
      runbook.indexOf('Check DNS first') < runbook.indexOf('Vercel runtime logs'),
      'DNS should be checked before the logs'
    );
  });
});
