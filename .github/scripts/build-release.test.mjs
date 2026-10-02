import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nextVersion, collectChanges, prepare, publish, renderNotes, verifyPlatforms } from './build-release.mjs';

const marker = '<!-- danmu-self-use-release -->';
const digest = `sha256:${'d'.repeat(64)}`;
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'danmu-release-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(cwd)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cwd).startsWith('danmu-release-'));
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
  git('init', '--initial-branch=main'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.email', 'tests@example.invalid'); git('config', 'user.name', 'Release Tests');
  fs.mkdirSync(path.join(cwd, 'danmu_api/configs'), { recursive: true });
  const root = commit('danmu_api/configs/globals.js', "export default { VERSION: '1.21.3' };\n", 'base');
  return { cwd, git, commit, root };
}
function successfulRecord() {
  return { version: 'custom-2026.10.02.1', repository: 'owner/repo', sha: 'a'.repeat(40), image: 'ghcr.io/owner/repo', releaseId: 42,
    buildOutcome: 'success', verifyOutcome: 'success', digest, runUrl: 'https://github.com/owner/repo/actions/runs/1', upstreamVersion: '1.21.3' };
}

test('one CalVer identifier uses Beijing date and daily numeric counter', () => {
  const date = new Date('2026-10-01T16:01:00Z');
  assert.equal(nextVersion([], date), 'custom-2026.10.02.1');
  assert.equal(nextVersion(['custom-2026.10.02.2', 'custom-2026.10.02.10', 'custom-2026.10.01.99', 'build-2026.10.02.50.1', 'custom-2026.10.02.bad'], date), 'custom-2026.10.02.11');
  assert.equal(nextVersion(['custom-2026.10.02.1'], new Date('2026-10-02T16:01:00Z')), 'custom-2026.10.03.1');
});

test('first publication has no invented baseline', t => {
  const f = fixture(t);
  const result = collectChanges({ ...f, sha: f.root });
  assert.equal(result.previous, undefined);
  assert.equal(result.upstreamVersion, '1.21.3');
  assert.equal(result.files, '');
  assert.match(result.commits, /base/);
});

test('comparison skips failed drafts and unrelated releases, includes all intervening commits', t => {
  const f = fixture(t);
  f.git('tag', 'custom-2026.10.02.1');
  f.commit('SELF_USE_CHANGELOG.md', '新增映射规则\n', 'add mapping');
  f.git('tag', 'custom-2026.10.02.2');
  const sha = f.commit('fix.txt', 'fix\n', 'fix source');
  const releases = [
    { id: 1, tag_name: 'custom-2026.10.02.1', body: marker },
    { id: 2, tag_name: 'custom-2026.10.02.2', body: marker, draft: true },
    { id: 3, tag_name: 'custom-2026.10.02.2', body: 'not an automated release' },
  ];
  const result = collectChanges({ ...f, sha, releases });
  assert.equal(result.previous.sha, f.root);
  assert.match(result.commits, /add mapping/); assert.match(result.commits, /fix source/);
  assert.match(result.changelogDelta, /新增映射规则/);
  assert.match(result.files, /fix.txt/);
  assert.equal(collectChanges({ ...f, sha: f.root, releases }).commits, '');
});

test('a newer release on a different branch cannot be the baseline', t => {
  const f = fixture(t);
  f.git('tag', 'custom-2026.10.02.1');
  f.git('checkout', '-b', 'other');
  f.commit('other.txt', 'other', 'other branch');
  f.git('tag', 'custom-2026.10.02.2');
  f.git('checkout', 'main');
  const sha = f.commit('main.txt', 'main', 'main branch');
  const releases = [1, 2].map(id => ({ id, tag_name: `custom-2026.10.02.${id}`, body: marker }));
  assert.equal(collectChanges({ ...f, sha, releases }).previous.sha, f.root);
});

test('prepare reserves matching source tag and draft, including previously failed numbers', t => {
  const f = fixture(t);
  const calls = [];
  const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: f.root, GITHUB_RUN_ID: '7', GITHUB_RUN_ATTEMPT: '2' };
  const options = { ...f, env, now: new Date('2026-10-02T01:00:00Z'), tags: ['custom-2026.10.02.1'], releases: [{ tag_name: 'custom-2026.10.02.2', draft: true }], request: (endpoint, method, data) => {
    calls.push({ endpoint, method, data });
    return method === 'POST' ? { id: 12 } : { object: { sha: f.root } };
  } };
  const record = prepare(options);
  assert.equal(record.version, 'custom-2026.10.02.3');
  assert.deepEqual(calls[1].data, { ref: 'refs/tags/custom-2026.10.02.3', sha: f.root });
  assert.equal(calls[2].data.tag_name, record.version);
  assert.equal(calls[2].data.target_commitish, f.root);
  assert.equal(calls[2].data.draft, true);
  assert.equal(record.releaseId, 12);
  assert.throws(() => prepare({ ...options, env: { ...env, GITHUB_REF: 'refs/tags/custom-2026.10.02.3' } }), /Only main/);
  assert.throws(() => prepare({ ...options, request: () => ({ object: { sha: 'b'.repeat(40) } }) }), /superseded/);
});

for (const outcome of ['failure', 'cancelled', 'skipped', 'pending']) {
  test(`${outcome} build or verification never promotes latest or publishes a Release`, () => {
    const deps = { request: () => assert.fail('API must not be called'), promote: () => assert.fail('must not promote') };
    assert.equal(publish({ ...successfulRecord(), buildOutcome: outcome }, deps), false);
    assert.equal(publish({ ...successfulRecord(), verifyOutcome: outcome }, deps), false);
  });
}

test('missing or malformed digest cannot be published', () => {
  for (const value of ['', 'sha256:123', 'untrusted']) {
    assert.equal(publish({ ...successfulRecord(), digest: value }, { request: () => assert.fail('must not publish') }), false);
  }
});

test('verify requires both Linux architectures, ignores attestations', () => {
  const platform = architecture => ({ platform: { os: 'linux', architecture } });
  assert.throws(() => verifyPlatforms({ manifests: [platform('amd64')] }), /lacks/);
  verifyPlatforms({ manifests: [platform('amd64'), platform('arm64'), { platform: { os: 'unknown', architecture: 'unknown' } }] });
});

test('successful publish records digest then promotes, verifies latest, and publishes same version', () => {
  const r = successfulRecord();
  const events = [];
  publish(r, {
    request: (endpoint, method, body) => { events.push(method || 'GET'); return method ? {} : { object: { sha: r.sha } }; },
    promote: v => { assert.equal(v.version, r.version); events.push('promote'); },
    verifyLatest: () => events.push('verify'),
  });
  assert.deepEqual(events, ['PATCH', 'GET', 'promote', 'verify', 'PATCH']);
  assert.equal(r.latestUpdated, true); assert.equal(r.releaseRecorded, true);
});

test('advanced main or failed draft update leaves latest untouched', () => {
  for (const mode of ['main', 'permission']) {
    const r = successfulRecord();
    assert.throws(() => publish(r, {
      request: (endpoint, method) => { if (mode === 'permission') throw new Error('permission denied'); return method ? {} : { object: { sha: 'b'.repeat(40) } }; },
      promote: () => assert.fail('do not publish stale image'),
    }), mode === 'main' ? /main advanced/ : /permission denied/);
    assert.equal(r.latestUpdated, undefined); assert.equal(r.releaseRecorded, undefined);
  }
});

test('Release API failure after promotion keeps truthful recovery evidence', () => {
  const r = successfulRecord();
  assert.throws(() => publish(r, {
    request: (endpoint, method, body) => { if (body?.draft === false) throw new Error('release API failed'); return method ? {} : { object: { sha: r.sha } }; },
    promote: () => {}, verifyLatest: () => {},
  }), /release API failed/);
  assert.equal(r.latestUpdated, true); assert.equal(r.imageVerified, true); assert.equal(r.releaseRecorded, undefined);
});

test('notes distinguish upstream version, NAS status, exact source, digest and source changelog', () => {
  const r = { ...successfulRecord(), commits: 'abc ``` injected title', imageVerified: true };
  const notes = renderNotes(r);
  assert.match(notes, /custom-2026\.10\.02\.1/);
  assert.match(notes, /不是自用版编号/); assert.match(notes, /NAS：未部署/);
  assert.match(notes, new RegExp(`/blob/${r.sha}/SELF_USE_CHANGELOG.md`));
  assert.match(notes, /````text/); assert.doesNotMatch(notes, /build-2026/);
});

test('workflow gates latest separately, uses one version and avoids tag-triggered duplicate builds', () => {
  const root = new URL('../../', import.meta.url);
  const workflow = fs.readFileSync(new URL('.github/workflows/docker-image.yml', root), 'utf8');
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /group: ghcr-publish-main/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /flavor: latest=false/);
  assert.doesNotMatch(workflow, /type=sha|type=ref|value=latest|build-\d|tags:\s*\n\s+- 'custom-/);
  assert.match(workflow, /org.opencontainers.image.version=\$\{\{ steps.release.outputs.version \}\}/);
  assert.match(workflow, /JOB_STATUS: \$\{\{ job\.status \}\}/);
  assert.match(workflow, /retention-days: 90/);
});
