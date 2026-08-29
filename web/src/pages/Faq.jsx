import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { InfoHeader } from '../components/InfoHeader.jsx';
import { CONTACT_EMAIL, contactIsUsable, removalMailto } from '../lib/contact.js';

/**
 * The questions people actually ask, answered the way you would answer them
 * out loud.
 *
 * ── WHO THIS IS WRITTEN FOR ───────────────────────────────────────────────
 *
 * Somebody who is not technical, is mildly suspicious of AI, and is deciding
 * whether to type their injuries into a stranger's website. That person is not
 * served by the policy documents: those are precise, long, and written to be
 * defensible. This is written to be understood.
 *
 * Where the two could disagree, this page defers - every answer that touches
 * data or consent links to the document that governs it, and none of them
 * paraphrases a commitment into something stronger than the document makes.
 * A friendly summary that overpromises is worse than no summary.
 *
 * ── IT IS PUBLIC, DELIBERATELY ────────────────────────────────────────────
 *
 * Routed outside ProtectedRoute and linked from the sign-in screen, because
 * the person with the most questions is the one who has not signed up yet.
 * Making them create an account to find out what happens to their data is
 * exactly backwards.
 *
 * NOT TRANSLATED yet, like the policy pages - and unlike those, this one
 * should be, because it is ordinary prose rather than a legal document. It is
 * on the list.
 */
export function Faq() {
  // Which ending this page gets. A stranger is asked to sign up; somebody who
  // is already signed in is offered the way back into the application, because
  // being invited to "create your account" while holding one is the clearest
  // possible signal that you have been logged out - which is precisely what it
  // was read as.
  const { session } = useAuth();
  return (
    <div className="page">
      {/* Signed in, this is a tab and keeps the application's navigation.
          Signed out, it is a public document with a way back to the front
          door. It used to be only the second, which is why a signed-in reader
          tapping the FAQ tab believed they had been logged out. */}
      <InfoHeader
        title="Questions people ask"
        detail="Short answers, no jargon. If something here is unclear, that is our fault and worth telling us about."
      />

      <div className="card prose faq">
        <h2 className="h3">What is this, exactly?</h2>
        <p>
          A strength coach that writes you a powerlifting program, adjusts it based on what you
          actually lift, and answers questions in between. You tell it about yourself, it gives you
          a plan, you log your sessions, and the next block is built from what you logged rather
          than from what the plan assumed.
        </p>

        <h2 className="h3">Is it a real person?</h2>
        <p>
          No. It is an AI, and it says so everywhere. What it is not is a chatbot with a training
          plan bolted on: the decisions that matter for your safety — whether you need to see a
          doctor before training, and how much weight goes on the bar next — are worked out by
          ordinary code and handed to the AI as answers, precisely so they do not depend on it
          doing arithmetic correctly.
        </p>

        <h2 className="h3">Is it a doctor? Can it tell me if my back is okay?</h2>
        <p>
          No, and it will not pretend otherwise. If you tell it about an injury or pain, it stops
          writing you programs until you confirm a doctor or physical therapist has cleared you to
          train. That is not it being difficult — it genuinely cannot see you, and a program
          written around an injury it cannot examine is a guess with weight on it.
        </p>

        <h2 className="h3">Do I have to tell it about my injuries?</h2>
        <p>
          No. Those questions are optional and you can leave every one of them blank. The coach
          works without them and simply programs more conservatively. If you do share them,{' '}
          <Link className="link" to="/policies/health-data">
            this page
          </Link>{' '}
          explains exactly what happens to that information.
        </p>

        <h2 className="h3">Who can see what I write?</h2>
        <p>
          You, and the AI model that generates the replies. Not other users — the database refuses
          to return one person&rsquo;s rows to anybody else, and that is enforced by the database
          itself rather than by us remembering to check. Your messages are sent to Anthropic to
          produce a reply and are not used for advertising, not sold, and not shared with anybody
          else.
        </p>

        <h2 className="h3">Will you sell my data?</h2>
        <p>
          No, and there is no mechanism to. There are no advertising or analytics scripts anywhere
          on this site — not on the sign-up page, not on the page where you type your injuries, not
          anywhere. That is a deliberate decision and it is written into the{' '}
          <Link className="link" to="/policies/health-data">
            health data policy
          </Link>
          .
        </p>

        <h2 className="h3">Can I delete everything?</h2>
        <p>
          Yes, from the Account page, and it is immediate. It removes the account and everything
          attached to it — your profile, your programs, your logged sessions, your conversations,
          your consent records. Nothing is kept back. It is not recoverable, so export a copy first
          if you want one; there is a button for that on the same page.
        </p>

        <h2 className="h3">Is it free? What happens when it is not?</h2>
        <p>
          It is free while it is being built and tested. When there is a paid plan, logging your
          sessions, your charts and the exercise library will stay free — the paid part will be the
          coaching conversations, because those are what cost us money to run.
        </p>
        <p>
          <strong>If you do subscribe, you will be able to cancel at any time, from inside your
          account, without emailing anybody or explaining yourself.</strong> You will keep access
          until the end of the period you have already paid for, and your data stays yours either
          way — canceling does not delete anything. We are saying this here, before there is
          anything to buy, because a subscription you are worried about escaping is a subscription
          you will not try.
        </p>

        {/*
          ── THE COMPARISON ANSWERS ──────────────────────────────────────────

          "Why would I use this when I already pay for an AI, or my ring
          already has a coach in it?" is the question that decides whether
          somebody signs up, and it was not answered anywhere.

          Three rules for this section, because a comparison page is where
          products start lying:

          1. Every claim about somebody else's product is sourced and dated,
             and describes what it DOES rather than what it fails at. Prices
             move; the one below carries the month it was checked so a stale
             figure reads as stale rather than as a lie.
          2. Each answer names the person who should use the other thing.
             A comparison with no such case is an advertisement.
          3. No affiliate links, no tracking parameters, nothing here earns
             anything - the same rule the equipment answer above states, and
             for the same reason.
        */}
        <h2 className="h3">Why use this when I already pay for ChatGPT or Claude?</h2>
        <p>
          Because a conversation is not a training history. Ask a general AI for a twelve-week
          block and you will get one, and it will look good. Ask again next month and it starts
          from nothing: it does not know that you missed the last two reps of every top set, that
          your bench has not moved since March, or that you trained three days this week instead
          of four. Coach Diaz reads what you logged and builds the next block out of it. That is
          the difference, and it is not a difference in how clever the model is.
        </p>
        <p>
          The cleverness has actually been measured. Seven strength-and-conditioning experts
          scored twelve-week programs written by three versions of ChatGPT: the newest averaged
          4.14 out of 5 and the oldest 2.37, so these models are improving quickly. One error
          turned up in <em>all</em> of them — prescribing fifteen repetitions at 85% of maximum, a
          load almost nobody gets past five. The authors concluded that qualified human oversight
          is still necessary.{' '}
          <a
            className="link"
            href="https://link.springer.com/article/10.1186/s13102-025-01409-7"
            rel="noreferrer"
          >
            (the study, 2025)
          </a>
        </p>
        <p>
          Our answer to that is not a cleverer model. It is to take the numbers out of the
          model&rsquo;s hands entirely. Whether you need medical clearance, how much weight goes on
          the bar next, how the warm-up ramps to it, how long you rest between sets, and whether
          what you logged is physically plausible at all are worked out by ordinary code and handed
          to the AI as answers it is instructed to use as given. A model asked to write coaching
          around a correct number cannot get the number wrong.
        </p>
        <p>
          The honest version: if you already know how to program and you want something to argue
          with, a general AI is a fine sounding board and you are already paying for it. This is
          for the person who does not want to become their own coach.
        </p>

        <h2 className="h3">My watch or ring already has an AI coach. Is this the same thing?</h2>
        <p>
          Different job, and they are not really competitors. A ring or a strap is a recovery
          instrument: it measures sleep, heart-rate variability and strain, and tells you how hard
          to go <em>today</em>. Whoop&rsquo;s strength trainer will build a session from your
          lifting history and volume trends and de-load it, or shorten your rest, when your
          recovery score is poor. That is genuinely useful and it is a decision about this
          afternoon.
        </p>
        <p>
          A powerlifting program is a decision about the next twelve weeks: which lifts, at what
          percentages, rising to what, by when, and what to do about it when a week goes badly.
          &ldquo;You are recovered, go hard&rdquo; does not tell you what to go hard at.
        </p>
        <p>
          The two belong together, and today they are not joined up here: Coach Diaz cannot read
          your wearable. If your ring says you slept five hours, say so in the chat and the session
          will account for it. Reading it automatically is on the list, not in the product — and
          this page will say so when that changes rather than before.
        </p>

        <h2 className="h3">What about the dedicated powerlifting apps?</h2>
        <p>
          If you are an intermediate or advanced lifter who wants a proven block and does not
          particularly want to talk to anybody about it, JuggernautAI is a good product built by
          established powerlifting coaches, and you should probably use it. It was $34.99 a month
          when this answer was written, in August 2026.
        </p>
        <p>
          The difference is what happens when the plan meets your actual week. Those apps hand you
          a program and you execute it. You cannot ask why your bench is stalling, or say
          &ldquo;I have three days instead of four and my shoulder is sore&rdquo;, and have the
          plan change in response and explain itself. This is a conversation with a program
          attached, rather than a program with a chat attached.
        </p>
        <p>
          The other difference is where you train. Most strength apps assume a barbell, a rack and
          plates. This one asks where you actually train and programs somebody with a Smith
          machine and a pair of dumbbells differently from somebody with a competition bar.
        </p>

        <h2 className="h3">Should I use this instead of a real coach?</h2>
        <p>
          No — not if you have a good one and can afford them. A coach who watches you squat sees
          things that no amount of typing will convey, and can put a hand on your ribcage and tell
          you what your brace is doing. Nothing here competes with that.
        </p>
        <p>
          This is for the very large majority of people who are never going to hire a coach. It is
          better than the internet, better than a program copied off a forum by somebody whose
          body is not yours, and it is available at eleven at night when you are trying to work out
          whether to deload.
        </p>

        <h2 className="h3">Do I need a belt, or special shoes, or supplements?</h2>
        <p>
          No. The program works with a barbell and whatever your gym has. The coach will mention
          a belt once, if and when the weight on the bar actually justifies it, and it will tell
          you what a belt does and does not do rather than selling you one. We do not earn anything
          from any equipment recommendation and there are no shopping links anywhere in the app.
        </p>

        <h2 className="h3">I go to Planet Fitness. Is that a problem?</h2>
        <p>
          It is honest about it, which is better than the alternative. Most Planet Fitness locations
          have no barbell and no squat rack, so you cannot train the three competition lifts the way
          this program normally prescribes them. The coach will say that plainly and build the
          best version of what your gym can actually do. If your goal is to get stronger, you can do
          that there. If your goal is to compete, you will eventually need a barbell.
        </p>

        <h2 className="h3">What if I have never lifted before?</h2>
        <p>
          That is who this is built for. It will ask what you can get to, what you have done, and
          how quickly you have been adding weight, and it will start conservatively. Honest answers
          make it work better — there are no wrong ones, and it does not judge them.
        </p>

        <h2 className="h3">Can my teenager use it?</h2>
        <p>
          No. This is for adults, 18 and over, and coaching will not start without a date of birth
          showing that. We have not built a way for a parent or guardian to consent on a younger
          person&rsquo;s behalf, and until we have, we are not going to coach anybody under 18.
        </p>

        <h2 className="h3">The site is broken. Is my data gone?</h2>
        <p>
          Almost certainly not. Your training data lives in a database that is separate from the
          website, so a broken page is a broken page. If nothing is loading, try{' '}
          <a className="link" href="/maintenance.html">
            the status page
          </a>{' '}
          — it tells you whether we are down, and checks by itself for when we are back.
        </p>

        <h2 className="h3">How do I ask something that is not here?</h2>
        <p>
          {contactIsUsable() ? (
            <>
              Write to{' '}
              <a className="link" href={removalMailto('Question', '')}>
                {CONTACT_EMAIL}
              </a>
              . It is a real inbox and a person reads it.
            </>
          ) : (
            <>An address for this is being set up and will appear here once it works.</>
          )}{' '}
          If you are a parent or guardian who needs an account removed, that is the fastest route
          and you do not need to prove anything to us.
        </p>
        <p>
          One request, and it is for your benefit rather than ours:{' '}
          <strong>do not put medical details in an email to us.</strong> Ordinary email is not a
          private channel, and an inbox does not have the protections the app itself does. We do
          not need any of it — an account email address is enough to act on — and anything you do
          send gets deleted once we have dealt with your request rather than filed away.
        </p>
      </div>

      {/* Somebody who has read this far and is convinced had, until now, no
          way to act on it: the page ended in policy links. English rather than
          t(), to match the rest of a page that is not translated yet - a lone
          Spanish button under English prose reads as a mistake.

          It offers the same two doors as the landing page and in the same
          order, because a person arriving here from a search has not seen
          that page and should not have to.

          And it is shown ONLY to somebody who is not signed in. */}
      {session ? (
        <div className="card stack">
          <h2 className="h3">Anything else?</h2>
          <p className="muted">
            If something here is unclear or looks wrong, tell us — that is worth more to us than
            you might think. Otherwise, your coach is where you left it.
          </p>
          <div className="row-actions">
            <Link className="cta" to="/coach">
              Back to your coach
            </Link>
          </div>
        </div>
      ) : (
        <div className="card stack">
          <h2 className="h3">Ready to try it?</h2>
          <p className="muted">
            It is free while it is being built and tested, every health question is optional, and
            you can delete the account and everything in it from inside the app.
          </p>
          <div className="row-actions">
            <Link className="cta" to="/login?mode=signup">
              Create your account
            </Link>
            <Link className="link strong" to="/login">
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      )}

      <div className="card stack">
        <p className="fineprint">
          The full detail is in the{' '}
          <Link className="link" to="/policies/terms">
            Terms
          </Link>
          , the{' '}
          <Link className="link" to="/policies/health-data">
            Consumer Health Data Privacy Policy
          </Link>{' '}
          and the{' '}
          <Link className="link" to="/policies/ai-processing">
            AI Processing disclosure
          </Link>
          . Where this page and those disagree, those are the ones that count.
        </p>
      </div>
    </div>
  );
}
