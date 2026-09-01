/**
 * The two psql features the SQL test suite actually uses, so the suite can be
 * run by something other than psql.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * `npm run test:db` shelled out to psql, psql is not installed on the machine
 * this project is developed on, and so the RLS isolation suite - 22 attacks,
 * the strongest security assertions in the repository - had effectively never
 * been run there. It failed with "sh: psql: command not found", which reads
 * like a broken script rather than like an unrun test suite.
 *
 * That is not a small gap. Two silent production defects in one week were
 * properties of the deployed database that no unit test could see, and this
 * suite is the thing meant to see them.
 *
 * The file is ordinary SQL apart from three lines of psql meta-commands. So
 * rather than requiring psql, this translates those three lines away and hands
 * plain SQL to any Postgres client.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It is not a psql implementation and must never grow into one. It handles
 * `\set` and `\echo` because those are what the file uses. Anything else is
 * reported as unsupported rather than ignored, because silently skipping a
 * meta-command in a SECURITY test could skip the line that sets the role - and
 * a test that runs as the migration role instead of `authenticated` passes
 * everything while asserting nothing.
 */

/** Meta-commands this understands. Anything else is an error, not a shrug. */
const SUPPORTED = new Set(['set', 'echo']);

/**
 * @param {string} source the .sql file contents
 * @returns {{sql: string, echoes: string[]}}
 * @throws on a meta-command it does not implement
 */
export function expandPsql(source) {
  const variables = new Map();
  const echoes = [];
  const out = [];

  for (const [index, line] of source.split('\n').entries()) {
    if (!line.startsWith('\\')) {
      out.push(line);
      continue;
    }

    const match = /^\\(\w+)\s*(.*)$/.exec(line);
    const command = match?.[1]?.toLowerCase();

    if (!command || !SUPPORTED.has(command)) {
      throw new Error(
        `psqlLite does not implement \\${command ?? '?'} (line ${index + 1}): ${line.trim()}\n` +
          'Skipping it silently could skip a `set local role`, and a suite that runs as the ' +
          'wrong role passes everything while asserting nothing. Implement it or use psql.'
      );
    }

    if (command === 'echo') {
      echoes.push(unquote(match[2].trim()));
      // Keep the line count stable so an error's line number still points at
      // the right place in the original file.
      out.push('');
      continue;
    }

    const [, name, rawValue] = /^(\w+)\s+(.*)$/.exec(match[2]) ?? [];
    if (!name) throw new Error(`malformed \\set on line ${index + 1}: ${line.trim()}`);
    variables.set(name, unquote(rawValue.trim()));
    out.push('');
  }

  const sql = substitute(out.join('\n'), variables);

  // Scan for leftovers only OUTSIDE string literals, comments and dollar-quoted
  // bodies. The first version of this check did not, and reported `:true` as an
  // unexpanded variable - it had found the JSON literal '{"forged":true}' in a
  // fixture. psql does not expand inside quotes either, so masking is both the
  // fix and the faithful behavior.
  const leftover = mask(sql).match(/(?<![:\w]):[A-Za-z_]\w*/g);
  if (leftover) {
    // An unexpanded variable would become a Postgres parameter placeholder or
    // a syntax error - either way the suite stops asserting what it says it
    // asserts, so this fails loudly rather than letting it through.
    throw new Error(`unexpanded psql variables: ${[...new Set(leftover)].join(', ')}`);
  }

  return { sql, echoes };
}

/**
 * Replace :NAME outside quotes. Longest name first, so :AB is not clobbered by
 * an earlier pass over :A.
 */
function substitute(sql, variables) {
  if (variables.size === 0) return sql;
  const names = [...variables.keys()].sort((a, b) => b.length - a.length);
  const masked = mask(sql);
  let out = '';
  let i = 0;

  while (i < sql.length) {
    if (masked[i] === sql[i] && sql[i] === ':') {
      const name = names.find((n) => sql.startsWith(n, i + 1) && !/\w/.test(sql[i + 1 + n.length] ?? ''));
      if (name) {
        out += variables.get(name);
        i += name.length + 1;
        continue;
      }
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * A copy of the SQL with the CONTENTS of string literals, dollar-quoted bodies
 * and line comments replaced by spaces, preserving length and line structure.
 *
 * Deliberately not a parser. It knows the three ways this dialect hides text
 * from the statement around it, which is all that is needed to avoid treating
 * `{"forged":true}` as a variable reference.
 */
function mask(sql) {
  const out = sql.split('');
  let i = 0;

  while (i < sql.length) {
    // Line comment
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') out[i++] = ' ';
      continue;
    }

    // Dollar-quoted block: $$ ... $$ or $tag$ ... $tag$
    const dollar = /^\$(\w*)\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      for (let j = i; j < stop; j += 1) if (sql[j] !== '\n') out[j] = ' ';
      i = stop;
      continue;
    }

    // Single-quoted literal, with '' as the escape
    if (sql[i] === "'") {
      out[i] = ' ';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out[i] = out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out[i] = ' ';
          i += 1;
          break;
        }
        if (sql[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/**
 * psql's quoting: the outer single quotes delimit, and a doubled '' inside is
 * one literal quote. `\set A '''x'''` therefore holds the six characters 'x',
 * quotes included, which is exactly how the test file wants it interpolated.
 */
function unquote(value) {
  if (!value.startsWith("'") || !value.endsWith("'") || value.length < 2) return value;
  return value.slice(1, -1).replaceAll("''", "'");
}
