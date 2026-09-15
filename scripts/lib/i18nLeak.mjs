/**
 * Did a translation key render as visible text?
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * `t()` returns the key itself on a miss, so a missing string is not an error
 * and not a blank - it is the literal `activity.action.clearance_asserted`
 * printed on the page. The account page did that to every athlete who had ever
 * confirmed medical clearance: eight rows in production, which was every row
 * that card had ever had.
 *
 * ── WHY IT IS ITS OWN FILE ────────────────────────────────────────────────
 *
 * check-app-mounts.mjs has had this detector for a year and found nothing,
 * because it was pointed at two pages and then eleven - all of them the ones a
 * SIGNED-OUT browser can reach. Its own header names the hole in as many
 * words: "the account page itself still cannot be checked here... which is a
 * real remaining gap and is named in the list below rather than left to be
 * rediscovered." The account page is where the bug was.
 *
 * check-screens.mjs closes it by running the same detector over the review
 * harness, which mounts all eighteen screens signed in. Two callers, one
 * detector, because two copies of this would drift and only one of them would
 * be the one that found anything.
 */

import { readFile } from 'node:fs/promises';

/** Entities, because the DOM arrives as serialized HTML. */
export function decodeEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * @param {string} dom serialized HTML
 * @param {string} localePath path to web/src/i18n/locales/en.js
 * @returns {Promise<string[]>} distinct keys found rendered as text
 */
export async function untranslatedKeys(dom, localePath) {
  const en = await readFile(localePath, 'utf8');
  const namespaces = [...en.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9_]*): \{$/gm)].map((match) => match[1]);
  if (namespaces.length === 0) {
    throw new Error('found no top-level namespaces in en.js - has the shape of the locale file changed?');
  }

  // Visible text only: attributes legitimately contain dotted names.
  const text = decodeEntities(
    dom
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  );

  const pattern = new RegExp(`(?:^|\\s)((?:${namespaces.join('|')})(?:\\.[a-zA-Z][a-zA-Z0-9_]*)+)`, 'g');
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}
