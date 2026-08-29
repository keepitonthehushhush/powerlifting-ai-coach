import { Link } from 'react-router-dom';

/**
 * A page an athlete can hand to their doctor or physiotherapist.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The clearance gate tells an injured athlete to go and get seen, and helps
 * them prepare what to describe. Then they arrive at the appointment and have
 * to explain what has been programming their training - to a clinician who has
 * every reason to be sceptical of "an AI told me to squat".
 *
 * This is that explanation, written for the clinician rather than for the
 * athlete. It answers the three questions a doctor actually has: what is this
 * thing, what will it refuse to do, and what happens if I tell my patient to
 * stop or to modify something.
 *
 * ── PUBLIC ON PURPOSE ─────────────────────────────────────────────────────
 *
 * No auth. A page you must create an account to read is useless to a
 * physiotherapist holding a phone in a treatment room, and requiring a login
 * to read what the product refuses to do would be its own kind of answer.
 *
 * ── AND IT HAS TO BE TRUE ─────────────────────────────────────────────────
 *
 * Every behavioural claim here is a claim about the system, made to somebody
 * who may rely on it clinically. So the tests hold this page to the system
 * prompt rather than to itself: if the clearance gate stops forbidding
 * something this page says it forbids, the suite fails. That is the whole
 * point of the file. A clinician-facing document that drifts from the product
 * is worse than none, because it will be believed.
 *
 * It is deliberately printable - see the print rules in styles.css - because
 * the realistic thing an athlete does is bring a sheet of paper.
 */
export function ForYourClinician() {
  return (
    <div className="page prose-page">
      <header className="page-header">
        <h1>About Coach Diaz — information for your clinician</h1>
        <p className="muted">
          Written to be printed or shown to a doctor, physical therapist, or other healthcare
          professional. Nothing on this page requires an account to read.
        </p>
      </header>

      <div className="card prose">
        <h2 className="h3">What this is, in one sentence</h2>
        <p>
          Coach Diaz is a software strength coach that writes and progresses barbell training
          programs for the squat, bench press, deadlift and overhead press.{' '}
          <strong>
            It is not a medical device, it is not a clinical decision tool, and it is not
            supervised by a healthcare professional.
          </strong>
        </p>

        <h2 className="h3">What it will refuse to do</h2>
        <p>
          This is likely the part you want. These are enforced restrictions, not aspirations —
          several are computed in code before the language model is involved at all.
        </p>
        <ul>
          <li>
            <strong>It stops programming entirely when an injury is reported.</strong> If your
            patient records any injury, pain or medical condition, the system refuses to write or
            adjust a training program until they confirm a professional has cleared them. That
            gate is decided in code, not by the model, so it cannot be talked out of it.
          </li>
          <li>
            <strong>It will not tell them which movements are safe.</strong> While the gate is
            active it is specifically forbidden from saying that any lift is safe to continue,
            including softer phrasings like “everything else is fine” or “keep going as long as it
            doesn’t hurt”. It is also forbidden from treating pain noticed during one lift as a
            problem confined to that lift.
          </li>
          <li>
            <strong>It will not diagnose, or estimate severity or recovery time.</strong>
          </li>
          <li>
            <strong>It will not suggest stretches, mobility work, “corrective” exercises, rehab
            movements, ice, heat, medication or supplements</strong> for a reported symptom.
          </li>
          <li>
            <strong>It will not give calorie targets, meal plans, or weight-cutting protocols.</strong>{' '}
            It may state published population ranges for protein, carbohydrate and fat and apply
            them to bodyweight as arithmetic — general nutrition information, not medical nutrition
            therapy. Anything touching a nutrition-affected condition is referred to a registered
            dietitian.
          </li>
          <li>
            <strong>It will not discuss performance-enhancing drug protocols</strong>, and it
            refuses restriction plans outright where disordered eating is indicated, pointing to the
            National Alliance for Eating Disorders instead.
          </li>
          <li>
            <strong>It does not withhold coaching to pressure a lifestyle change.</strong> If your
            patient drinks, smokes or sleeps badly and does not intend to change that, it programs
            for the recovery capacity they actually have.
          </li>
        </ul>

        <h2 className="h3">How training loads are decided</h2>
        <p>
          Prescribed weights are <strong>not</strong> generated by the language model. They are
          computed arithmetically from the sessions your patient logs: add a fixed increment after a
          completed session, hold after a missed one, reduce by ten percent after three consecutive
          misses, and stop recommending increases altogether once a defined reset budget is spent.
          The model is handed the resulting number and is instructed not to recalculate it. Warm-up
          ramps are computed the same way.
        </p>
        <p>
          Practically: the program is conservative, it is driven by what your patient actually
          completed rather than by what they hoped to lift, and it does not escalate on request.
        </p>

        <h2 className="h3">If you want something changed or stopped</h2>
        <p>
          There is no clinician login, and no way for us to act on your instruction directly. The
          route is through your patient, and it works:
        </p>
        <ul>
          <li>
            <strong>To stop programming:</strong> ask them to enter the condition in the injuries
            and medical conditions field of their profile and to leave the clearance box unchecked.
            The system will not write them a program while that is the case.
          </li>
          <li>
            <strong>To set restrictions:</strong> tell them what to avoid and ask them to record it
            in the same field along with your clearance. The coach is instructed to build around
            restrictions a professional has set.
          </li>
          <li>
            <strong>To stop entirely:</strong> they can delete their account and all associated data
            from the “Your data” page.
          </li>
        </ul>

        <h2 className="h3">What it holds about your patient</h2>
        <p>
          Training history, current lifts, bodyweight, date of birth, equipment access, and —
          only with separate explicit consent — injuries and medical conditions, typical sleep,
          alcohol and nicotine use, and free-text notes about eating. Health information is stored
          under row-level database security that restricts it to their own account, is excluded from
          application logs and error reports, and is deleted if they withdraw that consent.
        </p>
        <p>
          Their conversations are processed by Anthropic’s Claude models. Full detail is in the{' '}
          <Link to="/policies/health-data">consumer health data policy</Link> and the{' '}
          <Link to="/policies/ai-processing">AI processing policy</Link>.
        </p>

        <h2 className="h3">Limitations worth knowing</h2>
        <ul>
          <li>
            The numbers your patient entered at signup are self-reported and unverified. The system
            flags implausible combinations and asks about them, but it cannot know the truth.
          </li>
          <li>
            It is a language model and can be wrong, including confidently. Its safety behavior is
            tested against an adversarial suite on every change, and that suite is a sample of
            behavior rather than a guarantee of it.
          </li>
          <li>
            Anyone under 18 cannot record injury or lifestyle information at all, because consent
            for that would have to come from a parent or guardian.
          </li>
        </ul>

        <p className="fineprint">
          If something here does not match what your patient has been told by the app, we would
          rather know. This page is checked automatically against the system’s own instructions on
          every release, but automated checks are not the same as being right.
        </p>
      </div>

      <p className="muted small">
        <Link to="/login">Back to Coach Diaz</Link>
      </p>
    </div>
  );
}
