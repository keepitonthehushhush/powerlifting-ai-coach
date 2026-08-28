import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

/**
 * ── WHY THIS REPOSITORY FINALLY HAS A LINTER ──────────────────────────────
 *
 * Two production breaks in one week, from one commit, and a default ESLint
 * rule would have caught each at the moment it was typed:
 *
 *   1. `glp1_status: form.glp1_status || null` left inside EMPTY, a
 *      module-level constant where `form` does not exist. ReferenceError
 *      during import, before React mounted. Every page blank. That is
 *      `no-undef`, and it is also `no-dupe-keys` - the same object already
 *      declared `glp1_status`.
 *   2. `auth` declaring `password` twice in the locale catalogue, once a
 *      string and once an object. The object won, the sign-in field was
 *      labelled "auth.password" in production. `no-dupe-keys` again.
 *
 * Neither produced a build error, because both are valid JavaScript. The
 * repository had thirteen checks and every one of them was reading the code
 * rather than analysing it.
 *
 * So the rule set below is deliberately NOT a style guide. There are no
 * formatting rules, no opinionated preferences, and nothing that would make a
 * review argument. It is the recommended set - which is to say, the set of
 * things that are almost always a mistake - and the point of adopting it is
 * the four or five rules in it that describe bugs this project has actually
 * shipped.
 */

/**
 * A component referenced only from JSX is not "unused".
 *
 * `no-unused-vars` works from scope analysis, and ESLint's scope analyser does
 * not treat a JSXIdentifier as a reference to a variable. So `import { Foo }`
 * used as `<Foo />` reads as unused, and every page in this app would report
 * four or five false positives. The usual answer is eslint-plugin-react, which
 * is a large dependency carrying a hundred rules to fix that one thing.
 *
 * This is that one thing. It marks the identifier at the head of every JSX
 * element as used, ignoring lowercase names, which are host elements (`<div>`)
 * and not variables at all.
 */
const jsxUsesVars = {
  rules: {
    'jsx-uses-vars': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          JSXOpeningElement(node) {
            let name = node.name;
            while (name.type === 'JSXMemberExpression') name = name.object;
            if (name.type !== 'JSXIdentifier') return;
            if (!/^[A-Z_$]/.test(name.name)) return;
            context.sourceCode.markVariableAsUsed(name.name, name);
          },
        };
      },
    },
  },
};

/** Rules shared by every file in the repository. */
const shared = {
  // The two that would have caught the outages. Errors, not warnings: a
  // warning is a thing CI prints and nobody reads.
  'no-undef': 'error',
  'no-dupe-keys': 'error',

  // Unused code is how a rename leaves half of itself behind. Arguments are
  // exempt because an Express handler's `next` is positional - dropping it
  // changes what Express passes.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],

  // `if (x) ;` and `if (a) {} else if (a) {}` are always typos.
  'no-empty': ['error', { allowEmptyCatch: true }],

  // An await inside a loop is usually a serial round trip somebody meant to
  // parallelise - but not always, and this codebase has deliberate ones.
  // Left off rather than silenced case by case.
};

export default defineConfig([
  {
    // Build output, dependencies, and the icon generator, which is Python.
    ignores: ['**/node_modules/**', 'web/dist/**', 'coverage/**'],
  },

  js.configs.recommended,

  {
    name: 'browser',
    files: ['web/src/**/*.js', 'web/src/**/*.jsx'],
    plugins: { local: jsxUsesVars, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Replaced at build time by vite.config.js, so it exists in the bundle
        // and nowhere else. Undeclared, it reads as a typo.
        __BUILD_ID__: 'readonly',
        // Replaced at build time too - see web/src/lib/environment.js.
        __VERCEL_ENV__: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...shared,
      'local/jsx-uses-vars': 'error',
      /**
       * Browser only, and not for tidiness.
       *
       * Injury and restriction fields are health information, and the standing
       * rule for them is that they are never written to a console or an error
       * tracker in plaintext. `console.log(profile)` is one keystroke and
       * leaves no trace in review. This makes it fail.
       *
       * ErrorBoundary keeps a console.error behind an explicit disable: an
       * unrecoverable render error is the one case where the browser console
       * is the only channel left, and it logs the error rather than the state.
       */
      'no-console': 'error',

      /**
       * TWO RULES OUT OF THE PLUGIN'S THIRTY, REGISTERED BY HAND.
       *
       * v7 of eslint-plugin-react-hooks ships the React Compiler rule set -
       * purity, memoisation, immutability, static components. Those are a
       * commitment to a way of writing React, not a bug detector, and adopting
       * them by taking `configs.recommended` wholesale would land thirty rules
       * this project has never decided about. So the plugin is registered and
       * exactly two of its rules are switched on.
       *
       * rules-of-hooks: a hook called conditionally or inside a loop is always
       * a bug, with no judgement call attached.
       *
       * exhaustive-deps: enabled precisely BECAUSE this codebase disagrees
       * with it in one place and said so. Turnstile.jsx holds its callbacks in
       * refs and passes `[]` deliberately - a dependency array containing a
       * callback prop rebuilt the widget on every keystroke, which is what
       * "Cloudflare is freaking out" turned out to be. Three other components
       * carry the same directive with their own reasons.
       *
       * Those four `eslint-disable-next-line react-hooks/exhaustive-deps`
       * comments were in the source before any linter existed, suppressing a
       * rule that had never run. Leaving the rule off would keep them
       * decorative. Turning it on makes each one a decision that had to be
       * written down, and makes a FIFTH one - added without a reason, by
       * somebody silencing a warning - visible in a diff.
       */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    name: 'node',
    files: ['server/**/*.js', 'scripts/**/*.mjs', 'web/*.js', '*.js', '*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: shared,
  },
]);
