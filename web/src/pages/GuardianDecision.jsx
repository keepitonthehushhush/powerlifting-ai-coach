import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { GuardianConsent } from './GuardianConsent.jsx';

/**
 * Where a guardian lands from the email, and answers.
 *
 * ── WHY IT WRAPS THE DOCUMENT RATHER THAN SUMMARIZING IT ──────────────────
 *
 * The obvious build is a short page - "Jamie wants to use Coach Diaz. Agree /
 * Decline" - with a link to the full document for anybody who wants it. That is
 * the design that produces a consent nobody read, and this project has already
 * written down what it thinks of those: "a consent record whose subject does
 * not exist proves that someone clicked something."
 *
 * So the buttons sit BELOW the whole document, on the same page. There is no
 * version of this flow where somebody agrees without the text having been in
 * front of them, and scrolling past it is at least a decision.
 *
 * ── NO SESSION, AND NOTHING FETCHED BEFORE THEY DECIDE ────────────────────
 *
 * This route is public, and it deliberately does NOT look the token up on load
 * to show "you are agreeing on behalf of Jamie". That would turn the link into
 * an oracle: anybody holding it, including anybody who came by it wrongly,
 * could learn a child's name and that they use this product, without doing
 * anything a log would call a decision.
 *
 * The email already names the athlete to the person it was addressed to. The
 * page does not repeat it to whoever opens the URL.
 *
 * ── WHY BOTH BUTTONS ARE ALWAYS OFFERED ───────────────────────────────────
 *
 * Including after an answer, and including once the link has expired. The
 * document promises "you can withdraw at any time", and migration 0045 makes
 * that true - saying no always works, is idempotent, and needs no fresh link.
 * A page that hid the button after the first answer would be the interface
 * quietly contradicting the promise.
 */
export function GuardianDecision() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function decide(granted) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/guardian/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, granted }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? 'Something went wrong.');
      setResult(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="page">
        <div className="card">
          <h1>That link is incomplete</h1>
          <p className="muted">
            It looks like only part of the address was opened. Try the link in the email again,
            or copy the whole of it into the address bar — some mail apps break long links across
            two lines.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <GuardianConsent />

      <div className="card stack">
        <h2 className="h3">Your decision</h2>

        {result ? (
          <>
            <p>
              <strong>{result.message}</strong>
            </p>
            {/* Still offered. Withdrawal must never be harder than consent, and
                after an answer is exactly when somebody changes their mind. */}
            {result.outcome !== 'withdrawn' && (
              <button type="button" className="secondary" disabled={busy} onClick={() => decide(false)}>
                {busy ? 'Saving…' : 'Actually, withdraw permission'}
              </button>
            )}
          </>
        ) : (
          <>
            <p className="muted small">
              Agreeing records that you were shown this page and agreed to it, on today&rsquo;s
              date, along with the address this link was sent to. Nothing else about you is
              stored.
            </p>
            <div className="row gap">
              <button type="button" className="primary" disabled={busy} onClick={() => decide(true)}>
                {busy ? 'Saving…' : 'I agree — they may use Coach Diaz'}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => decide(false)}>
                No
              </button>
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
