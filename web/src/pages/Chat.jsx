import { useEffect, useRef, useState } from 'react';
import { JumpToTop, StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { api, errorText } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { Loading } from '../components/Loading.jsx';
import { CoachMessage } from '../components/CoachMessage.jsx';
import { Link } from 'react-router-dom';
import { readChatSettings, isSendKey } from '../lib/chatSettings.js';

/**
 * ── THE PAUSE BEFORE A MESSAGE IS ACTUALLY SENT, WHEN IT IS TURNED ON ─────
 *
 * There was no way to take a message back. You noticed the typo the instant
 * the button moved, and the only options were to watch a wrong question get
 * answered or to explain the typo in the next message - which is then also in
 * the history, replayed and paid for on every subsequent turn.
 *
 * Aborting mid-flight would not have fixed it. The server saves the reply
 * before it answers, so a canceled request still produces a reply, still
 * costs money, and still shows up on the next page load. A "stop" button whose
 * effect is only to stop LOOKING is a lie told by a control.
 *
 * So the pause goes before dispatch, where canceling is real: within this
 * window nothing has been sent, nothing has been billed, and pressing Undo
 * returns the text to the box for editing. Five seconds is long enough to
 * catch a typo you can already see and short enough to disappear next to a
 * reply that takes thirty.
 *
 * It is OFF by default, and that is a correction. It shipped on, and the first
 * person to use it said the cure was worse than the disease - a delay paid by
 * everybody on every message to serve the occasional typo. Somebody who wants
 * it turns it on in Settings; see lib/chatSettings.js.
 */

/** After this long, the wait stops being ordinary and the copy says so. */
const LONG_WAIT_SECONDS = 25;

export function Chat() {
  const { t } = useI18n();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Null until the server tells us. Not defaulted to a number, because a
  // guessed limit that disagrees with the server is the bug being fixed.
  const [maxLength, setMaxLength] = useState(null);
  // Seconds left before an undoable message is actually dispatched; null when
  // nothing is held. Distinct from `busy`, which means the request has gone.
  const [holding, setHolding] = useState(null);
  // Read once at mount. Changing a setting on the account page and expecting a
  // conversation already on screen to adopt it mid-message is a race nobody
  // asked for; the next visit picks it up.
  const [settings] = useState(readChatSettings);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState(null);
  /*
   * Set only when the server says a row landed. The coach's prose sometimes
   * claims the program was saved, and the coach has no way to know - the write
   * happens after it has finished speaking. This is the app stating a fact it
   * actually holds, and it is cleared on the next send so it can never
   * describe an older turn.
   */
  const [savedProgram, setSavedProgram] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const holdRef = useRef(null);

  useEffect(() => {
    api
      .getConversation()
      .then(({ conversation, limits }) => {
        if (limits?.maxMessageLength) setMaxLength(limits.maxMessageLength);
        if (conversation) {
          setConversationId(conversation.id);
          setMessages(conversation.messages ?? []);
        }
      })
      .catch(() => setError(t('chat.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, holding]);

  /*
   * A counter, not a progress bar and not a countdown.
   *
   * We do not know how long a reply will take - it depends on how much the
   * coach decides to write, and a full training week has run to six thousand
   * tokens. A countdown would have to invent a duration, and a countdown that
   * reaches zero while the athlete is still waiting is worse than no countdown
   * at all: it is a confident answer from something that never looked. Elapsed
   * time is a fact, it visibly moves, and a moving number is what separates
   * "working" from "broken" for the person holding the phone.
   */
  useEffect(() => {
    if (!busy) return undefined;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Anything still held when the page unmounts is abandoned rather than fired
  // into a component that is no longer listening for the answer.
  useEffect(() => () => clearTimeout(holdRef.current), []);

  /** Actually dispatch. Only ever called once the undo window has elapsed. */
  async function dispatch(text, optimistic) {
    setHolding(null);
    setBusy(true);
    setError(null);

    try {
      const result = await api.sendMessage(text, conversationId ?? undefined);
      setConversationId(result.conversationId);
      setMessages(result.messages);
      setSavedProgram(result.savedProgram ?? null);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m !== optimistic));
      setDraft(text);
      // 429 gets a purpose-written message; the server's own text is used
      // otherwise, since it is more specific than anything generic here.
      // errorText appends the quotable code on a 5xx and nothing on a 4xx.
      // The rate-limit message from the server already says when the window
      // resets, which is more use than the generic string.
      setError(err.status === 429 ? err.message || t('chat.rateLimited') : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || holding !== null) return;

    // Optimistic render so the message appears instantly. If the send is
    // undone, or the request fails, the optimistic entry is rolled back and
    // the draft restored, rather than leaving a message on screen that the
    // server never received.
    const optimistic = { role: 'user', content: text, at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setError(null);
    setNotice(null);
    setSavedProgram(null);

    const windowMs = settings.undoWindowSeconds * 1000;
    if (windowMs <= 0) {
      dispatch(text, optimistic);
      return;
    }

    const deadline = Date.now() + windowMs;
    setHolding({ text, optimistic, secondsLeft: settings.undoWindowSeconds });

    const tick = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        dispatch(text, optimistic);
        return;
      }
      setHolding({ text, optimistic, secondsLeft: Math.ceil(remaining / 1000) });
      holdRef.current = setTimeout(tick, 250);
    };
    holdRef.current = setTimeout(tick, 250);
  }

  /**
   * Take it back. Nothing was sent, so there is nothing to apologize for and
   * nothing on the server to reconcile - the message returns to the box with
   * the cursor in it, which is where somebody who spotted a typo wants to be.
   */
  function undoSend() {
    clearTimeout(holdRef.current);
    const held = holding;
    setHolding(null);
    if (!held) return;
    setMessages((prev) => prev.filter((m) => m !== held.optimistic));
    setDraft(held.text);
    setNotice(t('chat.undone'));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="page chat-page">
      <StickyHeader>
      <header className="page-header row">
        <SiteNav>
          <JumpToTop label={t('nav.jumpToTop')} />
        </SiteNav>
      </header>
      </StickyHeader>

      <div className="transcript" role="log" aria-live="polite">
        {loading && <Loading size={72} />}

        {!loading && messages.length === 0 && (
          <div className="empty">
            <p>{t('chat.emptyPrompt')}</p>
            <p className="fineprint">{t('medical.disclaimer')}</p>
          </div>
        )}

        {messages.map((message, index) => (
          <article key={index} className={`bubble ${message.role}`}>
            <div className="who">{message.role === 'user' ? t('chat.you') : t('chat.coach')}</div>
            {/* The coach writes markdown and gets typography. The athlete
                typed what they meant, so their asterisks stay asterisks -
                reformatting somebody's own words back at them is editing. */}
            {message.role === 'user' ? (
              <div className="content">{message.content}</div>
            ) : (
              <CoachMessage text={message.content} />
            )}
          </article>
        ))}

        {savedProgram && (
          <div className="program-saved" role="status">
            <span>
              {t('chat.programSaved', {
                week: savedProgram.week,
                days: savedProgram.days,
              })}
            </span>
            <Link className="link" to="/program">
              {t('chat.programSavedLink')}
            </Link>
          </div>
        )}

        {holding !== null && (
          <div className="holding" role="status">
            <span className="muted">{t('chat.sendingUndo', { seconds: holding.secondsLeft })}</span>
            <button type="button" className="link" onClick={undoSend}>
              {t('chat.undo')}
            </button>
          </div>
        )}

        {busy && (
          <article className="bubble assistant pending">
            <div className="who">{t('chat.coach')}</div>
            <div className="content muted">
              {elapsed === 0 ? t('chat.thinking') : t('chat.thinkingElapsed', { seconds: elapsed })}
            </div>
            {elapsed >= LONG_WAIT_SECONDS && (
              <p className="fineprint muted">{t('chat.thinkingLong')}</p>
            )}
          </article>
        )}

        <div ref={endRef} />
      </div>

      {error && <p className="error">{error}</p>}
      {notice && !error && <p className="notice small muted">{notice}</p>}

      {/* The input and the button are wrapped, and the counter is not in the
          wrapper. Both halves of that matter - see the .composer note in
          styles.css. In short: the counter used to be a flex item BETWEEN the
          box and the button, and the button, as a direct child of this form,
          was matching a `form > button.primary { min-width: 320px }` rule
          written for the submit button at the bottom of a centered form. On a
          phone that left a 24px textarea beside a button wider than the
          screen. */}
      <form className="composer" onSubmit={send}>
        <div className="composer-row">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSendKey(e, settings.sendKey)) send(e);
            }}
            placeholder={t('chat.placeholder')}
            disabled={busy}
            aria-label={t('chat.inputLabel')}
            {...(maxLength ? { maxLength } : {})}
          />
          <button type="submit" className="primary" disabled={busy || holding || !draft.trim()}>
            {t('chat.send')}
          </button>
        </div>
        {/* Only once it is nearly relevant. A counter sitting under an empty
            box is clutter; a counter that appears at 80% is a warning. */}
        {maxLength && draft.length > maxLength * 0.8 && (
          <p className={`counter small ${draft.length >= maxLength ? 'error' : 'muted'}`}>
            {t('chat.characterCount', {
              count: draft.length.toLocaleString(),
              limit: maxLength.toLocaleString(),
            })}
          </p>
        )}
      </form>
    </div>
  );
}
