import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export function Chat() {
  const { signOut } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const endRef = useRef(null);

  useEffect(() => {
    api
      .getConversation()
      .then(({ conversation }) => {
        if (conversation) {
          setConversationId(conversation.id);
          setMessages(conversation.messages ?? []);
        }
      })
      .catch(() => setError('Could not load your conversation.'))
      .finally(() => setLoading(false));
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
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page chat-page">
      <header className="page-header row">
        <div>
          <h1 className="brand small">Coach</h1>
        </div>
        <nav className="row gap">
          <Link className="link" to="/intake">
            Edit profile
          </Link>
          <button type="button" className="link" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </header>

      <div className="transcript" role="log" aria-live="polite">
        {loading && <p className="muted">Loading…</p>}

        {!loading && messages.length === 0 && (
          <div className="empty">
            <p>
              Say hello and Coach will take it from there — it will ask what it needs before
              writing anything.
            </p>
            <p className="fineprint">
              Coach is an AI tool, not a medical professional. If you have current pain, an injury,
              or a health condition, get clearance from a doctor or physical therapist first.
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <article key={index} className={`bubble ${message.role}`}>
            <div className="who">{message.role === 'user' ? 'You' : 'Coach'}</div>
            <div className="content">{message.content}</div>
          </article>
        ))}

        {busy && (
          <article className="bubble assistant pending">
            <div className="who">Coach</div>
            <div className="content muted">Thinking…</div>
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
          placeholder="How did that session go?"
          disabled={busy}
          aria-label="Message Coach"
        />
        <button type="submit" className="primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
