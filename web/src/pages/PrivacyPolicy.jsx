import { Link } from 'react-router-dom';
import { PolicyFooter } from '../components/PolicyFooter.jsx';
import { InfoHeader } from '../components/InfoHeader.jsx';
import { CONTACT_EMAIL } from '../lib/contact.js';

/**
 * The general privacy policy.
 *
 * ── WHY THIS DID NOT EXIST, AND WHY THAT MATTERED ─────────────────────────
 *
 * Four policy documents existed and every one of them was narrow: consumer
 * health data, AI processing, the leaderboard, and the terms. Nothing covered
 * the personal data that is NOT health data - the email address and password
 * hash held by the auth provider, request metadata at the hosting layer,
 * billing records at Stripe, error records, the display name on a leaderboard
 * entry. The internal review called it "the largest single gap".
 *
 * It also had a structural consequence. Washington's My Health My Data Act
 * requires the consumer health data policy to be a SEPARATE document with its
 * own link - a requirement that presumes a general policy exists for it to be
 * separate from. Having only the narrow one is not a partial answer to that;
 * it is a different shape of answer.
 *
 * ── HOW THIS DOCUMENT WAS WRITTEN ─────────────────────────────────────────
 *
 * Every factual claim below was taken from the code and the database rather
 * than from a template: the collected fields are the actual columns, the
 * retention periods are the rows of `retention_periods`, and the list of
 * third parties is the list of hosts this application actually contacts. Where
 * a claim could not be checked against something, it is not made.
 *
 * DELIBERATELY NOT TRANSLATED, for the same reason as the other policy
 * documents: a machine translation of a legal document is a different legal
 * document.
 *
 * NOT REVIEWED BY AN ATTORNEY. See docs/COUNSEL_BRIEF.md, which lists every
 * choice made here that a lawyer should confirm or overrule.
 */
export function PrivacyPolicy() {
  return (
    <div className="page">
      <InfoHeader title="Privacy Policy" version="Version pp-2026-08-31b" />

      <div className="card draft-banner">
        <strong>Draft — pending legal review.</strong>
        <p className="small">
          This describes what the application actually does, checked against the source code and
          the database. It has not been reviewed by an attorney and should not be relied on as a
          final legal document.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">The short version</h2>
        <p>
          Coach Diaz stores what you tell it about your training so it can coach you. It does not
          sell your information, share it with advertisers, or run analytics or advertising
          scripts anywhere on this site. You can download everything it holds about you, or delete
          all of it, from your account page, without asking anybody and without waiting.
        </p>
        <p>
          Health information — injuries, medical conditions, and the lifestyle answers you choose
          to give — is covered by a separate document with stricter rules:{' '}
          <Link className="link" to="/policies/health-data">
            the Consumer Health Data Privacy Policy
          </Link>
          . This page covers everything else.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Who is responsible for your data</h2>
        <p>
          Coach Diaz is operated by an individual, Eduardo Diaz, based in Michigan, United States.
          There is no company behind it. When this page says &ldquo;we&rdquo;, that is who it
          means. You can reach a person at{' '}
          <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">What is collected, and why</h2>

        <h3 className="h4">Because you typed it</h3>
        <ul>
          <li>
            <strong>Your email address and password.</strong> Needed to have an account at all. The
            password is never stored — what is stored is a one-way hash of it, held by our
            authentication provider, and it cannot be turned back into your password.
          </li>
          <li>
            <strong>Your training details.</strong> Experience level, current lifts, bodyweight,
            units, goal, competition date, equipment, days per week, plate sizes, gym, and how
            often you want progress reviewed. This is what a program is built from.
          </li>
          <li>
            <strong>Your date of birth.</strong> Used to enforce the minimum age and to keep
            programming age-appropriate. Your actual date of birth is never sent to the AI model —
            only your age in whole years.
          </li>
          <li>
            <strong>Gender and pronouns, if you give them.</strong> Optional. Used so the coach
            addresses you correctly and so bodyweight guidance is not written for the wrong person.
          </li>
          <li>
            <strong>Your display name,</strong> if you join the leaderboard. It is the only thing
            about you other lifters can see, and you choose it.
          </li>
          <li>
            <strong>What you write to the coach,</strong> and the sessions and sets you log,
            including your own notes on them.
          </li>
          <li>
            <strong>Your interface preferences,</strong> such as which theme you picked. Kept
            deliberately apart from everything else, in its own table, so that reading it does not
            require touching anything sensitive.
          </li>
        </ul>

        <h3 className="h4">Because the service produced it</h3>
        <ul>
          <li>
            <strong>Your programs, and the record of your consents</strong> — which document
            version you agreed to, and when.
          </li>
          <li>
            <strong>Usage and cost records</strong> for each reply: how many tokens it used and
            what it cost. No message content.
          </li>
          <li>
            <strong>Account activity</strong> — an audit trail of security-relevant actions, such
            as signing in, exporting your data, or asserting that a professional cleared you to
            train.
          </li>
          <li>
            <strong>Error records</strong> when something fails: an error code, the route, and an
            HTTP status. Never the content of your message.
          </li>
          <li>
            <strong>Billing records,</strong> if you subscribe — see below.
          </li>
        </ul>

        <h3 className="h4">Because you visited</h3>
        <p>
          Our hosting provider processes the ordinary metadata every web request carries, including
          your IP address, in order to serve the page and to resist abuse. We do not build profiles
          from it and we do not use it for advertising. There are no advertising or analytics
          scripts on any page of this site.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Who else receives it</h2>
        <p>
          These are the only third parties involved, and each one is named because this application
          genuinely contacts it — not because a template listed it.
        </p>
        <ul>
          <li>
            <strong>Anthropic</strong> — receives the conversation and the profile information the
            coach needs, in order to generate a reply. Exactly what is sent is itemised in{' '}
            <Link className="link" to="/policies/ai-processing">
              How Coach Diaz uses AI
            </Link>
            . Your browser never contacts Anthropic directly.
          </li>
          <li>
            <strong>Supabase</strong> — the database and the authentication system. Your account
            and everything stored about you lives here.
          </li>
          <li>
            <strong>Vercel</strong> — hosts the site and runs the server code.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing, if you subscribe. Card details are
            entered on Stripe&rsquo;s own pages and never touch this site.
          </li>
          <li>
            <strong>Cloudflare</strong> — runs the bot check on the sign-in page. It receives your
            IP address, a fingerprint of your browser&rsquo;s connection, your user-agent string,
            and our site identifier. Not used for advertising and not to track you across other
            sites.
          </li>
          <li>
            <strong>Have I Been Pwned</strong> — receives only the first five characters of a hash
            of a password you are choosing, so we can warn you if it appears in a known breach. It
            never receives your password, the full hash, your email address, or any cookie.
          </li>
        </ul>
        <p>
          <strong>
            We do not sell your personal information, and we do not share it for cross-context
            behavioral advertising.
          </strong>{' '}
          We have never done either. There is no advertising business here to do it for.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">How long it is kept</h2>
        <p>
          Most of it is kept until you delete your account or withdraw the relevant consent. Some
          categories expire on their own, whether or not you do anything. These are the actual
          periods the database enforces, swept daily:
        </p>
        <ul>
          <li>
            <strong>Injury and medical notes: 12 months</strong> from the last time you changed
            them. Your training clearance resets at the same moment, so the coach asks again rather
            than working from something a year old.
          </li>
          <li>
            <strong>GLP-1 medication status: 12 months</strong> from the last time it changed.
          </li>
          <li>
            <strong>Conversation messages: 12 months.</strong>
          </li>
          <li>
            <strong>Account activity records: 24 months.</strong>
          </li>
          <li>
            <strong>Usage and cost records: 24 months.</strong>
          </li>
          <li>
            <strong>Error records: 6 months.</strong>
          </li>
          <li>
            <strong>Payment webhook identifiers: 3 months</strong> — kept only long enough to
            reject a duplicate.
          </li>
        </ul>
        <p>
          <strong>Your logged training is never deleted automatically.</strong> Only you can delete
          that, from your account page.
        </p>
        <p>
          Deletion from backups is not instant. Backups roll off on their own schedule, and
          anything you delete is gone from them within six months at the outside.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Your rights, and how to use them</h2>
        <p>
          All of these work from your account page. None of them requires you to email anybody,
          prove who you are a second time, or wait for us to get round to it.
        </p>
        <ul>
          <li>
            <strong>Know and access.</strong> Download everything held about you as a
            machine-readable file.
          </li>
          <li>
            <strong>Delete.</strong> Delete your account and its data. Immediate and irreversible.
          </li>
          <li>
            <strong>Withdraw consent.</strong> One click, from the same screen where you gave it.
            Withdrawing health data consent also erases the health information already stored.
          </li>
          <li>
            <strong>Correct.</strong> Every field you entered is editable from the app.
          </li>
          <li>
            <strong>Opt out of sale or sharing.</strong> There is nothing to opt out of: we do
            neither, so there is no toggle and no &ldquo;Do Not Sell&rdquo; link. If that ever
            changes, this document changes first and you will be asked again.
          </li>
          <li>
            <strong>Non-discrimination.</strong> Using any of these rights does not get you a worse
            service, a higher price, or a degraded version of the coach.
          </li>
        </ul>
        <p>
          <strong>What deletion leaves behind.</strong> Two things, and it is more honest to name
          them than to say &ldquo;everything&rdquo;. Records in the security audit trail survive
          with the account identifier removed, so they no longer point at anybody. Stripe keeps its
          own transaction records for as long as its own obligations require — that is Stripe&rsquo;s
          copy, requestable from Stripe, and we cannot delete it on your behalf.
        </p>
        <p>
          An authorized agent may exercise these rights for you. Because deletion and export are
          self-service, the practical route is for you to use them yourself; if an agent needs to
          act for you, write to{' '}
          <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          and we will ask for written permission signed by you.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Security, and what happens if it fails</h2>
        <p>
          Access is enforced by the database rather than only by application code: your records are
          readable only by your account, and the rule is written where it cannot be skipped by a
          forgotten check. Health information is stripped automatically before anything is written
          to logs or error reports. Health data cannot be stored at all unless your consent is
          currently active, and that too is enforced by the database.
        </p>
        <p>
          No system is perfectly secure, and this one is operated by one person. If personal
          information is exposed in a way that creates a real risk to you,{' '}
          <strong>
            we will tell you by email at the address on your account, without undue delay and in
            any event within 72 hours of confirming it
          </strong>
          , describing what happened, what was affected, and what to do about it. If health
          information is involved, notification also follows the FTC Health Breach Notification
          Rule.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Children</h2>
        <p>
          This service is for adults. You must be 18 or over to use it. We do not knowingly collect
          information from anybody under 18, and coaching will not start without a date of birth
          showing you are old enough. If you are a parent or guardian and believe a child has
          created an account, write to{' '}
          <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          with the email address the account was opened with. We will delete it and the data with
          it. You do not need to prove anything to us.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Where your data is</h2>
        <p>
          Data is stored and processed in the United States. This service is offered to people in
          the United States. If you use it from elsewhere, you are sending your information to the
          United States, where privacy law differs from your own.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">Changes to this policy</h2>
        <p>
          The version identifier at the top of this page changes whenever the document does, and
          what changed is recorded here. Where a change affects something you agreed to, you will
          be asked to agree again rather than being deemed to have accepted it by continuing.
        </p>
      </div>

      <PolicyFooter fallback="/" />
    </div>
  );
}
