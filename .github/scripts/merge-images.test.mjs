import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { platformSources, mergeImages } from './merge-images.mjs';

const image = 'ghcr.io/xlmc/danmu_api';
const amd64 = 'sha256:' + 'a'.repeat(64);
const arm64 = 'sha256:' + 'b'.repeat(64);
const combined = 'sha256:' + 'c'.repeat(64);

test('merge rejects missing, invalid or duplicate platform digests before docker runs', () => {
  for (const digests of [{ amd64 }, { amd64, arm64: 'sha256:bad' }, { amd64, arm64: amd64 }]) {
    assert.throws(() => mergeImages({ image, version: 'xdanmu-v0.2' }, digests, () => assert.fail('must not run docker')));
  }
  assert.throws(() => platformSources('untrusted:latest', { amd64, arm64 }), /repository/);
  assert.throws(() => mergeImages({ image, version: 'latest' }, { amd64, arm64 }, () => assert.fail('must not run docker')), /version/);
});

test('merge creates only the reserved version from both exact digests, never latest', () => {
  const commands = [];
  const digest = mergeImages({ image, version: 'xdanmu-v0.2' }, { amd64: amd64 + '\n', arm64 }, args => {
    commands.push(args);
    return args.includes('inspect') ? JSON.stringify({ digest: combined }) : '';
  });
  assert.equal(digest, combined);
  assert.deepEqual(commands[0], ['buildx', 'imagetools', 'create', '--tag', image + ':xdanmu-v0.2', image + '@' + amd64, image + '@' + arm64]);
  assert.deepEqual(commands[1], ['buildx', 'imagetools', 'inspect', image + ':xdanmu-v0.2', '--format', '{{json .Manifest}}']);
});

test('merge failure or invalid combined digest cannot supply a promotion digest', () => {
  assert.throws(() => mergeImages({ image, version: 'xdanmu-v0.2' }, { amd64, arm64 }, () => { throw new Error('registry failed'); }), /registry failed/);
  assert.throws(() => mergeImages({ image, version: 'xdanmu-v0.2' }, { amd64, arm64 }, args => args.includes('inspect') ? '{}' : ''), /merged image digest/);
});

test('workflow builds both native architectures, merges only successful builds, and records failures', () => {
  const workflow = fs.readFileSync(new URL('../workflows/docker-image.yml', import.meta.url), 'utf8');
  assert.match(workflow, /arch: amd64\s+runner: ubuntu-24\.04/);
  assert.match(workflow, /arch: arm64\s+runner: ubuntu-24\.04-arm/);
  assert.match(workflow, /fail-fast: false/);
  assert.doesNotMatch(workflow, /setup-qemu-action/);
  assert.match(workflow, /push-by-digest=true/);
  assert.match(workflow, /scope=image-\$\{\{ matrix\.arch \}\}/);
  assert.match(workflow, /needs: \[prepare, build\]/);
  assert.match(workflow, /if: always\(\) && needs\.prepare\.outputs\.version != ''/);
  assert.match(workflow, /needs\.prepare\.result == 'success' && needs\.build\.result == 'success'/);
  assert.match(workflow, /IMAGE_DIGEST: \$\{\{ steps\.merge\.outputs\.digest \}\}/);
  assert.match(workflow, /BUILD_OUTCOME: \$\{\{ needs\.build\.result == 'success' && steps\.merge\.outcome \|\| needs\.build\.result \}\}/);
  for (const smokeWorkflow of [workflow, fs.readFileSync(new URL('../workflows/tests.yml', import.meta.url), 'utf8')]) {
    assert.match(smokeWorkflow, /typeof handleRequest !== 'function'/);
    assert.match(smokeWorkflow, /getAllSourceMetas\(\)\.length !== 10/);
    assert.match(smokeWorkflow, /isRegisteredSource\('dandan'\)/);
    assert.doesNotMatch(smokeWorkflow, /esbuild|transformSync/);
  }
});
