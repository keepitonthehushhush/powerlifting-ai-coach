import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw } from './helpers/source.js';
import { startersFor, MAX_STARTERS } from '../src/lib/starters.js';

/**
 * ── WHY THIS FEATURE EXISTS ───────────────────────────────────────────────
 *
 * The funnel on 2026-09-06: the two newest signups completed the entire
 * intake - terms, AI processing, health-data and leaderboard consent, date of
 * birth, experience level, goal and units - then sent zero messages and never
 * came back. Nothing on the server refused them; consent was current, the
 * paywall was off, clearance gates the program block rather than the
 * conversation.
 *
 * What they were shown was "Say hello", a medical disclaimer, and a composer
 * asking "How did that session go?" about a session they had never had.
 */

const route = readRaw(new URL('../src/routes/chat.js', import.meta.url));
const schema = readRaw(new URL('../src/lib/profileSchema.js', import.meta.url));
const en = readRaw(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const page = readRaw(new URL('../../web/src/pages/Chat.jsx', import.meta.url));

/**
 * The block that computes the openers, bounded at BOTH ends.
 *
 * A region with only an opening boundary is not a region - this repository has
 * shipped that mistake and had a test quietly read half the file. Both markers
 * are asserted, so a rename fails loudly here instead of turning every
 * assertion below into a check on an empty string.
 */
function starterBlock() {
  const from = route.indexOf('let starters = []');
  const to = route.indexOf('// The limit travels with the conversation', from);
  assert.notEqual(from, -1, 'the openers block is gone - this check did not run');
  assert.notEqual(to, -1, 'the end marker moved - this check did not run');
  return route.slice(from, to);
}

/** Every experience level the schema accepts, legacy values included. */
const EXPERIENCE = (() => {
  const block = schema.slice(schema.indexOf('experience_level: z'));
  return [...block.slice(0, block.indexOf('])')).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
})();

/** Every goal the schema accepts. */
const GOALS = (() => {
  const block = schema.slice(schema.indexOf('goal: z'));
  return [...block.slice(0, block.indexOf('])')).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
})();

describe('everybody gets openers, including the rows nobody plans for', () => {
  test('the enums were actually read, so the sweep below is not empty', () => {
    // A parser that finds nothing passes every assertion under it. This file
    // is a sweep over the schema, so the sweep needs a floor.
    assert.ok(EXPERIENCE.length >= 8, `only found ${EXPERIENCE.length} experience levels`);
    assert.ok(GOALS.length >= 6, `only found ${GOALS.length} goals`);
  });

  test('EVERY COMBINATION THE SCHEMA ALLOWS PRODUCES OPENERS', () => {
    /*
     * Including the three legacy experience levels migration 0019 kept legal.
     * Those are real accounts, saved before the intake changed, and a rule
     * written against the current form silently gives them nothing - which is
     * exactly the blank screen this feature exists to remove, delivered only
     * to the oldest users, where it is hardest to notice.
     */
    for (const experience of [...EXPERIENCE, null]) {
      for (const goal of [...GOALS, null]) {
        const out = startersFor({ experience_level: experience, goal });
        assert.ok(out.length > 0, `no openers for ${experience} / ${goal}`);
        assert.ok(out.length <= MAX_STARTERS, `${out.length} openers for ${experience} / ${goal}`);
        assert.equal(new Set(out).size, out.length, `duplicate openers for ${experience} / ${goal}`);
      }
    }
  });

  test('and so does a missing profile, which is a real state', () => {
    // The intake can be abandoned halfway, and a person with no profile row is
    // the single most likely person to need a way in.
    for (const empty of [null, undefined, {}, { experience_level: null, goal: null }]) {
      assert.ok(startersFor(empty).length > 0, `no openers for ${JSON.stringify(empty)}`);
    }
  });

  test('every opener it can return has copy in the catalogue', () => {
    const produced = new Set();
    for (const experience of [...EXPERIENCE, null]) {
      for (const goal of [...GOALS, null]) startersFor({ experience_level: experience, goal }).forEach((k) => produced.add(k));
    }
    assert.ok(produced.size >= 5, `only ${produced.size} distinct openers exist`);
    const block = en.slice(en.indexOf('starters: {'));
    for (const id of produced) {
      assert.match(block.slice(0, 700), new RegExp(`\\b${id}:`), `chat.starters.${id} has no English copy`);
    }
  });
});

describe('the openers match what the person told the intake', () => {
  test('a beginner is not asked for numbers they do not have', () => {
    /*
     * The fastest way to make somebody feel they are in the wrong place is to
     * open by asking for a squat, bench and deadlift they have never done.
     */
    for (const experience of ['never_lifted', 'learning_lifts', 'under_6_months', 'never_trained']) {
      const out = startersFor({ experience_level: experience, goal: 'learn_the_lifts' });
      assert.ok(!out.includes('currentNumbers'), `${experience} was asked for their numbers`);
      assert.ok(out.includes('neverLifted'), `${experience} got no beginner opener`);
    }
  });

  test('and an experienced athlete is asked for them, because it saves a round trip', () => {
    for (const experience of ['six_to_24_months', 'over_2_years', 'currently_training']) {
      assert.ok(
        startersFor({ experience_level: experience, goal: 'general_strength' }).includes('currentNumbers'),
        `${experience} was not offered to hand over their numbers`
      );
    }
  });

  test('a meet goal leads with the meet', () => {
    for (const goal of ['first_meet', 'meet_prep']) {
      assert.equal(startersFor({ goal, experience_level: 'over_2_years' })[0], 'meet');
    }
  });

  test('coming back after time off leads with that', () => {
    assert.equal(startersFor({ goal: 'return_from_layoff' })[0], 'comingBack');
  });

  test('BODY COMPOSITION GETS NO OPENER ABOUT WEIGHT', () => {
    /*
     * It is a legitimate goal and it is the one whose obvious opener this
     * product will not put on a screen unprompted. The prompt carries
     * disordered-eating safeguards; an opener the athlete did not ask for is
     * the app raising the subject rather than answering it.
     */
    const out = startersFor({ goal: 'body_composition', experience_level: 'six_to_24_months' });
    const copy = out.map((id) => {
      const m = en.match(new RegExp(`\\b${id}: (['"])((?:(?!\\1).)*)\\1`));
      return m ? m[2] : '';
    }).join(' ');
    assert.doesNotMatch(copy, /\b(weight|lose|cut|fat|calorie|diet|leaner?)\b/i, `an opener mentions body weight: ${copy}`);
  });
});

describe('an athlete awaiting clearance is offered what the coach can do', () => {
  /*
   * A REAL ACCOUNT, NOT A HYPOTHETICAL. 2026-09-01: the whole intake
   * completed, `clearance_asserted {cleared: false}` in the audit log, and not
   * one message ever sent. The intake had just told them "Coach will not write
   * you a program until you have been cleared by a professional. It will still
   * answer questions in the meantime" - and the chat page they landed on said
   * nothing about any of it.
   */
  test('THEY ARE NOT OFFERED A PROGRAM THE COACH HAS REFUSED TO WRITE', () => {
    for (const experience of [...EXPERIENCE, null]) {
      for (const goal of [...GOALS, null]) {
        const out = startersFor({ experience_level: experience, goal }, { awaitingClearance: true });
        assert.ok(!out.includes('firstProgram'), `offered a program to an uncleared ${goal} athlete`);
        assert.ok(!out.includes('meet'), `offered meet prep to an uncleared ${goal} athlete`);
        assert.ok(!out.includes('howItWorks'), 'asked what the coach needs to write a program it will not write');
        assert.ok(out.length > 0, `no openers at all for an uncleared ${experience} / ${goal}`);
      }
    }
  });

  test('the clearance state overrides goal and experience, both', () => {
    // It is checked FIRST for a reason: a meet goal or a beginner's experience
    // would otherwise still steer the openers toward programming.
    assert.deepEqual(
      startersFor({ goal: 'first_meet', experience_level: 'never_lifted' }, { awaitingClearance: true }),
      startersFor({ goal: 'meet_prep', experience_level: 'over_2_years' }, { awaitingClearance: true })
    );
  });

  test('and the copy points at the clinician, not at a diagnosis', () => {
    /*
     * The product is not a doctor and its openers must not sound like one.
     * "What should I ask my doctor" is the app being useful about a boundary;
     * anything that reads as assessing the injury is the app crossing it.
     */
    const from = en.indexOf('clearanceWhatNow:');
    const to = en.indexOf('},', from);
    assert.notEqual(from, -1, 'the clearance copy is gone - this check did not run');
    assert.notEqual(to, -1, 'the end of the starters block moved - this check did not run');
    const block = en.slice(from, to);
    assert.ok(block.length > 100, `the clearance copy slice is only ${block.length} chars`);
    assert.match(block, /doctor|physical therapist/i, 'nothing points at a professional');
    assert.doesNotMatch(block, /\b(diagnos|treat|heal|cure|rehab protocol)/i, 'the copy strays into clinical advice');
  });

  test('the route computes it server-side and sends only ids', () => {
    // health_restrictions and cleared_to_train ARE health data. They are read
    // to produce a boolean and must never reach the chat page themselves.
    assert.match(route, /needsMedicalClearance\(profile\)/, 'the clearance state is not computed for the openers');
    assert.match(route, /health_restrictions, cleared_to_train/);
    /*
     * THE FIRST VERSION OF THIS ASSERTION WAS A NO-OP. It searched for
     * `starters:` followed by `health_restrictions` - and the route writes
     * `starters,` with a comma, shorthand property syntax, so the pattern
     * could never match anything. Planting the leak did not fail the suite.
     *
     * So it reads the RESPONSE BODY and names the columns, which is the
     * property rather than a guess at how it would be spelled.
     */
    const from = route.indexOf('res.json({', route.indexOf('let starters = []'));
    const to = route.indexOf('});', from);
    assert.notEqual(from, -1, 'the conversation response is gone - this check did not run');
    assert.notEqual(to, -1, 'the end of the response object moved - this check did not run');
    const body = route.slice(from, to);
    assert.match(body, /starters/, 'the wrong block was sliced - this check did not run');
    for (const column of ['health_restrictions', 'cleared_to_train', 'date_of_birth', 'bodyweight', 'gender']) {
      assert.ok(!body.includes(column), `the conversation response sends ${column} to the chat page`);
    }
  });
});

describe('what crosses the wire, and what does not', () => {
  test('THE PROFILE DOES NOT REACH THE CHAT PAGE', () => {
    /*
     * The route sends opener IDS, never the profile and never the sentences.
     * The chat screen has no business holding somebody's injuries or
     * restrictions, and "not sent anywhere it does not need to go" is a rule
     * about health data with teeth.
     */
    /*
     * The read widened deliberately once - health_restrictions and
     * cleared_to_train are needed to compute the clearance boolean. The list is
     * pinned exactly, so the next widening is a decision somebody makes rather
     * than a column that drifts in.
     */
    assert.match(
      route,
      /\.select\('experience_level, goal, health_restrictions, cleared_to_train'\)/,
      'the profile read has changed - widening it sends more health data to a page that may not need it'
    );
    assert.doesNotMatch(route, /\.select\('\*'\)[\s\S]{0,120}user_profile/);
    assert.match(route, /starters = startersFor\(profile, \{ awaitingClearance: needsMedicalClearance\(profile\) \}\)/);
    // And the ids carry no copy with them.
    assert.doesNotMatch(route, /Where do we start/);
  });

  test('the openers are only computed for an empty conversation', () => {
    // A returning athlete's page load should not pay for a query whose answer
    // it would throw away.
    assert.match(route, /if \(empty\) \{/);
    const block = starterBlock();
    assert.match(block, /messages\.length === 0/);
  });

  test('a failed profile read degrades to no openers, not to a broken page', () => {
    // They are a help. The page without them is the page as it was.
    assert.doesNotMatch(starterBlock(), /throw codedError/, 'a failed profile read breaks the chat page');
  });
});

describe('the openers fill the box; they do not send', () => {
  test('CLICKING ONE SETS THE DRAFT AND CALLS NOTHING', () => {
    /*
     * A beginner should see the words going out under their name before they
     * go, and be able to change them - their real situation is more specific
     * than any canned line, and the edit is where that specificity gets in.
     * Sending on tap would also spend a trial reply on a mis-tap.
     */
    const onClick = page.slice(page.indexOf('className="starter"'), page.indexOf('</button>', page.indexOf('className="starter"')));
    assert.match(onClick, /setDraft\(t\(`chat\.starters\.\$\{id\}`\)\)/);
    assert.doesNotMatch(onClick, /send|submit|api\./i, 'tapping an opener sends it');
  });

  test('and the composer stops asking about a session that never happened', () => {
    assert.match(page, /messages\.length === 0 \? t\('chat\.placeholderFirst'\) : t\('chat\.placeholder'\)/);
    assert.match(en, /placeholderFirst:/);
  });
});
