import { readFileSync, readdirSync } from 'node:fs';

/**
 * Read a source file with its comments removed.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Three separate tests in this suite have now failed for the same reason: they
 * asserted that some construct was ABSENT from a file, and matched the comment
 * explaining why it was absent.
 *
 *   - the stretching assertion matched the prompt's own line forbidding the
 *     claim that stretching prevents injury
 *   - the library assertion matched the note explaining why target="_blank"
 *     had been removed
 *   - the stylesheet assertion matched the note explaining why
 *     background-attachment: fixed is not used
 *
 * A regex cannot tell an explanation from a usage, and this codebase comments
 * heavily on purpose, so the collision is structural rather than bad luck.
 * Three occurrences of one bug means the missing thing is an abstraction.
 *
 * Note the asymmetry: absence assertions must use this, presence assertions
 * usually should too, but assertions ABOUT the comments - that a policy page
 * carries its pending-review banner, say - must read the raw file instead.
 */
export function readSource(url) {
  return stripComments(readFileSync(url, 'utf8'));
}

/** The raw file, comments intact, for when the prose is the thing under test. */
export function readRaw(url) {
  return readFileSync(url, 'utf8');
}

/**
 * Removes block and line comments.
 *
 * Deliberately simple. It does not parse strings, so a `//` inside a string
 * literal would be treated as a comment - acceptable here because these tests
 * assert on declarations and JSX attributes, not on URL literals. If that ever
 * stops being true, this needs a real tokeniser rather than a bigger regex.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Collapse all runs of whitespace to single spaces.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * The directives in systemPrompt.js are hard-wrapped template literals, so a
 * phrase the test is looking for is routinely split across a line break and
 * two levels of indentation: "That is not\n  a failure on their part" does not
 * match /not a failure/, and "never\n  use the words" does not match /never
 * use the words/. Both of those wasted a run.
 *
 * This is the same class of problem as readSource() above - a regex written
 * against the meaning of a file, defeated by the file's layout - so it lives
 * next to it. Use it for any assertion about the PROSE of a prompt. Do not use
 * it where the layout is the thing under test.
 */
export function flatten(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * A regex that matches a phrase across the prompt's hard wrapping.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Three separate assertions in this suite have now failed because a phrase in
 * the system prompt is wrapped mid-sentence, so `no named movements` in the
 * editor is `no\n      named movements` in the string. The regex is correct
 * about the prompt's meaning and wrong about its whitespace, which is the
 * least useful kind of test failure: it says the prompt lost a rule when the
 * prompt did not.
 *
 * Same shape as readSource. A collision that keeps happening is not bad luck,
 * it is a missing abstraction - and the fix is the same one: give the suite a
 * way to say what it means.
 *
 *   assert.match(prompt, phrase('do not mention it, do not explain it'));
 *
 * Every run of whitespace in the phrase matches any run of whitespace in the
 * text, and everything else is escaped, so the caller writes prose rather than
 * a pattern.
 *
 * ONE LIMIT WORTH KNOWING, found by tripping over it:
 *
 * It is case-SENSITIVE unless you pass 'i'. Prompt text is written in prose
 * and the same sentence appears capitalised in one place and not in another.
 *
 * There used to be a second limit - it could not cross a JSDoc line break,
 * because the continuation is ` * ` and an asterisk is not whitespace - and
 * this note used to argue for working around it rather than teaching the
 * helper about comment syntax. That argument lost on the third occurrence,
 * once SQL `-- ` continuations had cost a run as well. See GAP below. The
 * rule this file was written under applies to the file itself: three
 * occurrences of one bug means the missing thing is an abstraction.
 */
export function phrase(text, flags = '') {
  const escaped = text
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(GAP);
  return new RegExp(escaped, flags);
}

/**
 * What may separate two words of a phrase.
 *
 * Whitespace, optionally interrupted by a comment marker. The original version
 * allowed only `\s+`, which meant a phrase wrapped across a JSDoc line - where
 * the next line starts ` * ` - did not match, and neither did one wrapped
 * across a SQL comment starting `-- `. That cost a test run on three separate
 * occasions before it was worth generalising, which is the same rule this
 * whole helpers file exists under: three occurrences of one bug means the
 * missing thing is an abstraction.
 *
 * Deliberately still anchored on whitespace at both ends, so this cannot match
 * a `*` that is doing real work - a multiplication, a glob - only one that is
 * sitting at the start of a continuation line where a comment marker goes.
 *
 * `#` joined the list when the repository gained its first Python file
 * (scripts/generate-icons.py) and an assertion about its reasoning failed on a
 * phrase wrapped across two comment lines. Fourth marker, same cause: the set
 * of comment syntaxes a repository contains grows, and the helper is where
 * that belongs rather than in every caller reflowing a comment to suit a test.
 */
const GAP = '\\s+(?:(?:\\*|--|//|#)\\s+)?';

/**
 * The profile write API, as one text.
 *
 * Its zod schema moved out of `routes/profile.js` into `lib/profileSchema.js`
 * so that a test could import it without dragging express, the logger and the
 * request pipeline along with it - see server/test/profilePayload.test.js,
 * which parses what the browser actually builds.
 *
 * Seven test files broke on that move, and every one of them was right to
 * exist and wrong about its subject: they read "the profile route" and meant
 * "the profile API". Which file a validation rule is declared in is not a fact
 * any of them were trying to assert. So they read both, and a future split
 * changes one function instead of seven files.
 */
export function readProfileApi({ raw = false } = {}) {
  const read = raw ? readRaw : readSource;
  return [
    read(new URL('../../src/routes/profile.js', import.meta.url)),
    read(new URL('../../src/lib/profileSchema.js', import.meta.url)),
  ].join('\n');
}

/**
 * The CURRENT definition of a database object, wherever it was last defined.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Two tests asserted things about `private.health_fingerprint` by reading
 * migration 0012 and migration 0024 - the files that happened to define it at
 * the time each test was written. Those files are frozen. A migration directory
 * is append-only, so a later file replacing the function cannot make an
 * assertion about an earlier file fail, and both tests kept passing while the
 * live definition changed underneath them.
 *
 * That is the same defect as the invariant that checked the fingerprint's
 * contents but not whether the trigger still called it: reading a real
 * artifact, and the wrong one. The last file that defines an object is the only
 * file that describes it.
 *
 * @param {string} declaration - the text that opens the definition, without the
 *   `create [or replace]` or `add` prefix - e.g. `function
 *   private.health_fingerprint`, or `constraint consent_records_type_check`.
 * @returns {{file: string, body: string}} the newest migration defining it, and
 *   the definition from that point to the end of the statement.
 */
export function latestDefinition(declaration) {
  const dir = new URL('../../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().reverse();

  for (const file of files) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    const at = Math.max(
      sql.lastIndexOf(`create or replace ${declaration}`),
      sql.lastIndexOf(`create ${declaration}`),
      // Constraints are not created, they are added - and they are re-added by
      // a later migration exactly as functions are replaced by one, so they
      // have the same append-only trap. Second shape, same helper: the
      // alternative was a second hand-rolled scan in the one test that needed
      // it, which is how the first version of this problem started.
      sql.lastIndexOf(`add ${declaration}`)
    );
    if (at === -1) continue;

    // A constraint ends at the semicolon; there is no dollar-quoted body to
    // find, and looking for one would run to the end of the file.
    if (sql.startsWith('add ', at) || sql.slice(at).startsWith('add ')) {
      const semi = sql.indexOf(';', at);
      return { file, body: semi === -1 ? sql.slice(at) : sql.slice(at, semi + 1) };
    }

    // To the end of the dollar-quoted body, which is where every definition in
    // this directory ends. Falls back to the end of the file.
    const open = sql.indexOf('$', at);
    const tag = open === -1 ? null : sql.slice(open, sql.indexOf('$', open + 1) + 1);
    const close = tag ? sql.indexOf(tag, sql.indexOf(tag, at) + tag.length) : -1;
    return { file, body: close === -1 ? sql.slice(at) : sql.slice(at, close + tag.length) };
  }

  throw new Error(`No migration defines ${declaration}`);
}
