import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';

const page = readRaw(new URL('../../web/src/pages/ForYourClinician.jsx', import.meta.url));
const app = readSource(new URL('../../web/src/App.jsx', import.meta.url));
const css = readSource(new URL('../../web/src/styles.css', import.meta.url));

/** The prompt as an injured, uncleared athlete would receive it. */
const gatedPrompt = buildSystemPrompt({
  profile: {
    units: 'lb',
    bodyweight: 181,
    health_restrictions: 'sharp lower back pain for two weeks',
    cleared_to_train: false,
  },
});

describe('the clinician page is pinned to the system, not to itself', () => {
  /**
   * ── WHY THESE TESTS ARE SHAPED THIS WAY ──────────────────────────────────
   *
   * Every behavioural claim on that page is a claim about this system, made to
   * somebody who may rely on it clinically. The usual way a document like this
   * goes wrong is not that it was written badly - it is that it was written
   * accurately and then the product moved.
   *
   * So these assert the PROMPT still forbids what the PAGE says it forbids. If
   * a future change relaxes the clearance gate, this suite fails and names the
   * document that has started lying, rather than the document quietly becoming
   * a misrepresentation to a doctor.
   */

  test('the refusal to program while uncleared is real', () => {
    assert.match(page, /refuses to write or\s+adjust a training programme until they confirm/);
    assert.match(gatedPrompt, /MEDICAL CLEARANCE GATE IS ACTIVE/);
    assert.match(gatedPrompt, /write, adjust, or hand over a training program/);
  });

  test('the claim that the gate is decided in code is true', () => {
    // This is the load-bearing sentence for a sceptical clinician, and the
    // one it would be most tempting to write without checking.
    assert.match(page, /decided in code, not by the model, so it cannot be talked out of it/);
    const ungated = buildSystemPrompt({
      profile: { units: 'lb', health_restrictions: '', cleared_to_train: false },
    });
    assert.doesNotMatch(ungated, /MEDICAL CLEARANCE GATE IS ACTIVE/);
  });

  test('the claim about never saying which lifts are safe is true', () => {
    assert.match(page, /forbidden from saying that any lift is safe to continue/);
    // Whitespace-tolerant: the JSX is hard-wrapped mid-sentence, so the
    // phrase spans a newline and twelve spaces of indent.
    assert.match(page, /keep going as long as it\s+doesn/);
    assert.match(gatedPrompt, /SCOPE THE INJURY/);
    assert.match(gatedPrompt, /as long as it doesn't hurt/);
  });

  test('the claim about not confining pain to one lift is true', () => {
    assert.match(page, /treating pain noticed during one lift as a\s+problem confined to that lift/);
    assert.match(gatedPrompt, /Assume nothing is excluded/);
  });

  test('the claims about symptom relief and rehab are true', () => {
    assert.match(page, /stretches, mobility work, .corrective. exercises, rehab\s+movements, ice, heat, medication or supplements/);
    assert.match(gatedPrompt, /suggest stretches, mobility work/);
    assert.match(gatedPrompt, /suggest ice, heat, medication, supplements/);
  });

  test('the claims about diagnosis and prognosis are true', () => {
    assert.match(page, /will not diagnose, or estimate severity or recovery time/);
    assert.match(gatedPrompt, /estimate severity, likely cause, or how long recovery should take/);
  });

  test('the nutrition claims match the boundary the prompt actually draws', () => {
    const open = buildSystemPrompt({ profile: { units: 'lb', bodyweight: 181, health_restrictions: '' } });
    assert.match(page, /will not give calorie targets, meal plans, or weight-cutting protocols/);
    assert.match(open, /NEVER give a daily calorie target/);
    assert.match(open, /NEVER write a meal plan/);
    // And the permitted half, stated so the clinician knows what it MAY say.
    assert.match(page, /general nutrition information, not medical nutrition\s+therapy/);
    assert.match(open, /Refer to a registered dietitian/);
  });

  test('the eating-disorder and PED claims are true', () => {
    assert.match(page, /National Alliance for Eating Disorders/);
    assert.match(gatedPrompt, /National Alliance for Eating Disorders/);
    assert.match(page, /will not discuss performance-enhancing drug protocols/);
  });

  test('the claim that coaching is never withheld as leverage is true', () => {
    assert.match(page, /does not withhold coaching to pressure a lifestyle change/);
    assert.match(gatedPrompt, /NEVER make coaching conditional on a lifestyle change/);
  });

  test('the description of how loads are computed matches the engine', () => {
    // Ten percent after three consecutive misses is a specific number, and a
    // specific number on a clinician-facing page has to be the real one.
    assert.match(page, /reduce by ten percent after three consecutive\s+misses/);
    const progression = readSource(new URL('../src/lib/progression.js', import.meta.url));
    assert.match(progression, /MISSES_BEFORE_DELOAD = 3/);
    assert.match(progression, /DELOAD_FRACTION = 0\.1/);
    assert.match(page, /instructed not to recalculate it/);
  });

  test('the under-18 claim matches the age gate', () => {
    assert.match(page, /under 18 cannot record injury or lifestyle information/);
    const ageGate = readSource(new URL('../src/lib/ageGate.js', import.meta.url));
    assert.match(ageGate, /MINIMUM_AGE = 18/);
  });
});

describe('it is usable by somebody who is not the patient', () => {
  test('it is readable without an account', () => {
    // A page you must sign up to read is useless to a physiotherapist holding
    // a phone in a treatment room.
    const route = app.slice(app.indexOf('path="/about"'));
    assert.doesNotMatch(route.slice(0, 120), /ProtectedRoute/);
    assert.match(page, /Nothing on this page requires an account to read/);
  });

  test('it says plainly what it is not', () => {
    assert.match(page, /not a medical device/);
    assert.match(page, /not a clinical decision tool/);
    assert.match(page, /not\s+supervised by a healthcare professional/);
  });

  test('it gives the clinician a route to act, not just reassurance', () => {
    // The question a doctor actually has is "what do I do about it".
    assert.match(page, /If you want something changed or stopped/);
    assert.match(page, /To stop programming:/);
    assert.match(page, /To set restrictions:/);
    assert.match(page, /To stop entirely:/);
  });

  test('it states its own limitations rather than only its guarantees', () => {
    assert.match(page, /self-reported and unverified/);
    assert.match(page, /a sample of\s+behaviour rather than a guarantee of it/);
  });

  test('it prints as something you can hand over', () => {
    const print = css.slice(css.indexOf('@media print'));
    assert.ok(print.length > 0, 'there are no print rules');
    // A screen stylesheet printed unchanged gives a dark background and a
    // floating grey circle over the text.
    assert.match(print, /background: #fff !important/);
    assert.match(print, /\.back-to-top[^}]*display: none !important/s);
    // Link targets, because paper cannot be clicked.
    assert.match(print, /content: " \(coachdiaz\.app" attr\(href\) "\)"/);
    // And no heading stranded at the foot of a page.
    assert.match(print, /break-after: avoid-page/);
  });
});
