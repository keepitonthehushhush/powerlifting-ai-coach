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
        <p className="muted small">Version chd-2026-08-28a</p>
      </header>

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
          <strong>chd-2026-08-28a.</strong> Retention periods are now set rather than
          promised. Injury and medical notes expire after 12 months, conversation messages after
          12 months, and activity and usage records after 24 months. Your logged training is
          explicitly excluded and is never deleted automatically. Because this changes how long we
          hold your health information, we are asking you to agree again.
        </p>
        <p className="small">
          <strong>chd-2026-08-27b.</strong> Gender is now asked for and is listed below as
          consumer health data, which is the cautious reading and the one we are taking. It is
          optional, &ldquo;prefer not to say&rdquo; is a real answer rather than a blank, and the
          coach uses it for two narrow things: competition divisions, which every federation
          separates by sex, and the minimum energy intake guidance, which differs. It never
          changes how heavy your program is or how fast you are expected to progress.
        </p>
        <p className="small">
          Your <strong>pronouns</strong> are asked for separately and are deliberately{' '}
          <strong>not</strong> part of this consent. Being addressed correctly should not be
          something you have to trade privacy for, so that field is available whether or not you
          agree to anything on this page.
        </p>
        <p className="small">
          <strong>chd-2026-08-27.</strong> An audit of this document against the database found
          that four things the app collects were not disclosed here: typical sleep hours, weekly
          alcohol intake, nicotine use, and free-text notes about eating. All four are optional,
          all four are stored under this consent, and all four are consumer health data. They are
          now listed. Because the document you previously agreed to did not describe them, this
          version supersedes the last one and you will be asked to agree again. Nothing about how
          the data is handled changed — only what this page admits to collecting.
        </p>
        <p className="small">
          Also added: the data we hold that is not health data (programs, conversations, session
          logs, and per-message token costs), and a description of the one outbound request in the
          product that is not to Anthropic.
        </p>

        <h2 className="h3">What we collect</h2>
        <p>
          To write you a training program, Coach collects: your training experience and how quickly
          your lifts have been progressing, your current squat, bench and deadlift numbers, your
          bodyweight, preferred units, equipment access, the smallest plate you own, how many days
          a week you train, your goal, and any competition date. It also collects your date of
          birth, which is used to age-appropriate your programming and to enforce the minimum age.
        </p>
        <p>
          <strong>If you choose to provide it</strong>, we also collect:
        </p>
        <ul>
          <li>injuries, pain, and medical conditions that affect your training, and whether a
            professional has cleared you to train;</li>
          <li>the hours you typically sleep;</li>
          <li>how many alcoholic drinks you have in a typical week;</li>
          <li>whether you use nicotine, and how often;</li>
          <li>anything you choose to write about how you eat;</li>
          <li>your gender, if you give it.</li>
        </ul>
        <p>
          Washington law treats all of that as <em>consumer health data</em>. Every item is
          optional and each can be left blank. Coach works without any of it, and will simply be
          more conservative and less able to explain a bad week.
        </p>
        <p>
          We also hold what the coaching produces and what it costs us to produce: your
          conversations with Coach, the training programs written for you, the sessions you log,
          and a per-message record of how many tokens each reply used and what it cost. That last
          one exists so we know what running this service costs. It contains no message content and
          is never used for advertising or profiling.
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
          run on the pages where this information is entered — or on any other page of this site.
        </p>
        <p>
          For completeness, one other outbound request exists anywhere in this product, and it
          carries nothing about you. When you choose a password we check it against Have I Been
          Pwned's list of passwords exposed in known breaches. Your password is hashed in your own
          browser and <strong>only the first five characters of that hash</strong> are sent; the
          service returns around a thousand candidates and the comparison happens on your device.
          It never receives your password, the full hash, your email address, or any cookie. No
          health data is involved.
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
          Your data is kept until you delete your account or withdraw the relevant consent, and in
          addition the following expire on their own:
        </p>
        <ul>
          <li>
            <strong>Injury and medical notes: 12 months</strong> from the last time you changed
            them. They are erased, and your training clearance is reset at the same moment, so the
            coach asks again rather than programming around something two years old. This is as
            much a coaching decision as a privacy one — a healed injury still shaping your
            programme is wrong twice over.
          </li>
          <li>
            <strong>Conversation messages: 12 months.</strong> The coach only ever reads a short
            recent window of a conversation, so older messages are never used by anything. They are
            also where people mention injuries, weight and what is happening at home, so keeping
            them served nobody.
          </li>
          <li>
            <strong>Account activity records: 24 months.</strong> The log of exports, deletions and
            subscription changes shown on your account page.
          </li>
          <li>
            <strong>Usage and cost records: 24 months.</strong> How much each conversation cost to
            run. No conversation content.
          </li>
        </ul>
        <p>
          <strong>Your logged training is never deleted automatically.</strong> Your sessions,
          lifts and programmes are the record you came here to build, and a year away from the gym
          is not a reason to destroy it. Only you can delete those, from your account page.
        </p>
        <p>
          These sweeps run daily. Deletion from a backup is not instant: backups roll off on their
          own schedule, and anything you delete is gone from them within six months at the outside.
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
