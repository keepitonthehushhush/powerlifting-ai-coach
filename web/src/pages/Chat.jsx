import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';

export function Chat() {
  const { signOut } = useAuth();
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
      <header className="page-header row">
        <h1 className="brand small">{t('common.appName')}</h1>
        <nav className="row gap">
          <LanguageSwitcher />
          <Link className="link" to="/log">
            {t('chat.logSession')}
          </Link>
          <Link className="link" to="/intake">
            {t('chat.editProfile')}
          </Link>
          <Link className="link" to="/account">
            {t('account.title')}
          </Link>
          <button type="button" className="link" onClick={signOut}>
            {t('common.signOut')}
          </button>
        </nav>
      </header>

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

      <form className="composer" onSubmit={send}>
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
        {/* Only once it is nearly relevant. A counter sitting under an empty
            box is clutter; a counter that appears at 80% is a warning. */}
        {maxLength && draft.length > maxLength * 0.8 && (
          <p className={draft.length >= maxLength ? 'error small' : 'muted small'}>
            {t('chat.characterCount', {
              count: draft.length.toLocaleString(),
              limit: maxLength.toLocaleString(),
            })}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || !draft.trim()}>
          {t('chat.send')}
        </button>
      </form>
    </div>
  );
}
