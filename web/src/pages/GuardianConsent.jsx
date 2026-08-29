import { Link } from 'react-router-dom';
import { PolicyFooter } from '../components/PolicyFooter.jsx';
import { InfoHeader } from '../components/InfoHeader.jsx';
import { CONTACT_EMAIL, contactIsUsable, removalMailto } from '../lib/contact.js';

/**
 * What a parent or guardian agrees to when somebody aged 13 to 17 uses this.
 *
 * ── WHY THIS PAGE HAD TO EXIST BEFORE THE FEATURE COULD SHIP ──────────────
 *
 * `guardian_consent` had a version string - `gc-2026-08-29a`, seeded by
 * migration 0036 - and no document behind it. That is the exact defect the
 * Terms of Service was written to fix: a consent record whose subject does not
 * exist proves that somebody clicked something. policyDocuments.test.js said it
 * in as many words - "users would be agreeing to nothing".
 *
 * ── WHO IS READING IT ─────────────────────────────────────────────────────
 *
 * Not the athlete. A guardian who received a link at their own address, is
 * probably not signed in, and has never seen this product. So it is written to
 * them in the second person, it explains what Coach Diaz is before it asks for
 * anything, and it does not assume any of the context the other four documents
 * can assume. InfoHeader already renders a signed-out reader a way back to the
 * front door rather than a navigation bar full of destinations that would
 * bounce them to a password field.
 *
 * PolicyFooter is passed offerConsentSettings={false} deliberately. Every other
 * policy page offers a signed-in reader a link to their consent screen, which
 * is right for a consent the athlete manages. A guardian consent is explicitly
 * NOT self-service - SELF_SERVICE_CONSENT_TYPES exists to keep a fifteen-year-
 * old from ticking a box that says their parent agreed - so pointing at that
 * screen from this page would offer a route that does not lead anywhere.
 *
 * ── THE ORDER OF THE SECTIONS IS THE ARGUMENT ─────────────────────────────
 *
 * docs/UNDER_18.md is explicit that the uncomfortable fact must be faced rather
 * than buried: "This product is unsupervised by definition. It writes a program
 * and the person goes and does it alone. For an adult that is their call; for a
 * 15-year-old it is the parent's, and the consent has to say so in those words
 * rather than in a paragraph nobody reads."
 *
 * So it is the first thing after the greeting, under its own heading, before
 * any description of features. A document that sells for four sections and
 * discloses in the fifth is a document designed to be agreed to rather than
 * read.
 *
 * The growth-plate answer is deliberately early and deliberately unhedged, for
 * the opposite reason: it is the question a worried parent actually arrives
 * with, and the honest answer is reassuring. Hedging it to seem careful would
 * help nobody and would make the rest of the page read as evasive.
 *
 * DELIBERATELY NOT TRANSLATED, like the other four: a machine translation of a
 * legal document is a different legal document.
 *
 * NOT REVIEWED BY AN ATTORNEY. See docs/POLICY_REVIEW_2026-08-29.md.
 */
export function GuardianConsent() {
  return (
    <div className="page">
      <InfoHeader title="For a parent or guardian" version="Version gc-2026-08-29a" />

      <div className="card draft-banner">
        <strong>Draft — pending legal review.</strong>
        <p className="small">
          This describes what the application does today, checked against the source code. It has
          not been reviewed by an attorney and should not be relied on as a final legal document.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Why you are reading this</h2>
        <p>
          Somebody between 13 and 17 wants to use Coach Diaz and gave us your email address as
          their parent or guardian. We will not coach them until you have read this and agreed.
          If you do nothing, nothing happens: they can sign in, but the coach will not talk to
          them.
        </p>

        <h2 className="h3">The part to read before any of the rest</h2>
        <p>
          <strong>Coach Diaz is not supervision. It writes a training program and your child
          goes and does it, on their own, wherever they train.</strong> Nobody from this service
          is in the room. Nobody watches a single repetition. Nobody can tell whether the bar is
          moving badly or whether the weight on it is the weight we prescribed.
        </p>
        <p>
          We are telling you this first because it is the single most important thing about the
          decision you are being asked to make, and because the research this product follows is
          unambiguous that qualified adult supervision is a condition of youth resistance
          training being safe — not an optional extra. We cannot provide that condition. You
          can, or you can arrange for it. <strong>Agreeing here means you are taking that
          on.</strong>
        </p>
        <p>
          That is the whole of the uncomfortable part, and we would rather put it in a heading
          than in a sentence somewhere in the middle.
        </p>

        <h2 className="h3">Is lifting weights safe at their age?</h2>
        <p>
          Yes, when it is properly designed and supervised — and the specific fear most people
          arrive with is not supported by the evidence. A properly designed and supervised
          resistance training program is relatively safe for young people, and{' '}
          <strong>injury to growth cartilage has not been reported in any prospective study of
          youth resistance training.</strong> Lifting does not stunt growth.
        </p>
        <p>
          We are not going to hedge that into a non-answer, because it is true and because it is
          one of the most useful things we can tell you. The conditions attached to it are the
          real subject: proper program design, which is what we do, and supervision, which is
          what we do not.
        </p>

        <h2 className="h3">What the coach will do differently for them</h2>
        <p>
          Not a softer version of the adult product — a different one. This is enforced in our
          code before the coach ever sees their message, not left to its judgment:
        </p>
        <ul>
          <li>
            <strong>Submaximal work with a technical focus.</strong> Strength work in the range
            of one to three sets of six to fifteen repetitions, and load increased gradually —
            on the order of five to ten percent — only when the current weight is genuinely
            comfortable.
          </li>
          <li>
            <strong>No maximal singles. No one-rep-max testing.</strong> Not written, not
            suggested, not set as a target. If your child asks why — or if you do, having read
            that supervised maximal testing in youth is considered safe, which is correct — the
            coach is instructed to give the real reason rather than invent a physiological one:
            the safety of maximal lifting in young people rests on close supervision by a
            qualified professional and a habituation period, and this product is unsupervised.
            The condition is missing, so the lift is off the table here.
          </li>
          <li>
            <strong>Nothing about body composition.</strong> The coach will never raise body
            weight, leanness, cutting, or competition weight classes with a minor — not as an
            aside and not as a training variable. If your child raises it, the coach keeps to
            eating enough to recover and to grow, and will not help them lose weight or make a
            weight class. Our rules about disordered eating are stricter for minors than for
            adults, not the same.
          </li>
          <li>
            <strong>It will say once that an adult should know they are training</strong>, and
            then get on with coaching. Repeating it every session gets tuned out.
          </li>
        </ul>
        <p>
          What it will not do is refuse to coach or talk down to them. A teenager turned away
          from a careful program does not stop training; they follow whatever they find instead.
        </p>

        <h2 className="h3">What we collect about your child</h2>
        <p>
          Their training numbers, bodyweight, equipment, training days, goal, and date of birth.
          If they choose to provide it — none of it is required — injuries and medical
          conditions, sleep, alcohol, nicotine, notes about eating, and gender. All of that is
          treated as health information and is set out in full in the{' '}
          <Link className="link" to="/policies/health-data">
            Consumer Health Data Privacy Policy
          </Link>
          , which is worth your time: it says what is stored, for how long, and how it is
          erased.
        </p>
        <p>
          Their coaching is generated by an AI model run by Anthropic, which means their message,
          the recent conversation, and a summary of their training profile — including any injury
          information they gave us — are sent to Anthropic to produce each reply. That is set out
          in the{' '}
          <Link className="link" to="/policies/ai-processing">
            AI Processing disclosure
          </Link>
          . We do not sell any of it, and no advertising or analytics company receives any of it.
        </p>
        <p>
          <strong>Your child cannot join the leaderboard.</strong> Publishing a minor&rsquo;s
          chosen name and lifts to other users is a different question from publishing an
          adult&rsquo;s, and the answer here is no. The database refuses it, not just the
          interface.
        </p>

        <h2 className="h3">What we are asking you to agree to</h2>
        <p>
          That you are their parent or guardian; that you have read the part about supervision
          and are taking responsibility for it; and that they may use Coach Diaz and give it the
          information described above.
        </p>
        <p>
          <strong>What this is not is proof of anything.</strong> We are not verifying your
          identity, and an email link cannot. We are not confirming you are this
          child&rsquo;s parent. What this creates is an honest record that a real adult at a real
          address was told what this product is and agreed to it — which is what we can actually
          do, and we would rather say so than dress it up. We take the same position about the
          date of birth on the account: it is what somebody typed, not something we have checked.
        </p>

        <h2 className="h3">Your email address</h2>
        <p>
          We store the address this consent was sent to, and nothing else about you. It is there
          so there is somewhere to write if this needs withdrawing and so the record means
          something. It is never written to our logs, it is covered by the same access controls
          as everything else, it appears in your child&rsquo;s data export because it is part of
          their consent record, and <strong>it is erased automatically after 24 months</strong>.
          The consent record itself stays, because it is the audit trail; the way to reach you
          does not need to outlive its purpose.
        </p>

        <h2 className="h3">Changing your mind</h2>
        <p>
          You can withdraw at any time, and you do not have to give a reason. When you do, the
          coach stops talking to your child immediately — the same refusal as if you had never
          agreed. Their logged training, their programs and their account are not deleted by a
          withdrawal; you are withdrawing permission to coach, not asking us to destroy their
          records.
        </p>
        <p>
          If you want the account and everything in it gone instead, say so and we will delete
          it.{' '}
          {contactIsUsable() ? (
            <>
              Write to{' '}
              <a className="link" href={removalMailto()}>
                {CONTACT_EMAIL}
              </a>{' '}
              from this address. <strong>All we need is the email address the account was
              opened with.</strong> You do not need to prove anything to us.
            </>
          ) : (
            <>
              A monitored address for this is being set up and will be named here once mail to it
              is confirmed arriving — we would rather print nothing than print an address that
              bounces.
            </>
          )}{' '}
          Anyone with access to the account can also delete it immediately from the Account page,
          which removes everything and is not recoverable.
        </p>
        <p>
          <strong>Please do not send us medical details or anything about your child&rsquo;s
          health when you write in.</strong> We do not need any of it, and we would rather not
          hold information nobody asked us to keep.
        </p>

        <h2 className="h3">If we change this document</h2>
        <p>
          The version above changes, your agreement is marked out of date, and we ask you again.
          We do not treat agreement to an older version as agreement to a newer one. That is the
          same rule every other consent here follows.
        </p>

        <h2 className="h3">The rest of the terms</h2>
        <p>
          Everything in the{' '}
          <Link className="link" to="/policies/terms">
            Terms of Service
          </Link>{' '}
          applies, including the part that matters most: Coach Diaz is not a doctor, physical
          therapist, or dietitian, nothing it says is medical advice, and lifting carries a real
          risk of injury. If your child reports an injury or pain, the application stops writing
          programs until somebody confirms a doctor or physical therapist has cleared them to
          train.
        </p>
      </div>

      <PolicyFooter offerConsentSettings={false} />
    </div>
  );
}
