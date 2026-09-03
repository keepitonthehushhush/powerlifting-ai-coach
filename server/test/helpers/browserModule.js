import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Load a browser module in node by replacing ONLY its import lines.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `web/src/lib/crashReporter.js` reaches the Supabase client and `config.js`,
 * which reads `import.meta.env` - undefined outside Vite, so importing it in a
 * test throws before a single line of its own logic runs. That is exactly why
 * the decisions were moved into the pure `crashReport.js`.
 *
 * But what is LEFT there is not nothing: a JSON round trip through
 * sessionStorage, and the fetch that finally carries a report. Those had no
 * test, and "every piece is correct" is the shape of assumption this project
 * keeps being wrong about.
 *
 * So the file is loaded with its imports swapped and NOTHING ELSE TOUCHED -
 * and that is asserted rather than hoped. A harness that quietly paraphrases
 * the code under test reports on code that does not ship; it happened here
 * once already, with a `useRef` that was never shimmed and a harness that
 * cheerfully found no bug in a real one.
 *
 * @param {URL} url - the real module.
 * @param {Array<[string, string]>} replacements - exact import line, and what
 *   to put in its place. A line that is not found throws rather than being
 *   skipped: a stub that silently does not apply is a no-op plant, and this
 *   codebase has a rule about those.
 */
export async function loadWithStubbedImports(url, replacements) {
  const source = readFileSync(url, 'utf8');
  const sourceDir = dirname(fileURLToPath(url));

  let rewritten = source;
  for (const [importLine, stub] of replacements) {
    if (!rewritten.includes(importLine)) {
      throw new Error(`import line not found, so nothing was stubbed:\n${importLine}`);
    }
    rewritten = rewritten.replace(importLine, stub);
  }

  /*
   * The harness lives in a temp directory, so the module's own relative
   * imports - the ones NOT being stubbed, like the pure crashReport.js - no
   * longer resolve. They are re-pointed at the real files rather than stubbed,
   * because the real ones are part of what is under test.
   */
  rewritten = rewritten.replace(
    /from '(\.[^']+)'/g,
    (_, spec) => `from '${pathToFileURL(join(sourceDir, spec)).href}'`
  );

  assertBodyUnchanged(source, rewritten, replacements);

  const dir = join(tmpdir(), 'coachdiaz-harness');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `mod-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, rewritten);
  return import(pathToFileURL(file).href);
}

/**
 * Everything that is not an import or a stub must be byte-identical.
 *
 * The first version of this compared "everything after the last line starting
 * with `import`", which is wrong the moment a module wraps a long import
 * across several lines - the closing `} from '...'` sits BELOW that line and
 * landed in the body. It threw, correctly, and that is the only reason this
 * comment exists: a self-check that cannot be trusted to fail is worth less
 * than no self-check at all.
 *
 * So: drop every line carrying a module specifier, drop the stub lines the
 * caller supplied, and compare what is left. That is the code under test.
 */
function assertBodyUnchanged(source, rewritten, replacements) {
  const stubs = new Set(replacements.flatMap(([, stub]) => stub.split('\n').map((l) => l.trim())));
  const body = (text) =>
    text
      .split('\n')
      .filter((line) => !line.includes("from '") && !stubs.has(line.trim()))
      .join('\n');

  if (body(source) !== body(rewritten)) {
    throw new Error('the harness changed more than the imports');
  }
  if (body(source).length < 200) {
    // A comparison of almost nothing passes trivially. This file exists to
    // stop exactly that class of check.
    throw new Error('the harness compared almost no code, so it proved almost nothing');
  }
}
