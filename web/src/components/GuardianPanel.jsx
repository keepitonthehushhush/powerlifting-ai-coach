import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { errorText } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * The athlete's half of the guardian consent round trip.
 *
 * ── WHY THIS EXISTS AS A SEPARATE COMMIT FROM THE REST OF THE FLOW ────────
 *
 * Because without it the flow was unreachable. Migration 0044 built the token,
 * the endpoints and the guardian's page; nothing in the application called
 * POST /api/guardian/request, so a thirteen-year-old was told to "ask them to
 * give us their email address on your profile page" and there was no field on
 * the profile page. A half-reachable flow is worse than an unbuilt one,
 * because it looks finished from every angle except the one that matters.
 *
 * ── IT RENDERS NOTHING UNLESS IT APPLIES ──────────────────────────────────
 *
 * Not a disabled section, not an explanation of why it is hidden - nothing.
 * An adult has no business seeing a guardian form on their own profile, and a
 * greyed-out one still asks them to work out whether it is about them.
 *
 * `applicable` is decided by the SERVER, deliberately, rather than recomputed
 * here from the date of birth this page already has. Two implementations of an
 * age band is how somebody sees a form that then refuses them - and the copy
 * of the rule that decides is the one in the database, not this one.
 *
 * ── THE FOUR STATES, AND THE ONE THAT USED TO BE INVISIBLE ────────────────
 *
 *   nothing sent    a field and a button
 *   sent, waiting   who it went to and when, and how to send it again
 *   granted         a plain confirmation, and no way to undo it from HERE
 *   withdrawn/no    said plainly, with the way to ask again
 *
 * "Sent, waiting" shows the ADDRESS back. The athlete typed it, and showing it
 * is how they notice they sent it to dad@gmail.con - which otherwise looks
 * exactly like a parent who has not got round to it, forever.
 *
 * Undo is deliberately absent from the granted state. Withdrawal belongs to
 * the guardian, through their own link; a control here would let the person
 * the consent protects remove it, which is the same reasoning that keeps
 * guardian_consent out of SELF_SERVICE_CONSENT_TYPES.
 */
export function GuardianPanel() {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await api.getGuardianStatus());
    } catch {
      // A status read that fails must not break the profile page it sits on.
      // Rendering nothing is the same as not applying, which is the safe way
      // to be wrong here.
      setState({ applicable: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function send(event) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await api.requestGuardianConsent(email.trim());
      setStatus({ kind: 'info', text: t('guardian.sent') });
      setEmail('');
      await load();
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!state?.applicable) return null;

  const request = state.request ?? null;
  const awaiting = request && !request.decided_at;
  const refused = request && request.decided_at && request.decision === false;

  return (
    <section className="card stack guardian-panel">
      <h2 className="h3">{t('guardian.title')}</h2>

      {state.active ? (
        <>
          <p>
            <strong>{t('guardian.granted')}</strong>
          </p>
          {request?.guardian_email && (
            <p className="muted small">{t('guardian.grantedBy')} {request.guardian_email}</p>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            {t('guardian.why')}{' '}
            <Link className="link" to="/policies/guardian-consent">
              {t('guardian.readIt')}
            </Link>
          </p>

          {/* A grant against a superseded version. The coach refuses, and
              without this the athlete would see "already agreed" while being
              turned away - which is the screen contradicting the enforcement. */}
          {state.stale && <p className="error">{t('guardian.stale')}</p>}

          {awaiting && (
            <p>
              {t('guardian.awaiting')} <strong>{request.guardian_email}</strong>.{' '}
              <span className="muted small">{t('guardian.awaitingHint')}</span>
            </p>
          )}

          {refused && <p className="error">{t('guardian.refused')}</p>}

          <form className="stack" onSubmit={send}>
            <label htmlFor="guardian-email">
              {awaiting ? t('guardian.resendLabel') : t('guardian.label')}
            </label>
            <input
              id="guardian-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              placeholder={t('guardian.placeholder')}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="primary" disabled={busy || !email.trim()}>
              {busy ? t('guardian.sending') : awaiting ? t('guardian.resend') : t('guardian.send')}
            </button>
          </form>

          {status && <p className={status.kind === 'error' ? 'error' : 'muted'}>{status.text}</p>}
        </>
      )}
    </section>
  );
}
