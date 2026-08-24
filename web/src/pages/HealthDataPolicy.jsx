import { Link } from 'react-router-dom';

/**
 * Consumer Health Data Privacy Policy.
 *
 * Washington's My Health My Data Act requires this as a SEPARATE document from
 * the general privacy policy, with its own link. Hence its own route rather
 * than a section of a combined page.
 *
 * DELIBERATELY NOT TRANSLATED. Legal text should be reviewed by counsel in
 * each language it is published in; a machine translation of a policy is a
 * different policy, and shipping one would create the exact ambiguity the
 * document exists to remove. The consent UI around it is localised; this is
 * not, and that is a decision rather than an omission.
 *
 * The content below describes what the application actually does, verified
 * against the code. It has NOT been reviewed by a lawyer — see the banner and
 * docs/LEGAL_CONSIDERATIONS.md.
 */
export function HealthDataPolicy() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Consumer Health Data Privacy Policy</h1>
        <p className="muted small">Version chd-2026-08-24</p>
      </header>

      <div className="card draft-banner">
        <strong>Draft — pending legal review.</strong>
        <p className="small">
          This describes what the application does today, checked against the source code. It has
          not been reviewed by an attorney and should not be relied on as a final legal document.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">What we collect</h2>
        <p>
          To write you a training program, Coach collects: your training experience, current squat,
          bench and deadlift numbers, bodyweight, preferred units, equipment access, how many days a
          week you train, and your goal.
        </p>
        <p>
          <strong>If you choose to provide it</strong>, we also collect injuries, pain, and medical
          conditions that affect your training, and whether a professional has cleared you to train.
          Washington law treats this as <em>consumer health data</em>. It is optional. Coach works
          without it, and will simply be more conservative.
        </p>

        <h2 className="h3">Why we collect it</h2>
        <p>
          Solely to generate and adjust your training, and to enforce the rule that we will not
          write a program around an injury a professional has not assessed.
        </p>

        <h2 className="h3">Who we share it with</h2>
        <p>
          Your health data is sent to <strong>Anthropic</strong>, which operates the AI model that
          produces your coaching, for the sole purpose of generating your response. That is the only
          third party that receives it.
        </p>
        <p>
          <strong>We do not sell your health data. We do not share it with advertisers, data
          brokers, or analytics providers.</strong> No third-party analytics or advertising scripts
          run on the pages where this information is entered.
        </p>

        <h2 className="h3">How it is protected</h2>
        <ul>
          <li>Access control is enforced by the database, not only by application code. Your records
            are readable only by your account.</li>
          <li>Health information is never written to application logs or error-reporting systems.
            Redaction happens automatically before anything is logged.</li>
          <li>Health data cannot be stored at all unless your consent is currently active — this is
            enforced by the database itself, not by a check the code might skip.</li>
        </ul>

        <h2 className="h3">Your rights</h2>
        <ul>
          <li><strong>Access.</strong> Download everything we hold about you, as a machine-readable
            file, from your account page.</li>
          <li><strong>Deletion.</strong> Delete your account and every associated record from your
            account page. This is immediate and irreversible.</li>
          <li><strong>Withdraw consent.</strong> At any time, from the same screen where you gave
            it. Withdrawing consent for health data collection also erases the health information
            already stored.</li>
        </ul>

        <h2 className="h3">Retention</h2>
        <p>
          Your data is kept until you delete your account or withdraw the relevant consent. A
          defined maximum retention period has not yet been set; this section will be updated when
          it is.
        </p>

        <h2 className="h3">Contact</h2>
        <p>
          To exercise any right described here, use your account page. For anything else, contact
          the address published on the site.
        </p>
      </div>

      <p>
        <Link className="link" to="/consent">Back to your consent settings</Link>
      </p>
    </div>
  );
}
