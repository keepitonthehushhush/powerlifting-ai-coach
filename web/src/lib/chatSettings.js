/**
 * How the athlete wants the conversation to behave.
 *
 * ── WHY THESE ARE PREFERENCES AND NOT DECISIONS ───────────────────────────
 *
 * The undo window shipped as a five-second hold before every message. It was
 * built to solve a real complaint - there was no way to take back a typo - and
 * the person who reported the complaint tried it and found the cure worse than
 * the disease. Both readings are correct: catching a typo is worth five
 * seconds to somebody who mistypes, and worth nothing to somebody who does
 * not. That is the definition of a preference, not of a default.
 *
 * ── WHY LOCAL STORAGE AND NOT A PROFILE COLUMN ────────────────────────────
 *
 * These describe how a keyboard and a screen behave, not who the athlete is.
 * Enter-to-send is right on a laptop and wrong on a phone, and the same person
 * uses both - so a per-device answer is more correct here than a synced one,
 * not merely cheaper. It also keeps them out of the database entirely, which
 * on a product where every profile column has to be reasoned about for health
 * data is worth something on its own. The locale picker already works this
 * way; this follows it deliberately rather than inventing a second pattern.
 *
 * Storage can throw - private browsing, storage disabled - so every read and
 * write is guarded and the defaults are what a broken store produces. A
 * settings module that can prevent the app from rendering is worse than no
 * settings module.
 */

const STORAGE_KEY = 'coach.chatSettings';

/**
 * Defaults are what the product did before it had settings, with one
 * exception: `undoWindow` is OFF.
 *
 * It shipped on, and the first person to use it in anger said it was more
 * annoying than helpful. A five-second delay is paid on every message by
 * everybody, to serve the occasional typo. Somebody who wants it can say so;
 * charging everyone for it by default is the wrong way round.
 */
export const DEFAULTS = Object.freeze({
  /** Hold a message before sending so it can be taken back. Seconds, or 0 for off. */
  undoWindowSeconds: 0,
  /** 'enter' sends on Enter; 'modifier' needs Cmd/Ctrl+Enter and Enter adds a line. */
  sendKey: 'enter',
});

export const UNDO_CHOICES = [0, 3, 5, 10];
export const SEND_KEY_CHOICES = ['enter', 'modifier'];

function coerce(raw) {
  const settings = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return settings;

  // Validated rather than trusted. This is user-writable storage: anybody can
  // open the console and put a string where a number goes, and the result must
  // be the default, never a hold of "NaN" seconds that never elapses.
  if (UNDO_CHOICES.includes(raw.undoWindowSeconds)) {
    settings.undoWindowSeconds = raw.undoWindowSeconds;
  }
  if (SEND_KEY_CHOICES.includes(raw.sendKey)) {
    settings.sendKey = raw.sendKey;
  }
  return settings;
}

export function readChatSettings() {
  try {
    return coerce(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeChatSettings(next) {
  const settings = coerce(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage refused. The setting still applies for this session, because the
    // caller holds it in state - it just will not survive a reload, which is a
    // better outcome than throwing inside a change handler.
  }
  return settings;
}

/**
 * Does this keydown mean "send"?
 *
 * Pulled out of the component so both spellings can be tested without a DOM.
 * Shift+Enter always means a new line, under either setting - that convention
 * is older than this app and breaking it would surprise everybody.
 */
export function isSendKey(event, sendKey) {
  if (event.key !== 'Enter' || event.shiftKey) return false;
  if (sendKey === 'modifier') return event.metaKey || event.ctrlKey;
  return !event.metaKey && !event.ctrlKey;
}
