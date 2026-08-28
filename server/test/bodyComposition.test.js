import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';
import { COACH_ROLE, buildSystemPrompt } from '../src/prompts/systemPrompt.js';

/**
 * ── WHAT THIS FEATURE COULD GET WRONG ──────────────────────────────────────
 *
 * Three things, in descending order of harm:
 *
 *   1. Having an opinion about somebody's medication. Whether to start, stay
 *      on, or stop a GLP-1 is between them and a prescriber. A fitness app
 *      that weighs in there is practising medicine, and the fact that it would
 *      be discouraging rather than encouraging use makes it worse, not better.
 *   2. Storing medication data outside the health-data consent gate. The
 *      trigger from 0008 guarded ONE column by name and fails open for a
 *      second - a new field would have been writable with no consent at all.
 *   3. Turning a fat-loss goal into a calorie prescription, or into an opinion
 *      about how somebody should look.
 */

const promptRaw = readRaw(new URL('../src/prompts/systemPrompt.js', import.meta.url));
const migration = readRaw(new URL('../../supabase/migrations/0033_body_composition.sql', import.meta.url));
const logger = readSource(new URL('../src/lib/logger.js', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

const SECTION = (() => {
  const start = COACH_ROLE.indexOf('# LOSING FAT WITHOUT LOSING THE LIFT');
  assert.ok(start !== -1, 'the section is not in COACH_ROLE');
  const rest = COACH_ROLE.slice(start + 1);
  const end = rest.indexOf('\n# ');
  return end === -1 ? rest : rest.slice(0, end);
})();

describe('THE COACH HAS NO VIEW ON THE MEDICATION', () => {
  test('it says so, plainly, rather than hedging', () => {
    assert.match(SECTION, phrase('You are not going to have a view on whether they should be'));
    assert.match(SECTION, phrase('between them and the person who prescribes it'));
  });

  test('and gives the same answer to somebody merely considering one', () => {
    // The state a lot of people are actually in, and the one where an app is
    // most tempted to editorialise.
    assert.match(SECTION, phrase('it is a conversation for their prescriber'));
  });

  test('it never discourages use, in either direction', () => {
    // The product must not campaign against a prescription drug. Checked as
    // absence of the vocabulary that would do it.
    for (const word of ['instead of', 'avoid taking', 'without drugs', 'naturally instead',
                        'side effect', 'brain health', 'dangerous']) {
      assert.ok(
        !SECTION.toLowerCase().includes(word),
        `the fat-loss section says "${word}", which is an opinion about a medication`,
      );
    }
  });

  test('what it DOES claim is the training effect, which is the evidenced part', () => {
    assert.match(SECTION, phrase('a large share of the weight lost is lean mass rather than fat'));
    assert.match(SECTION, phrase('cuts that loss substantially without slowing the fat loss'));
    assert.match(SECTION, phrase('Cardio alone does not do it'));
  });

  test('and the practical problem it solves is protein under appetite suppression', () => {
    assert.match(SECTION, phrase('Protein is the thing that must not fall out'));
    assert.match(SECTION, phrase('ask rather than assume'));
  });
});

describe('the fat-loss coaching itself', () => {
  test('THE TRAINING DOES NOT BECOME "TONING"', () => {
    // Cutting the weight and adding reps removes the one stimulus protecting
    // the muscle, and it is the most common thing a fat-loss programme gets
    // wrong.
    assert.match(SECTION, phrase('there is no such thing'));
    assert.match(SECTION, phrase('removes the one stimulus that was protecting their muscle'));
  });

  test('a stall is predicted in advance rather than explained afterwards', () => {
    // Unwarned, an athlete reads a stalled squat as failure and eats less or
    // trains more - exactly the wrong direction.
    assert.match(SECTION, phrase('SAY SO BEFORE IT DOES'));
    assert.match(SECTION, phrase('holding the same weights while getting lighter IS progress'));
  });

  test('and a single weigh-in is never treated as information', () => {
    assert.match(SECTION, phrase('THE SCALE IS NOISY AND THE NOISE IS BIGGER THAN THE SIGNAL'));
  });
});

describe('the calorie prohibition survived a goal built around losing weight', () => {
  test('IT IS RESTATED, AND STRENGTHENED, INSIDE THIS SECTION', () => {
    // The whole risk of the addition: "help me lose fat" is one step from
    // "give me a number", and this is the goal where somebody would act on it.
    assert.match(SECTION, phrase('Do not give a calorie target'));
    assert.match(SECTION, phrase('that prohibition does not weaken'));
  });

  test('the disordered-eating rules outrank everything here', () => {
    assert.match(SECTION, phrase('OUTRANK EVERYTHING IN THIS SECTION without exception'));
  });

  test('the numbers it may give are the computed ones, not invented ones', () => {
    // protein and rate of loss already exist in lib/nutrition.js, sourced and
    // tested. The section points at them rather than restating figures.
    assert.match(SECTION, phrase('THE NUMBERS YOU MAY GIVE ARE THE ONES THAT ARE COMPUTED'));
  });

  test('and there is no ideal body anywhere in it', () => {
    assert.match(SECTION, phrase('There is no ideal body in this product'));
    assert.match(SECTION, phrase('do not comment on appearance'));
  });
});

describe('the field is health data and is treated as such', () => {
  test('THE CONSENT GATE COVERS IT, NOT JUST health_restrictions', () => {
    // The 0008 trigger guarded one column by name. A second field would have
    // been writable with no health-data consent at all - silently, because the
    // trigger simply was not looking at it.
    assert.match(migration, /v_glp1 text := nullif\(new\.glp1_status, 'declined_to_say'\)/);
    assert.match(migration, phrase('it is a hole with a comment over it'));
  });

  test('but declining to answer needs no consent, or declining is impossible', () => {
    // Requiring health-data consent to record that somebody declined to give
    // health data would mean the only way to decline is to consent first.
    assert.match(migration, phrase("'declined_to_say' is deliberately NOT treated as health data"));
  });

  test('it is redacted from logs by name, since "medication" does not match it', () => {
    assert.match(logger, /'glp1', 'glp_1'/);
    for (const brand of ['semaglutide', 'ozempic', 'wegovy', 'tirzepatide']) {
      assert.ok(logger.includes(brand), `${brand} is not on the redaction list`);
    }
  });

  test('and it expires with the other health fields', () => {
    assert.match(migration, /'glp1_status', 12,/);
    assert.match(migration, /set glp1_status = null,\s*glp1_status_updated_at = null/);
  });

  test('with its own timestamp, not user_profile.updated_at', () => {
    assert.match(migration, /add column if not exists glp1_status_updated_at timestamptz/);
  });
});

describe('what reaches the model', () => {
  test('the answer is sent when it says something', () => {
    const built = buildSystemPrompt({ profile: { units: 'lb', goal: 'body_composition', glp1_status: 'using' } });
    assert.match(built, /glp1:\s+using/);
  });

  test('AND "PREFER NOT TO SAY" IS NOT', () => {
    // Passing "this person refused to answer" into a third-party request tells
    // the model nothing it can coach on, and hands over a fact about
    // somebody's unwillingness to discuss their medication.
    const built = buildSystemPrompt({ profile: { units: 'lb', glp1_status: 'declined_to_say' } });
    assert.doesNotMatch(built, /glp1:/);
    assert.match(promptRaw, phrase('hands over a fact about'));
  });

  test('nor is an unanswered one', () => {
    assert.doesNotMatch(buildSystemPrompt({ profile: { units: 'lb' } }), /glp1:/);
  });
});

describe('the question is asked well', () => {
  test('only when the goal is losing fat, and it can be skipped', () => {
    const intake = readSource(new URL('../../web/src/pages/Intake.jsx', import.meta.url));
    assert.match(intake, /form\.goal === 'body_composition' && \(/);
    assert.match(en, phrase('Optional, and you can skip it'));
  });

  test('and the copy says why it is asked and what will not happen', () => {
    assert.match(en, phrase('It is asked for one reason'));
    assert.match(en, phrase('will never tell you whether to take one'));
  });

  test('the goal reads as a goal, not as an appearance standard', () => {
    assert.match(en, /body_composition: 'Lose fat and keep the muscle I build'/);
  });
});
