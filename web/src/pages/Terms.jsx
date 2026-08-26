import { Link } from 'react-router-dom';

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
 * Content describes what the application actually does, checked against the
 * source. NOT reviewed by an attorney — see docs/LEGAL_CONSIDERATIONS.md.
 */
export function Terms() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Terms of Service</h1>
        <p className="muted small">Version tos-2026-08-24</p>
      </header>

      <div className="card draft-banner">
        <strong>Draft — pending legal review.</strong>
        <p className="small">
          This describes what the application does today, checked against the source code. It has
          not been reviewed by an attorney and should not be relied on as a final legal document.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">What this service is</h2>
        <p>
          Coach Diaz is an AI strength coach. You tell it about your training, it writes you a
          powerlifting program, you log what you actually lift, and it adjusts the next block based
          on what you reported.
        </p>

        <h2 className="h3">What it is not</h2>
        <p>
          <strong>Coach Diaz is not a doctor, physiotherapist, dietitian, or licensed healthcare
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
          This service is for adults. Accounts are refused where the date of birth given indicates
          the person is under 18. If you are under 18, do not use this service.
        </p>

        <h2 className="h3">Your account</h2>
        <p>
          You are responsible for keeping your password to yourself. Tell us if you believe someone
          else has access to your account.
        </p>
        <p>
          You can delete your account at any time from the Account page. Deletion removes your
          profile, your programs, your logged sessions and your conversations. It is not
          recoverable.
        </p>

        <h2 className="h3">What you may not do</h2>
        <ul>
          <li>Use the service if you are under 18.</li>
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

      <div className="row gap">
        <Link className="link" to="/consent">
          Back
        </Link>
      </div>
    </div>
  );
}
