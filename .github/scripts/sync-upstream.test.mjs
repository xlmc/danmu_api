import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareSync, publishSync, pushArgs, SYNC_BRANCH } from './sync-upstream.mjs';

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'danmu-sync-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(cwd)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cwd).startsWith('danmu-sync-'));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = (file, text, message) => {
    fs.writeFileSync(path.join(cwd, file), text);
    git('add', file); git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--initial-branch=main'); git('config', 'core.autocrlf', 'false'); git('config', 'user.email', 'tests@example.invalid'); git('config', 'user.name', 'Sync Tests');
  const root = commit('shared.txt', 'base\n', 'base');
  git('update-ref', 'refs/remotes/origin/main', root);
  git('update-ref', 'refs/remotes/upstream/main', root);
  return { cwd, git, commit, root };
}

test('no upstream change creates no sync commit or branch', t => {
  const f = fixture(t);
  assert.equal(prepareSync(f).changed, false);
  assert.equal(f.git('rev-parse', 'HEAD'), f.root);
});

test('clean upstream merge preserves self-use changes and both parents', t => {
  const f = fixture(t);
  const custom = f.commit('custom.txt', 'personal feature\n', 'custom');
  f.git('update-ref', 'refs/remotes/origin/main', custom);
  f.git('checkout', '--detach', f.root);
  const upstream = f.commit('upstream.txt', 'new feature\n', 'upstream');
  f.git('update-ref', 'refs/remotes/upstream/main', upstream);
  f.git('checkout', 'main');
  const state = prepareSync(f);
  assert.equal(state.changed, true); assert.deepEqual(state.conflicts, []);
  assert.equal(fs.readFileSync(path.join(f.cwd, 'custom.txt'), 'utf8'), 'personal feature\n');
  assert.equal(fs.readFileSync(path.join(f.cwd, 'upstream.txt'), 'utf8'), 'new feature\n');
  assert.equal(f.git('rev-parse', 'main^1'), custom);
  assert.equal(f.git('rev-parse', 'main^2'), upstream);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/main'), custom);
});

test('conflicts keep main unchanged and publish only an upstream snapshot', t => {
  const f = fixture(t);
  const custom = f.commit('shared.txt', 'personal\n', 'custom');
  f.git('update-ref', 'refs/remotes/origin/main', custom);
  f.git('checkout', '--detach', f.root);
  const upstream = f.commit('shared.txt', 'official\n', 'upstream');
  f.git('update-ref', 'refs/remotes/upstream/main', upstream);
  f.git('checkout', 'main');
  const state = prepareSync(f);
  assert.deepEqual(state.conflicts, ['shared.txt']);
  assert.equal(f.git('rev-parse', 'main'), custom);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/main'), custom);
  assert.equal(state.head, upstream);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('dirty checkout is refused before a merge', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.cwd, 'shared.txt'), 'uncommitted');
  assert.throws(() => prepareSync(f), /clean checkout/);
  assert.equal(f.git('rev-parse', 'main'), f.root);
});

test('push destination is fixed and a lease is always used, never force main', () => {
  const sha = 'a'.repeat(40);
  const args = pushArgs({ head: sha, main: sha, upstream: sha, oldBranch: 'b'.repeat(40), branch: 'main' });
  assert.equal(args.at(-1), `HEAD:refs/heads/${SYNC_BRANCH}`);
  assert.ok(args[1].startsWith(`--force-with-lease=refs/heads/${SYNC_BRANCH}:`));
  assert.throws(() => pushArgs({ head: 'bad' }), /Invalid commit/);
});

test('publication is refused if HEAD changes between prepare and publish', () => {
  let calls = 0;
  assert.throws(() => publishSync({ changed: true, head: 'a'.repeat(40) }, {
    run: () => { calls++; return { stdout: 'b'.repeat(40) }; }
  }), /HEAD changed/);
  assert.equal(calls, 1);
});

test('PR permission failure is explicit after safe branch push', () => {
  const sha = 'a'.repeat(40); const calls = [];
  assert.throws(() => publishSync({ changed: true, head: sha, main: sha, upstream: sha, oldBranch: '', conflicts: [] }, {
    run: (program, args) => {
      calls.push([program, args]);
      if (program === 'git' && args[0] === 'rev-parse') return { stdout: sha };
      if (program === 'gh' && args[1] === 'list') return { stdout: '[]' };
      if (program === 'gh' && args[1] === 'create') throw new Error('not permitted');
      return { stdout: '' };
    }
  }), /Allow GitHub Actions/);
  assert.equal(calls[1][1].at(-1), `HEAD:refs/heads/${SYNC_BRANCH}`);
});
