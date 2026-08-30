/**
 * The coach writes markdown. The transcript was rendering it as literal text.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `<div className="content">{message.content}</div>` with `white-space:
 * pre-wrap` puts the reply on screen exactly as the model wrote it, asterisks
 * and all. A week of training came out as
 *
 *     **Day A**
 *     - Squat: 3x5 @ 95lb
 *
 * which is a program an athlete has to decode before they can follow it. The
 * model is not misbehaving - the system prompt asks for markdown and markdown
 * is what it sends. Nothing was turning it into typography.
 *
 * ── WHY NOT A MARKDOWN LIBRARY ────────────────────────────────────────────
 *
 * Every general-purpose markdown renderer ends at `dangerouslySetInnerHTML`,
 * and this is a health product whose input is model output that has already
 * been the target of prompt injection twice in the adversarial suite. An
 * athlete can put text in their profile; the coach quotes profiles back. The
 * path from "a user typed it" to "the browser executed it" has to not exist,
 * rather than exist behind a sanitiser that has to be right every time.
 *
 * So this parses into a plain data structure and the component renders React
 * elements from it. React escapes text nodes by construction. There is no
 * HTML string anywhere in the pipeline, no sanitiser to keep current, and no
 * dependency to audit - and a `<script>` in a reply renders as the characters
 * `<script>`, which is the correct outcome and is asserted by a test.
 *
 * ── WHY A SUBSET, AND WHICH ONE ───────────────────────────────────────────
 *
 * The subset is what the coach actually emits, read off real replies from the
 * adversarial evaluation and production: paragraphs, headings, bullet and
 * numbered lists, pipe tables (meet-prep blocks use them), and inline bold,
 * italic and code. Anything unrecognised falls through as text rather than
 * being dropped - an unsupported construct should look plain, never vanish.
 */

/** A line that is nothing but bold text is a heading in every reply we have. */
const BOLD_ONLY_LINE = /^\*\*(.+)\*\*:?$/;
const ATX_HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^(\d{1,3})[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

const splitRow = (line) =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());

/**
 * Inline spans: bold, italic, code. Returns an array of
 * `{ type: 'text'|'bold'|'italic'|'code', value }`.
 *
 * Deliberately one pass with one alternation rather than nested passes. A
 * nested implementation has to decide what `**a _b_ c**` means and gets it
 * wrong in a way nobody notices; this one produces a flat, predictable list
 * and the coach does not nest emphasis.
 */
export function parseInline(text) {
  const spans = [];
  const pattern = /\*\*([^*]+)\*\*|(?<!\w)_([^_]+)_(?!\w)|`([^`]+)`/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) spans.push({ type: 'text', value: text.slice(last, match.index) });
    if (match[1] !== undefined) spans.push({ type: 'bold', value: match[1] });
    else if (match[2] !== undefined) spans.push({ type: 'italic', value: match[2] });
    else spans.push({ type: 'code', value: match[3] });
    last = match.index + match[0].length;
  }

  if (last < text.length) spans.push({ type: 'text', value: text.slice(last) });
  return spans.length > 0 ? spans : [{ type: 'text', value: text }];
}

/**
 * @param {string} source
 * @returns {Array<object>} blocks: heading | paragraph | list | table
 */
export function parseCoachMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    const atx = trimmed.match(ATX_HEADING);
    if (atx) {
      flushParagraph();
      blocks.push({ type: 'heading', level: Math.min(atx[1].length + 1, 5), spans: parseInline(atx[2]) });
      continue;
    }

    const boldOnly = trimmed.match(BOLD_ONLY_LINE);
    if (boldOnly) {
      flushParagraph();
      blocks.push({ type: 'heading', level: 4, spans: parseInline(boldOnly[1]) });
      continue;
    }

    // A table needs a header row and a divider directly under it. Without the
    // divider a line containing a pipe is just prose containing a pipe.
    if (trimmed.includes('|') && TABLE_DIVIDER.test((lines[i + 1] ?? '').trim())) {
      flushParagraph();
      const header = splitRow(trimmed);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().includes('|')) {
        rows.push(splitRow(lines[j].trim()).map((cell) => parseInline(cell)));
        j += 1;
      }
      blocks.push({ type: 'table', header: header.map((cell) => parseInline(cell)), rows });
      i = j - 1;
      continue;
    }

    const bullet = trimmed.match(BULLET);
    const ordered = trimmed.match(ORDERED);
    if (bullet || ordered) {
      flushParagraph();
      const ordering = ordered ? 'ordered' : 'unordered';
      const items = [];
      let j = i;
      while (j < lines.length) {
        const candidate = lines[j].trim();
        const asBullet = candidate.match(BULLET);
        const asOrdered = candidate.match(ORDERED);
        const matched = ordering === 'ordered' ? asOrdered : asBullet;
        if (matched) {
          items.push(parseInline(ordering === 'ordered' ? matched[2] : matched[1]));
          j += 1;
          continue;
        }
        // A wrapped continuation line belongs to the item above it. Without
        // this a long cue becomes its own paragraph in the middle of a list.
        if (candidate !== '' && !asBullet && !asOrdered && items.length > 0 && lines[j].startsWith(' ')) {
          const previous = items[items.length - 1];
          previous.push({ type: 'text', value: ` ${candidate}` });
          j += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordering, items });
      i = j - 1;
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}
