import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import {
  readChatSettings,
  writeChatSettings,
  UNDO_CHOICES,
  SEND_KEY_CHOICES,
} from '../lib/chatSettings.js';

/**
 * How the conversation behaves. Two controls, both about the keyboard.
 *
 * Radio groups rather than a select, because there are two and three options
 * and every choice is worth reading before making. A <select> hides the
 * alternatives behind a tap, which is the wrong trade for a setting somebody
 * visits once.
 *
 * Saved on change, with no Save button. There is nothing to validate across
 * fields and nothing to submit, so a button would only add a step in which the
 * change can be lost.
 */
export function ChatSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(readChatSettings);

  const update = (patch) => setSettings(writeChatSettings({ ...settings, ...patch }));

  return (
    <section className="card stack">
      <h2 className="h3">{t('chatSettings.heading')}</h2>
      <p className="small muted">{t('chatSettings.intro')}</p>

      <fieldset className="setting-group">
        <legend>{t('chatSettings.sendKeyLegend')}</legend>
        {SEND_KEY_CHOICES.map((choice) => (
          <label key={choice} className="setting-choice">
            <input
              type="radio"
              name="sendKey"
              value={choice}
              checked={settings.sendKey === choice}
              onChange={() => update({ sendKey: choice })}
            />
            <span>{t(`chatSettings.sendKey.${choice}`)}</span>
          </label>
        ))}
        <p className="small muted">{t('chatSettings.sendKeyHint')}</p>
      </fieldset>

      <fieldset className="setting-group">
        <legend>{t('chatSettings.undoLegend')}</legend>
        {UNDO_CHOICES.map((seconds) => (
          <label key={seconds} className="setting-choice">
            <input
              type="radio"
              name="undoWindow"
              value={seconds}
              checked={settings.undoWindowSeconds === seconds}
              onChange={() => update({ undoWindowSeconds: seconds })}
            />
            <span>
              {seconds === 0
                ? t('chatSettings.undoOff')
                : t('chatSettings.undoSeconds', { seconds })}
            </span>
          </label>
        ))}
        <p className="small muted">{t('chatSettings.undoHint')}</p>
      </fieldset>
    </section>
  );
}
