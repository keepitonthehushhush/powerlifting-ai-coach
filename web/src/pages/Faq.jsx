import { Link } from 'react-router-dom';
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
  return (
    <div className="page">
      <header className="page-header">
        <h1>Questions people ask</h1>
        <p className="muted header-detail">
          Short answers, no jargon. If something here is unclear, that is our fault and worth
          telling us about.
        </p>
      </header>

      <div className="card prose faq">
        <h2 className="h3">What is this, exactly?</h2>
        <p>
          A strength coach that writes you a powerlifting programme, adjusts it based on what you
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
          writing you programmes until you confirm a doctor or physiotherapist has cleared you to
          train. That is not it being difficult — it genuinely cannot see you, and a programme
          written around an injury it cannot examine is a guess with weight on it.
        </p>

        <h2 className="h3">Do I have to tell it about my injuries?</h2>
        <p>
          No. Those questions are optional and you can leave every one of them blank. The coach
          works without them and simply programmes more conservatively. If you do share them,{' '}
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
          attached to it — your profile, your programmes, your logged sessions, your conversations,
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
          way — cancelling does not delete anything. We are saying this here, before there is
          anything to buy, because a subscription you are worried about escaping is a subscription
          you will not try.
        </p>

        <h2 className="h3">Do I need a belt, or special shoes, or supplements?</h2>
        <p>
          No. The programme works with a barbell and whatever your gym has. The coach will mention
          a belt once, if and when the weight on the bar actually justifies it, and it will tell
          you what a belt does and does not do rather than selling you one. We do not earn anything
          from any equipment recommendation and there are no shopping links anywhere in the app.
        </p>

        <h2 className="h3">I go to Planet Fitness. Is that a problem?</h2>
        <p>
          It is honest about it, which is better than the alternative. Most Planet Fitness locations
          have no barbell and no squat rack, so you cannot train the three competition lifts the way
          this programme normally prescribes them. The coach will say that plainly and build the
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
