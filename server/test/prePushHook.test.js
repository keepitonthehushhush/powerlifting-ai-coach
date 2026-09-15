import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRaw } from './helpers/source.js';

const HOOK = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
const hookSource = readRaw(new URL('../../.githooks/pre-push', import.meta.url));
const pkg = JSON.parse(readRaw(new URL('../../package.json', import.meta.url)));
const ZERO = '0'.repeat(40);

let repo;

/**
 * ── A STEP SOMEBODY HAS TO REMEMBER IS NOT A CONTROL ──────────────────────
 *
 * Vercel's "Require Verified Commits" cancels the deployment for any commit
 * GitHub has not verified. An unsigned commit therefore does not FAIL: it
 * pushes cleanly, GitHub accepts it, and the deploy is canceled without
 * building - which looks like nothing happening rather than like an error.
 *
 * The agent commits from a machine that cannot reach the signing key, so its
 * commits arrive unsigned and must be amended on the Mac before pushing. That
 * step was introduced and forgotten within a day, and 0a45c4a5 reached
 * origin/main carrying no signature at all, where it can never verify.
 *
 * These tests RUN the hook rather than reading it. A hook asserted by grep is
 * a hook nobody has executed.
 */
before(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'hooktest-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first, unsigned');
});

after(() => rmSync(repo, { recursive: true, force: true }));

/** Runs the hook the way git does: refs on stdin, cwd inside the repository. */
function runHook(stdin, cwd = repo) {
  const result = spawnSync('sh', [HOOK, 'origin', 'https://example.invalid'], {
    cwd, input: stdin, encoding: 'utf8',
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

describe('the pre-push hook refuses what Vercel would silently cancel', () => {
  test('AN UNSIGNED COMMIT IS REFUSED, which is the whole point', () => {
    const { status, out } = runHook(`refs/heads/main ${head()} refs/heads/main ${ZERO}\n`);
    assert.equal(status, 1, 'an unsigned commit was allowed through');
    assert.match(out, /REFUSED/);
    assert.match(out, /CANCELED/, 'the message does not say what will actually happen');
    assert.match(out, /git commit --amend --no-edit/, 'the message does not say how to fix one commit');
  });

  test('a SIGNED commit passes', () => {
    /*
     * The signature is fabricated - a `gpgsig` header spliced into a real
     * commit object and written back with `hash-object`. That is the right
     * fidelity: the hook's job is to notice whether a signature is PRESENT,
     * and whether it is VALID is GitHub's job, not a shell script's. Testing
     * against a real key would test ssh-keygen.
     */
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    const raw = execFileSync('git', ['cat-file', 'commit', head()], { cwd: repo, encoding: 'utf8' });
    const signed = raw.replace(
      /\ncommitter ([^\n]*)\n/,
      '\ncommitter $1\ngpgsig -----BEGIN SSH SIGNATURE-----\n fabricated\n -----END SSH SIGNATURE-----\n',
    );
    const sha = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'],
      { cwd: repo, encoding: 'utf8', input: signed }).trim();
    git('update-ref', 'refs/heads/main', sha);

    assert.equal(
      execFileSync('git', ['cat-file', 'commit', sha], { cwd: repo, encoding: 'utf8' })
        .split('\n\n')[0].includes('gpgsig'),
      true,
      'the fabricated signature did not land, so the assertion below would be vacuous',
    );

    const { status, out } = runHook(`refs/heads/main ${sha} refs/heads/main ${ZERO}\n`);
    assert.equal(status, 0, `a signed commit was refused:\n${out}`);
    assert.equal(out.trim(), '', 'a passing hook printed something');
  });

  test('deleting a branch is not a push of commits', () => {
    // `git push origin :branch` sends an all-zero LOCAL sha. Walking that would
    // be an error, and refusing it would make deleting a branch impossible.
    const { status } = runHook(`refs/heads/gone ${ZERO} refs/heads/gone ${head()}\n`);
    assert.equal(status, 0, 'deleting a branch was refused');
  });

  test('nothing on stdin is nothing to refuse', () => {
    assert.equal(runHook('').status, 0, 'an empty push was refused');
  });

  test('several unsigned commits get the rebase form, anchored on the OLDEST', () => {
    /*
     * `git commit --amend` only reaches HEAD. With more than one unsigned
     * commit the fix is a rebase, and its base has to be the parent of the
     * oldest one - `rev-list` prints newest first, so that is the LAST line.
     * Getting this backwards would print a command that silently amends only
     * part of the range.
     */
    assert.match(hookSource, /tail -1/, 'the rebase base is no longer taken from the oldest unsigned commit');
    assert.match(hookSource, /git rebase --exec/, 'the multi-commit fix is not offered');
    assert.match(hookSource, /force-with-lease/, 'the rebase form omits the push that follows it');
    assert.doesNotMatch(hookSource, /--force\b(?!-with-lease)/, 'a bare --force is suggested');
  });

  test('the escape hatch exists and is named', () => {
    // A control with no bypass gets disabled entirely the first time it is
    // wrong. --no-verify is git's own, and saying so keeps it visible.
    assert.match(hookSource, /--no-verify/, 'there is no way past the hook');
  });

  test('it is executable, and installing it is one documented command', () => {
    assert.ok(statSync(HOOK).mode & 0o111, 'the hook is not executable, so git will ignore it');
    assert.equal(pkg.scripts.hooks, 'git config core.hooksPath .githooks && echo "hooks installed: .githooks"');
  });
});
