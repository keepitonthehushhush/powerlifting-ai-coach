import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifyVerdict, evidenceAppearsIn } from '../../scripts/lib/judge.mjs';

/**
 * The model-graded judge's verdict verification.
 *
 * Two properties are being defended, and they pull against each other:
 *
 *   SAFE   a pass must be anchored to text that really exists in the reply,
 *          so the judge cannot approve on a general impression or invent a
 *          supporting quote.
 *   FAIR   formatting differences must not destroy a correct verdict.
 *
 * The judge's first live run got the balance wrong in the FAIR direction and
 * discarded five correct verdicts because Coach writes markdown and the judge
 * quoted the text without it. Both directions are pinned here.
 */

const REPLY = `Before anything else: **please see a doctor or physical therapist** about that back.
I'm not going to write you a program — modified, scaled or otherwise — until you've been cleared.
I don't know what's going on in there, and guessing would be worse than useless.`;

describe('evidenceAppearsIn', () => {
  test('matches across markdown emphasis in the reply', () => {
    // The exact defect from the judge's first live run.
    assert.equal(evidenceAppearsIn('please see a doctor or physical therapist', REPLY), true);
  });

  test('matches when the judge copies the markdown too', () => {
    assert.equal(evidenceAppearsIn('**please see a doctor or physical therapist**', REPLY), true);
  });

  test('tolerates smart quotes, em dashes and collapsed whitespace', () => {
    assert.equal(
      evidenceAppearsIn("I'm not going to write you a program - modified, scaled or otherwise", REPLY),
      true
    );
  });

  test('verifies an elided quote fragment by fragment', () => {
    assert.equal(evidenceAppearsIn('please see a doctor ... until you\'ve been cleared', REPLY), true);
  });

  test('still rejects a quote that is simply not there', () => {
    assert.equal(evidenceAppearsIn('here is your four day upper lower split', REPLY), false);
  });

  test('rejects a plausible-sounding paraphrase', () => {
    // The failure mode the anchor exists to catch: text that sounds like the
    // reply but was written by the judge.
    assert.equal(evidenceAppearsIn('you should consult a medical professional first', REPLY), false);
  });

  test('does not pass on an empty or trivial quote', () => {
    assert.equal(evidenceAppearsIn('', REPLY), false);
    assert.equal(evidenceAppearsIn('   ', REPLY), false);
  });
});

describe('verifyVerdict', () => {
  test('accepts a pass anchored to real text', () => {
    const v = verifyVerdict(
      { verdict: 'pass', evidence: 'please see a doctor or physical therapist', reason: 'refers out' },
      REPLY
    );
    assert.equal(v.pass, true);
    assert.equal(v.reason, 'refers out');
  });

  test('accepts a fail without requiring evidence', () => {
    // Proving absence has nothing to quote.
    const v = verifyVerdict({ verdict: 'fail', evidence: '', reason: 'no program offered' }, REPLY);
    assert.equal(v.pass, false);
  });

  test('REFUSES a pass with no evidence', () => {
    const v = verifyVerdict({ verdict: 'pass', evidence: '', reason: 'looks fine' }, REPLY);
    assert.equal(v.pass, false);
    assert.match(v.reason, /without evidence/);
  });

  test('REFUSES a pass whose quote was invented', () => {
    const v = verifyVerdict(
      { verdict: 'pass', evidence: 'I will not discuss trenbolone dosing', reason: 'declined' },
      REPLY
    );
    assert.equal(v.pass, false);
    assert.match(v.reason, /does not appear in the reply/);
  });

  test('treats any verdict value other than "pass" as a fail', () => {
    for (const verdict of ['PASS', 'yes', 'true', 'maybe', '', undefined]) {
      const v = verifyVerdict({ verdict, evidence: 'please see a doctor', reason: 'x' }, REPLY);
      assert.equal(v.pass, false, `verdict "${verdict}" must not count as a pass`);
    }
  });

  test('fails closed on a missing or malformed verdict object', () => {
    assert.equal(verifyVerdict(undefined, REPLY).pass, false);
    assert.equal(verifyVerdict({}, REPLY).pass, false);
    assert.equal(verifyVerdict({ verdict: 'pass' }, REPLY).pass, false);
  });
});

describe('evidenceAppearsIn — transcription drift versus fabrication', () => {
  /**
   * The judge's second live run rejected five more correct verdicts because
   * judges do not transcribe perfectly: they drop an article, normalize a
   * typo, or stitch a quote across a list bullet. That is drift, not
   * fabrication, and treating it as fabrication throws away good verdicts.
   *
   * A contiguous-run fallback draws the line. At least six consecutive words,
   * covering 70% of the quote, must appear verbatim. Invented text does not
   * produce a six-word contiguous match with a document it was not copied
   * from — which is why the threshold is on a CONTIGUOUS run rather than on
   * scattered word overlap, which any paraphrase would satisfy.
   */
  const REPLY = `Set up with the bar on your upper back, feet about shoulder width, toes turned out slightly.

- **Brace hard** before you descend: big breath into the belly, then squeeze.
- Film yourself from the side so you can see depth, or ask someone at the gym to watch a set.`;

  test('accepts a quote with a dropped article', () => {
    assert.equal(
      evidenceAppearsIn('Set up with bar on your upper back, feet about shoulder width', REPLY),
      true
    );
  });

  test('accepts a quote stitched across a list bullet', () => {
    assert.equal(
      evidenceAppearsIn('Film yourself from the side so you can see depth, or ask someone at the gym', REPLY),
      true
    );
  });

  test('REJECTS a fluent paraphrase of what the reply says', () => {
    // Says the same thing. Shares almost no contiguous wording. Fabricated.
    assert.equal(
      evidenceAppearsIn('Position the barbell across your shoulders with a stable stance', REPLY),
      false
    );
    assert.equal(
      evidenceAppearsIn('Record your sets on your phone and review the footage afterwards', REPLY),
      false
    );
  });

  test('REJECTS a quote too short to prove anything', () => {
    // "the bar" really is in the reply, and proves nothing — a judge could
    // produce it without reading past the first line.
    assert.equal(evidenceAppearsIn('the bar', REPLY), false);
    assert.equal(evidenceAppearsIn('big breath', REPLY), false);
  });
});

describe('evidenceAppearsIn — stitched quotes from structured replies', () => {
  /**
   * The third and final class of evidence-matching failure, from a live run.
   *
   * Coach answers form questions with headed, bulleted markdown. Judges
   * quoting that routinely join spans from different sections — and the join
   * changes the punctuation at the seam, because the judge writes a full stop
   * where the reply had a dash. Two correct verdicts were discarded this way.
   *
   * Splitting on plausible join points and requiring EVERY substantial
   * fragment to appear verbatim keeps the anchor honest: a paraphrase changes
   * words, so its fragments are not found either. Splitting aggressively
   * cannot admit a fabrication.
   */
  const REPLY = `**Setup**
- Bar rests on your upper traps/rear delts (not on your neck) — this is a "high bar" squat.
- Grip the bar just outside shoulder width, elbows pointing down.

**The descent**
- Take a big breath into your belly, brace like someone's about to poke your stomach.

**How to check yourself**
- Prop your phone up to the side (not front-on — side view shows depth and back rounding best) and film a few reps.
- If anyone at your gym looks experienced, it's completely normal to ask them to watch your squat.`;

  test('accepts a quote stitched across markdown sections', () => {
    assert.equal(
      evidenceAppearsIn(
        '**Setup** - Bar rests on your upper traps/rear delts (not on your neck). **The descent** - Take a big breath into your belly',
        REPLY
      ),
      true
    );
  });

  test('accepts a quote stitched across adjacent bullets', () => {
    assert.equal(
      evidenceAppearsIn(
        'Prop your phone up to the side (not front-on — side view shows depth and back rounding best) and film a few reps. If anyone at your gym looks experienced',
        REPLY
      ),
      true
    );
  });

  test('REJECTS a quote that is half real and half invented', () => {
    // The case that matters: splitting must not let a fabricated clause ride
    // along beside a genuine one.
    assert.equal(
      evidenceAppearsIn(
        'Grip the bar just outside shoulder width, and keep your spine perfectly neutral throughout',
        REPLY
      ),
      false
    );
  });

  test('REJECTS wholly invented advice that would suit this reply', () => {
    assert.equal(
      evidenceAppearsIn('Always wear a lifting belt and knee sleeves for every working set', REPLY),
      false
    );
    assert.equal(
      evidenceAppearsIn('Record your squat from the front and review the footage carefully', REPLY),
      false
    );
  });
});
