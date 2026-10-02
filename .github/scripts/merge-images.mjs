import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function platformSources(image, digests) {
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_./-]+$/.test(image)) throw new Error('Invalid image repository');
  const sources = ['amd64', 'arm64'].map(arch => {
    const digest = digests[arch]?.trim();
    if (!DIGEST.test(digest || '')) throw new Error(`Missing or invalid ${arch} digest`);
    return `${image}@${digest}`;
  });
  if (sources[0] === sources[1]) throw new Error('Platform digests must be distinct');
  return sources;
}

export function mergeImages(record, digests, run) {
  if (!/^xdanmu-v0\.[1-9]\d*$/.test(record.version)) throw new Error('Invalid release version');
  const sources = platformSources(record.image, digests);
  const target = `${record.image}:${record.version}`;
  run(['buildx', 'imagetools', 'create', '--tag', target, ...sources]);
  const manifest = JSON.parse(run(['buildx', 'imagetools', 'inspect', target, '--format', '{{json .Manifest}}']));
  if (!DIGEST.test(manifest.digest || '')) throw new Error('Missing merged image digest');
  return manifest.digest;
}

function main() {
  const [releaseDir, digestDir] = process.argv.slice(2);
  if (!releaseDir || !digestDir) throw new Error('Expected release and digest directories');
  const record = JSON.parse(fs.readFileSync(path.join(releaseDir, 'release-record.json'), 'utf8'));
  const digests = Object.fromEntries(['amd64', 'arm64'].map(arch => [
    arch, fs.readFileSync(path.join(digestDir, `${arch}.txt`), 'utf8'),
  ]));
  const digest = mergeImages(record, digests, args => {
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`docker ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
