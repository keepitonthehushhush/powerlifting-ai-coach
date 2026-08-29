import { Link } from 'react-router-dom';
import { PolicyFooter } from '../components/PolicyFooter.jsx';
import { InfoHeader } from '../components/InfoHeader.jsx';
import { CONTACT_EMAIL, contactIsUsable, removalMailto } from '../lib/contact.js';

/**
 * Terms of Service.
 *
 * This document did not exist until now, which was a real defect rather than
 * an omission of polish: `terms_of_service` is a REQUIRED consent, so every
 * user who signed up checked a box agreeing to terms, and the application
 * recorded them as having agreed to version `tos-2026-08-24` — a version
 * string for a document nobody could read, because there was none. A consent
 * record whose subject does not exist proves that someone clicked something.
 *
 * DELIBERATELY NOT TRANSLATED, for the same reason as the health data policy:
 * a machine translation of a legal document is a different legal document.
 *
 * ── tos-2026-08-27: WHAT THE AUDIT FOUND ──────────────────────────────────
 *
 * This document said "Accounts are refused where the date of birth given
 * indicates the person is under 18." No code refuses an account. Sign-up asks
 * for an email and a password; the date of birth is asked for later, on the
 * intake form, and it is optional. What the age gate actually blocks is
 * STORING health or lifestyle information - and it fails closed, so it blocks
 * that for anybody whose date of birth is unknown too.
 *
 * The application's own intake hint has been telling users the true version
 * the whole time ("Coach Diaz cannot store injury or lifestyle information
 * for under-18s"), and the 403 it returns says in as many words: "You can
 * still use the rest of the app." A terms document that contradicts the
 * product's own error message is worse than a vague one, because it reads as
 * authoritative.
 *
 * Corrected below to describe the rule and the enforcement separately, which
 * is what they are. Whether under-18s should be refused outright is a product
 * decision, not a drafting one - see docs/LEGAL_CONSIDERATIONS.md.
 *
 * Content describes what the application actually does, checked against the
 * source. NOT reviewed by an attorney — see docs/LEGAL_CONSIDERATIONS.md.
 */
export function Terms() {
  return (
    <div className="page">
      <InfoHeader title="Terms of Service" version="Version tos-2026-08-27b" />

      <div className="card draft-banner">
        <strong>Draft — pending legal review.</strong>
        <p className="small">
          This describes what the application does today, checked against the source code. It has
          not been reviewed by an attorney and should not be relied on as a final legal document.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">What changed in this version</h2>
        <p className="small">
          <strong>tos-2026-08-27b.</strong> The under-18 rule is now enforced rather than only
          stated. Talking to Coach requires a date of birth showing you are 18 or over, and the
          check runs on our server rather than in your browser, so it is not something a page can
          be persuaded to skip. The section below also says plainly what we rely on, what we
          cannot verify, and what happens when we are told an account belongs to a minor.
        </p>
        <p className="small">
          <strong>tos-2026-08-27.</strong> We checked this document against the code and found a
          claim that was not true: it said accounts are refused when the date of birth given shows
          the person is under 18. Nothing refuses an account. What the application actually blocks
          is the <em>storing of injury and lifestyle information</em> by anyone under 18 — or by
          anyone who has not given a date of birth at all. The age section below now says that
          instead. The rule has not changed and neither has the code; the description has. Because
          the document you previously agreed to described something the product does not do, this
          version supersedes the last one and you will be asked to agree again.
        </p>

        <h2 className="h3">What this service is</h2>
        <p>
          Coach Diaz is an AI strength coach. You tell it about your training, it writes you a
          powerlifting program, you log what you actually lift, and it adjusts the next block based
          on what you reported.
        </p>

        <h2 className="h3">What it is not</h2>
        <p>
          <strong>Coach Diaz is not a doctor, physical therapist, dietitian, or licensed healthcare
          provider of any kind, and nothing it tells you is medical advice.</strong> It cannot
          diagnose an injury, treat one, or tell you whether a pain is serious. If you report an
          injury, pain, or a medical condition, the application will stop writing you programs until
          you confirm that a doctor or physical therapist has cleared you to train. That gate is
          enforced in code, and working around it is working around the only safety mechanism here.
        </p>
        <p>
          It is also not a substitute for a coach who can see you lift. It cannot watch your
          technique, and a program written from numbers alone cannot account for what a bar path
          looks like.
        </p>

        <h2 className="h3">Lifting is inherently risky</h2>
        <p>
          Resistance training carries a real risk of injury, including serious injury. You are
          responsible for your own training decisions: whether to attempt a weight, whether to stop
          a set, and whether you are healthy enough to train at all. If something hurts, stop.
        </p>
        <p>
          You use this service at your own risk. To the fullest extent permitted by law, we are not
          liable for injury, loss, or damage arising from your use of it.
        </p>

        <h2 className="h3">You must be 18 or older</h2>
        <p>
          <strong>This service is for adults. By creating an account and using it, you confirm
          that you are 18 or over.</strong> If you are under 18, do not use it. We have not built a
          way for a parent or guardian to consent on your behalf, and until we have, you are not
          someone this service is for.
        </p>
        <p>
          Here is exactly what we do about it, so that you know what is a rule and what is a
          mechanism. We ask for your date of birth. Coaching will not start without one, and it
          will not start if the date shows you are under 18 — that check runs on our server, not in
          your browser, so it is not something a page can be persuaded to skip. Separately, we
          refuse to store injury or lifestyle information for anyone under 18, and because that
          check fails closed it also refuses when no date of birth has been given at all.
        </p>
        <p>
          <strong>What we cannot do is verify any of it.</strong> A date of birth typed into a form
          is a statement, not proof, and the only way to actually verify age is to collect
          government identity documents — a far larger collection of personal information than
          anything else this service holds, and a worse trade for everyone. So we rely on what you
          tell us. Giving a false date of birth to get access is a breach of these terms, and we
          may close an account we believe was obtained that way.
        </p>
        <p>
          If you are a parent or guardian and you believe an account belongs to someone under 18,
          tell us and we will delete it and the data with it.{' '}
          {contactIsUsable() ? (
            <>
              Write to{' '}
              <a className="link" href={removalMailto()}>
                {CONTACT_EMAIL}
              </a>
              . <strong>All we need is the email address the account was opened with.</strong>{' '}
              You do not need to prove anything to us, and we would rather delete an account in
              error than leave a child&rsquo;s data in place while we deliberate.
            </>
          ) : (
            <>
              A monitored address for this is being set up and will be named here once mail to it
              is confirmed arriving &mdash; we would rather print nothing than print an address
              that bounces.
            </>
          )}{' '}
          Anyone with access to the account can also delete it immediately from the Account page,
          which removes everything and is not recoverable. We act on what we are told: we do not
          knowingly provide this service to minors, and being informed is what makes it knowing.
        </p>
        <p>
          <strong>Please do not send us medical details, diagnoses, or anything about anybody&rsquo;s
          health when you write in.</strong> We do not need any of it to remove an account, and we
          would rather not hold information nobody asked us to keep. If you send it anyway we will
          act on your request and then delete the message; we will not file it, forward it, or keep
          it on the off chance it is useful later.
        </p>

        <h2 className="h3">Your account</h2>
        <p>
          You are responsible for keeping your password to yourself. Tell us if you believe someone
          else has access to your account.
        </p>
        <p>
          You can delete your account at any time from the Account page. Deletion removes the
          account itself, and every row attached to it goes with it: your profile — including
          anything you told us about injuries — your programs, your logged sessions and individual
          sets, your conversations with Coach, your record of consents, and the usage rows counting
          what your replies cost. Nothing is kept back for our own records. It is not recoverable,
          so export first if you want a copy.
        </p>

        <h2 className="h3">What you may not do</h2>
        <ul>
          <li>Use the service if you are under 18, or give a false date of birth to get past the age check.</li>
          <li>Try to obtain another user&rsquo;s data.</li>
          <li>Attempt to get the coach to give medical advice, or to work around the clearance gate.</li>
          <li>Ask for guidance on performance-enhancing drugs. It will refuse.</li>
          <li>Resell or redistribute the coaching output as your own service.</li>
        </ul>

        <h2 className="h3">Your data</h2>
        <p>
          Your training data is yours. What we collect, why, and how it is handled is set out in the{' '}
          <Link className="link" to="/policies/health-data">
            Consumer Health Data Privacy Policy
          </Link>{' '}
          and the{' '}
          <Link className="link" to="/policies/ai-processing">
            AI Processing disclosure
          </Link>
          .
        </p>

        <h2 className="h3">Changes</h2>
        <p>
          If we change these terms materially, the version above changes, your existing consent is
          marked out of date, and you will be asked again. We do not treat agreement to an older
          version as agreement to a newer one.
        </p>

        <h2 className="h3">Ending it</h2>
        <p>
          You can stop using the service and delete your account whenever you like. We may suspend
          an account that is being used to attack the service or other users.
        </p>
      </div>

      <PolicyFooter />
    </div>
  );
}
