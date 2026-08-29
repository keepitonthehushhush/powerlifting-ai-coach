import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeYouthProgramming,
  buildSystemPrompt,
  buildSystemBlocks,
} from '../src/prompts/systemPrompt.js';
import { phrase, readSource } from './helpers/source.js';

/**
 * What the coach is told when the athlete is thirteen.
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────
 *
 * Every other directive in the prompt shapes advice. This one decides whether
 * a fifteen-year-old is told to attempt a maximal single alone in a garage,
 * and whether a coach with a worried parent in front of it gives a straight
 * answer about growth plates or a hedge. The numbers in it are not style
 * choices - they are the NSCA's youth position statement, and a test that does
 * not pin them lets them drift into whatever sounds reasonable next year.
 */

const asOf = new Date('2026-08-29T00:00:00Z');
const born = (age) => new Date(Date.UTC(2026 - age, 0, 1)).toISOString().slice(0, 10);
const forAge = (age) => describeYouthProgramming({ date_of_birth: born(age) }, asOf);

describe('the youth directive appears exactly where it should', () => {
  test('for every age under 18 with a readable date', () => {
    for (let age = 5; age < 18; age++) {
      assert.ok(forAge(age), `age ${age} got no youth directive`);
    }
  });

  test('and never for an adult', () => {
    for (let age = 18; age <= 70; age++) {
      assert.equal(forAge(age), null, `age ${age} was given youth programming rules`);
    }
  });

  test('and not invented from a date it cannot read', () => {
    for (const dob of [null, undefined, '', 'not a date']) {
      assert.equal(describeYouthProgramming({ date_of_birth: dob }, asOf), null);
    }
    assert.equal(describeYouthProgramming(null, asOf), null);
    assert.equal(describeYouthProgramming({}, asOf), null);
  });

  /**
   * ── THE ONE THAT COSTS MONEY IF IT BREAKS ─────────────────────────────
   *
   * The cached prefix is one entry shared by every athlete, and it only ever
   * hits when the prefix is byte-identical to a previous request. Putting a
   * per-athlete directive behind the breakpoint would rewrite the entry on
   * every message and cost 25% MORE than not caching at all - and nothing
   * would fail. The bill would just change.
   *
   * It is also the property that lets a shared cache entry be reasoned about
   * on a health-data product: the cached block holds our instructions and no
   * athlete's data, including the fact that an athlete is a child.
   */
  test('it lives in the varying block, and the cached prefix is identical for a minor and an adult', () => {
    const minor = buildSystemBlocks({ profile: { units: 'lb', date_of_birth: born(15) } });
    const adult = buildSystemBlocks({ profile: { units: 'lb', date_of_birth: born(40) } });

    assert.equal(minor[0].text, adult[0].text, 'the cached prefix differs between a minor and an adult');
    assert.ok(minor[0].cache_control, 'the breakpoint moved off the first block');
    assert.equal(adult[1].cache_control, undefined, 'the varying block must not be cached');

    assert.ok(!minor[0].text.includes('THIS ATHLETE IS A MINOR'), 'a minority flag reached the shared cache entry');
    assert.ok(minor[1].text.includes('THIS ATHLETE IS A MINOR'), 'the coach is never told');
  });
});

describe('what the directive actually says', () => {
  const youth = forAge(15);

  /**
   * Quoted from the NSCA's updated position statement on youth resistance
   * training. If somebody widens these, the widening should be a decision with
   * a source behind it rather than a number that felt about right.
   */
  test('it carries the NSCA rep ranges and progression rate', () => {
    assert.match(youth, phrase('1-3 sets of'));
    assert.match(youth, phrase('6-15 repetitions'), 'the strength range is not the published one');
    assert.match(youth, phrase('1-3 sets of 3-6'), 'the power range is not the published one');
    assert.match(youth, phrase('5-10%'), 'the progression rate is not the published one');
  });

  test('it forbids maximal singles, and for the defensible reason', () => {
    assert.match(youth, phrase('Maximal singles. Do not write them'));
    assert.match(youth, phrase('testing a one-rep max'));

    // The honest reason. The NSCA does NOT say maximal testing harms youth -
    // it says it is safe GIVEN habituation and close qualified supervision,
    // which is the condition this product cannot meet. A coach told the wrong
    // reason cannot answer a parent who has read the statement, and will
    // invent a physiological claim to fill the gap.
    assert.match(youth, phrase('It is not that maximal lifting damages teenagers'));
    assert.match(youth, phrase('rests on close supervision by a qualified professional and a habituation period'));
    assert.match(youth, phrase('unsupervised by definition'));
    assert.match(youth, phrase('Do not invent a physiological reason you cannot defend'));
  });

  test('it answers the growth plate question plainly rather than hedging', () => {
    assert.match(youth, phrase('injury to growth cartilage has not been reported in any prospective study'));
    assert.match(youth, phrase('without hedging'));
    assert.match(youth, phrase('Do not soften that into a non-answer'));
  });

  test('supervision is said once, not nagged', () => {
    assert.match(youth, phrase('Say that once'));
    assert.match(youth, phrase('Repeating it every session is nagging'));
  });

  test('body composition is stricter here than anywhere else', () => {
    for (const forbidden of ['body composition', 'cutting', 'weight classes']) {
      assert.ok(youth.includes(forbidden), `${forbidden} is not named`);
    }
    assert.match(youth, phrase('never raise'));
    assert.match(youth, phrase('do not help them lose weight'));
    assert.match(youth, phrase('are a floor; this is well above it'));
  });

  /**
   * A prohibition alone is half a specification. Told only that an athlete is
   * a woman, a model reaches for lighter loads and unrequested talk about body
   * composition; told only that one is fifteen, it hedges, moralizes and stops
   * coaching. The negative space has to be written down at the same length.
   */
  test('the negative space is written down too', () => {
    assert.match(youth, phrase('Do not become timid'));
    assert.match(youth, phrase('Do not moralize'));
    assert.match(youth, phrase('Do not refuse to coach'));
    assert.match(youth, phrase('Do not bring it up every message'));
  });

  test('it does not contradict the AGE section it sits under', () => {
    // COACH_ROLE says "Do not make age a running theme." A directive telling
    // the coach to mention being a minor constantly would put the prompt in
    // conflict with itself, which is the first thing to suspect when an eval
    // fails intermittently on unchanged code.
    const whole = buildSystemPrompt({ profile: { units: 'lb', date_of_birth: born(15) } });
    assert.match(whole, phrase('Do not make age a running theme'));
    assert.match(youth, phrase('otherwise coach the athlete in front of you'));
  });

  /**
   * ── ORDERING IS A SAFETY PROPERTY, SO IT IS ASSERTED BY POSITION ──────
   *
   * The same idiom the paywall test uses for the adult gate: position IS the
   * ordering, so read it out of the source rather than trying to reconstruct
   * it from an assembled prompt, where a fixture with an incomplete intake
   * silently suppresses half the directives and the test passes having
   * compared nothing.
   *
   * The coach has to know what KIND of training it may write before it is
   * told what to load. A rep-range constraint arriving after the
   * prescriptions is a correction rather than a brief.
   */
  test('the youth rules reach the coach before the phase and the prescriptions', () => {
    const source = readSource(new URL('../src/prompts/systemPrompt.js', import.meta.url));
    const body = source.slice(source.indexOf('function buildSystemParts('));
    const pushes = [...body.matchAll(/directives\.push\((\w+)/g)].map((m) => m[1]);

    const at = (name) => {
      const i = pushes.indexOf(name);
      assert.notEqual(i, -1, `${name} is no longer pushed into the directives at all`);
      return i;
    };

    assert.ok(at('youth') < at('phase'), 'the youth rules arrive after the training phase');
    assert.ok(
      at('youth') < at('prescriptionDirective'),
      'the coach is told what to load before it is told the rep ranges it must stay inside'
    );
  });

  /**
   * Being fifteen is not a programming variable a gate can switch off. The
   * body-composition rule and the supervision line apply to every sentence
   * the coach writes, including the one telling them to see a doctor - so
   * unlike the phase and the fuelling directives, this one is never
   * suppressed while the clearance gate is up.
   */
  test('it survives the medical clearance gate', () => {
    const underGate = buildSystemPrompt({
      profile: {
        units: 'lb',
        date_of_birth: born(15),
        health_restrictions: 'lower back pain when deadlifting',
        cleared_to_train: false,
      },
    });
    assert.match(underGate, /MEDICAL CLEARANCE GATE IS ACTIVE/, 'the fixture did not raise the gate');
    assert.match(underGate, /THIS ATHLETE IS A MINOR/, 'the youth rules were suppressed by the clearance gate');
  });

  test('it states the age it is talking about', () => {
    assert.match(forAge(13), phrase('They are 13.'));
    assert.match(forAge(17), phrase('They are 17.'));
  });
});
