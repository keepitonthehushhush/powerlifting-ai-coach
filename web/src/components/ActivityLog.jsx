import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

/**
 * What has been done with your account, shown to the person it happened to.
 *
 * This is the half that makes the audit table worth having. A trail only the
 * operator can read proves nothing to the person asking; showing it here means
 * "we exported your data on the 3rd" is something they can check rather than
 * something we assert.
 *
 * It renders nothing when there is nothing, rather than an empty card headed
 * "Activity" - a new account has no history and should not be shown a box
 * explaining that.
 */
export function ActivityLog() {
  const { t } = useI18n();
  const [events, setEvents] = useState(null);

  useEffect(() => {
    api.getActivity().then((r) => setEvents(r?.events ?? [])).catch(() => setEvents([]));
  }, []);

  if (!events || events.length === 0) return null;

  return (
    <section className="card stack">
      <h2 className="h3">{t('activity.title')}</h2>
      <p className="muted small">{t('activity.intro')}</p>
      <ul className="badges">
        {events.map((event, index) => (
          <li key={`${event.created_at}-${index}`} className="badge">
            <strong>{t(`activity.action.${event.action}`)}</strong>
            <span className="muted small">
              {new Date(event.created_at).toLocaleString()}
              {event.actor === 'stripe' && ` · ${t('activity.byStripe')}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
