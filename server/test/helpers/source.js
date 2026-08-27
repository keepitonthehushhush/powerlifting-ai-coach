import { readFileSync } from 'node:fs';

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
