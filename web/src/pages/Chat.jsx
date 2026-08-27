import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { JumpToTop, StickyHeader } from '../components/StickyHeader.jsx';
import { SiteNav } from '../components/SiteNav.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

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
  const endRef = useRef(null);

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
  }, [messages, busy]);

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    // Optimistic render so the message appears instantly. If the request fails
    // the optimistic entry is rolled back and the draft restored, rather than
    // leaving a message on screen that the server never received.
    const optimistic = { role: 'user', content: text, at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setBusy(true);
    setError(null);

    try {
      const result = await api.sendMessage(text, conversationId ?? undefined);
      setConversationId(result.conversationId);
      setMessages(result.messages);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m !== optimistic));
      setDraft(text);
      // 429 gets a purpose-written message; the server's own text is used
      // otherwise, since it is more specific than anything generic here.
      setError(err.status === 429 ? err.message || t('chat.rateLimited') : err.message);
    } finally {
      setBusy(false);
    }
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
        {loading && <p className="muted">{t('common.loading')}</p>}

        {!loading && messages.length === 0 && (
          <div className="empty">
            <p>{t('chat.emptyPrompt')}</p>
            <p className="fineprint">{t('medical.disclaimer')}</p>
          </div>
        )}

        {messages.map((message, index) => (
          <article key={index} className={`bubble ${message.role}`}>
            <div className="who">{message.role === 'user' ? t('chat.you') : t('chat.coach')}</div>
            <div className="content">{message.content}</div>
          </article>
        ))}

        {busy && (
          <article className="bubble assistant pending">
            <div className="who">{t('chat.coach')}</div>
            <div className="content muted">{t('chat.thinking')}</div>
          </article>
        )}

        <div ref={endRef} />
      </div>

      {error && <p className="error">{error}</p>}

      {/* The input and the button are wrapped, and the counter is not in the
          wrapper. Both halves of that matter - see the .composer note in
          styles.css. In short: the counter used to be a flex item BETWEEN the
          box and the button, and the button, as a direct child of this form,
          was matching a `form > button.primary { min-width: 320px }` rule
          written for the submit button at the bottom of a centred form. On a
          phone that left a 24px textarea beside a button wider than the
          screen. */}
      <form className="composer" onSubmit={send}>
        <div className="composer-row">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e);
            }}
            placeholder={t('chat.placeholder')}
            disabled={busy}
            aria-label={t('chat.inputLabel')}
            {...(maxLength ? { maxLength } : {})}
          />
          <button type="submit" className="primary" disabled={busy || !draft.trim()}>
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
