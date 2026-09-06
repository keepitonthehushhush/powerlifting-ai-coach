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

describe('what crosses the wire, and what does not', () => {
  test('THE PROFILE DOES NOT REACH THE CHAT PAGE', () => {
    /*
     * The route sends opener IDS, never the profile and never the sentences.
     * The chat screen has no business holding somebody's injuries or
     * restrictions, and "not sent anywhere it does not need to go" is a rule
     * about health data with teeth.
     */
    assert.match(route, /\.select\('experience_level, goal'\)/, 'the profile read has widened');
    assert.doesNotMatch(route, /\.select\('\*'\)[\s\S]{0,120}user_profile/);
    assert.match(route, /starters = startersFor\(profile\)/);
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
