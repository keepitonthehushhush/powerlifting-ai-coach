import { Link } from 'react-router-dom';
import { PolicyFooter } from '../components/PolicyFooter.jsx';
import { InfoHeader } from '../components/InfoHeader.jsx';

/**
 * What joining the leaderboard actually publishes.
 *
 * A separate document because it is a separate PURPOSE. Everything else this
 * product holds is used to coach the person it belongs to; this is the only
 * thing shown to anybody else, and burying that in a general privacy policy
 * would be hiding the one disclosure most worth reading.
 *
 * DELIBERATELY NOT TRANSLATED, for the same reason as the other policies: a
 * machine translation of a legal document is a different legal document. The
 * consent UI around it is localised.
 *
 * Short on purpose. The list of what is published is the whole document, and a
 * page somebody actually reads is worth more than a thorough one they skip.
 */
export function LeaderboardPolicy() {
  return (
    <div className="page">
      <InfoHeader title="Leaderboard" version="Version lbp-2026-08-28a" />

      <div className="card draft-banner">
        <strong>Draft — pending legal review.</strong>
        <p className="small">
          This describes what the application does today, checked against the source code. It has
          not been reviewed by an attorney.
        </p>
      </div>

      <div className="card prose">
        <h2 className="h3">What is published</h2>
        <p>Exactly four things, to other signed-in users of Coach Diaz:</p>
        <ul>
          <li>The display name you choose.</li>
          <li>Your best completed squat, bench press and deadlift.</li>
          <li>Whether those are in pounds or kilograms.</li>
          <li>Your position in the ranking, which follows from the above.</li>
        </ul>

        <h2 className="h3">What is not</h2>
        <p>
          Your email address, your real name, your bodyweight, your age, your date of birth, your
          gender, your injuries or any other health information, your location, your gym, your
          program, your conversations with the coach, your achievements, and the sessions behind
          the numbers. None of these are published, and the table the leaderboard reads has no
          column any of them could be put in without a database migration.
        </p>
        <p>
          Achievements are private. Somebody who agreed to have their squat ranked did not agree to
          strangers knowing they missed a rep in March.
        </p>

        <h2 className="h3">Where the numbers come from</h2>
        <p>
          Sessions you logged and marked completed. They cannot be typed in — not through the app
          and not by anyone talking to the database directly, because permission to write those
          numbers is not granted to any user account. A missed rep does not count toward a ranking.
        </p>
        <p>
          There is no bodyweight-relative ranking — no Wilks, no DOTS, no weight classes. Those
          make a lower bodyweight rank higher, and that is not a thing this product is willing to
          put in front of people.
        </p>

        <h2 className="h3">Who can see it</h2>
        <p>
          People signed in to Coach Diaz. It is not public, not indexed by search engines, and not
          visible to anybody without an account. It is not shared with, sold to, or licensed to
          anyone.
        </p>

        <h2 className="h3">Leaving</h2>
        <p>
          Turn this off, or use “Leave the leaderboard” on the{' '}
          <Link className="link" to="/leaderboard">
            leaderboard page
          </Link>
          . Either one <strong>deletes</strong> your entry rather than hiding it, immediately.
          Withdrawing this permission also takes you off the board on its own — you do not have to
          do both.
        </p>
        <p>
          Your own records are untouched by leaving: your logged sessions, program, charts and
          conversations are yours either way. Nothing about the leaderboard affects them.
        </p>
        <p>
          The record that you agreed is kept, because we have to be able to show that consent was
          obtained. It is a line in your consent history saying you agreed on a date to a version
          of this page, and it is visible to you on your account.
        </p>

        <h2 className="h3">Agreeing is optional</h2>
        <p>
          Nothing else changes if you never turn this on. Coaching, logging, your program, your
          charts and the exercise library work identically. A permission that costs you something
          to refuse is not freely given, so refusing this costs nothing.
        </p>

        <PolicyFooter />
      </div>
    </div>
  );
}
