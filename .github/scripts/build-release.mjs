import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const VERSION = /^custom-\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/;
const MARKER = '<!-- danmu-self-use-release -->';
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function command(program, args, { cwd = process.cwd(), input, allowFailure = false } = {}) {
  const result = spawnSync(program, args, { cwd, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${program} ${args[0]} failed: ${result.stderr}`);
  return result;
}
function api(endpoint, method = 'GET', data) {
  const args = ['api', endpoint, '--method', method];
  if (data) args.push('--input', '-');
  return JSON.parse(command('gh', args, { input: data ? JSON.stringify(data) : undefined }).stdout);
}
function list(endpoint) {
  return JSON.parse(command('gh', ['api', '--paginate', '--slurp', endpoint]).stdout).flat();
}

export function nextVersion(tags, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  const prefix = `custom-${get('year')}.${get('month')}.${get('day')}.`;
  const numbers = tags.filter(t => VERSION.test(t) && t.startsWith(prefix)).map(t => Number(t.slice(prefix.length)));
  const next = Math.max(0, ...numbers) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Version counter overflow');
  return `${prefix}${next}`;
}

export function collectChanges({ cwd = process.cwd(), sha, releases = [] }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected full source SHA');
  const git = (...args) => command('git', args, { cwd }).stdout.trim();
  let previous;
  for (const release of [...releases].sort((a, b) => b.id - a.id)) {
    if (release.draft || release.prerelease || !VERSION.test(release.tag_name) || !release.body?.includes(MARKER)) continue;
    const resolved = command('git', ['rev-parse', '--verify', `${release.tag_name}^{commit}`], { cwd, allowFailure: true });
    if (resolved.status !== 0) continue;
    const previousSha = resolved.stdout.trim();
    const ancestor = command('git', ['merge-base', '--is-ancestor', previousSha, sha], { cwd, allowFailure: true });
    if (ancestor.status > 1) throw new Error('Cannot check release ancestry');
    if (ancestor.status === 0) { previous = { tag: release.tag_name, sha: previousSha }; break; }
  }
  const range = previous ? `${previous.sha}..${sha}` : sha;
  const source = git('show', `${sha}:danmu_api/configs/globals.js`);
  return {
    previous,
    upstreamVersion: source.match(/VERSION:\s*['"]([^'"]+)['"]/)?.[1] || '未识别',
    commits: git('log', previous ? '-80' : '-1', '--format=%h %s', range),
    files: previous ? git('diff', '--stat', range) : '',
    changelogDelta: previous ? git('diff', '--unified=2', range, '--', 'SELF_USE_CHANGELOG.md') : '',
  };
}

export function renderNotes(record) {
  const base = `https://github.com/${record.repository}`;
  const block = (text, language = 'text') => {
    const clipped = text.length > 16000 ? `${text.slice(0, 16000)}\n[已截断，请查看完整比较链接]` : text;
    const fence = '`'.repeat(Math.max(3, ...(clipped.match(/`+/g) || []).map(s => s.length + 1)));
    return `${fence}${language}\n${clipped}\n${fence}`;
  };
  return `${MARKER}
# 自用版 ${record.version}

- 镜像状态：${record.imageVerified ? '已构建并检查双架构清单' : '尚未确认构建成功'}
- latest：${record.latestUpdated ? '本次发布时已更新到此版本；以后会随新版本变化' : '本次尚未确认更新'}
- NAS：未部署 / 未验收；本流程不连接 NAS。
- 上游代码版本：\`${record.upstreamVersion}\`（不是自用版编号）
- 源码：[${record.sha}](${base}/commit/${record.sha})
- Git 标签与镜像版本统一为：\`${record.version}\`
- 镜像：\`${record.image}:${record.version}\`
- Digest：${record.digest ? `\`${record.image}@${record.digest}\`` : '尚未取得'}
- 平台：linux/amd64、linux/arm64（以镜像状态为准）
- 日常部署保持：\`${record.image}:latest\`
- [Actions 构建记录](${record.runUrl})；运行/重试编号仅用于排错，不是另一套版本号。
- 构建结果：${record.buildOutcome || 'pending'}；清单检查：${record.verifyOutcome || 'pending'}。

## 本次更新内容

${record.previous ? `相对上次成功发布 \`${record.previous.tag}\`。\n[查看完整变更](${base}/compare/${record.previous.sha}...${record.sha})` : '首次自动记录：没有已确认的自动发布基线，仅列当前提交；完整功能见下方自用更新日志，不将整个上游历史当成本次新增。'}

${block(record.commits || '源码没有新增提交：同一源码重新构建，基础镜像、依赖或镜像 digest 仍可能改变。')}

最多展示 80 条提交；功能含义、配置变化和风险见[本版本自用更新日志](${base}/blob/${record.sha}/SELF_USE_CHANGELOG.md)。自动摘要不替代人工功能说明。

## 变更文件

${block(record.files || (record.previous ? '无源码文件变化。' : '首次记录无增量统计。'))}

## 人工更新说明的变化

${block(record.changelogDelta || '无可用增量，请阅读上方固定到本版本源码的自用更新日志。', 'diff')}
`;
}

export function prepare({ env = process.env, now = new Date(), cwd = process.cwd(), request = api, releases, tags } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || env.GITHUB_REF !== 'refs/heads/main') throw new Error('Only main may publish');
  const sha = command('git', ['rev-parse', 'HEAD'], { cwd }).stdout.trim();
  if (sha !== env.GITHUB_SHA) throw new Error('Checkout differs from workflow source');
  if (request(`repos/${repository}/git/ref/heads/main`).object.sha !== sha) throw new Error('This main run is superseded; do not publish old code as latest');
  releases ??= list(`repos/${repository}/releases?per_page=100`);
  tags ??= list(`repos/${repository}/git/matching-refs/tags/custom-`).map(t => t.ref.slice('refs/tags/'.length));
  const version = nextVersion([...tags, ...releases.map(r => r.tag_name)], now);
  const record = {
    version, repository, sha, image: `ghcr.io/${repository.toLowerCase()}`,
    createdAt: now.toISOString(),
    runUrl: `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    ...collectChanges({ cwd, sha, releases }),
  };
  // Reserve an immutable source identity before pushing an image. Failed attempts may leave gaps.
  request(`repos/${repository}/git/refs`, 'POST', { ref: `refs/tags/${version}`, sha });
  const release = request(`repos/${repository}/releases`, 'POST', {
    tag_name: version, target_commitish: sha, name: version, body: renderNotes(record), draft: true,
  });
  return { ...record, releaseId: release.id };
}

export function verifyPlatforms(manifest) {
  const platforms = new Set((manifest.manifests || []).map(m => `${m.platform?.os}/${m.platform?.architecture}`));
  if (!platforms.has('linux/amd64') || !platforms.has('linux/arm64')) throw new Error('Published image lacks amd64 or arm64');
}

export function publish(record, { request = api, promote, verifyLatest, save = () => {} } = {}) {
  if (record.buildOutcome !== 'success' || record.verifyOutcome !== 'success' || !DIGEST.test(record.digest || '')) return false;
  record.imageVerified = true;
  save(record);
  const endpoint = `repos/${record.repository}/releases/${record.releaseId}`;
  // Save the verified digest before promotion, so a metadata failure can be recovered without rebuilding.
  request(endpoint, 'PATCH', { body: renderNotes(record) });
  if (request(`repos/${record.repository}/git/ref/heads/main`).object.sha !== record.sha) {
    throw new Error('main advanced during the build; keep the old latest and this release draft');
  }
  promote(record);
  verifyLatest(record);
  record.latestUpdated = true;
  save(record);
  request(endpoint, 'PATCH', { draft: false, make_latest: 'true', body: renderNotes(record) });
  record.releaseRecorded = true;
  save(record);
  return true;
}

function main() {
  const [mode, directory] = process.argv.slice(2);
  if (!directory) throw new Error('Expected record directory');
  fs.mkdirSync(directory, { recursive: true });
  const recordPath = path.join(directory, 'release-record.json');
  const save = record => {
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'release-notes.md'), renderNotes(record));
  };
  if (mode === 'prepare') {
    const record = prepare();
    save(record);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${record.version}\nimage=${record.image}\n`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 自用版本：${record.version}\n\n已预留源码标签，尚未发布。失败不会更新 latest；最终状态见本次运行结果。\n`);
  } else if (mode === 'verify') {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (!DIGEST.test(process.env.IMAGE_DIGEST || '')) throw new Error('Missing or invalid image digest');
    const manifest = JSON.parse(command('docker', ['buildx', 'imagetools', 'inspect', '--raw', `${record.image}@${process.env.IMAGE_DIGEST}`]).stdout);
    verifyPlatforms(manifest);
  } else if (mode === 'finish') {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    Object.assign(record, { buildOutcome: process.env.BUILD_OUTCOME, verifyOutcome: process.env.JOB_STATUS === 'cancelled' ? 'cancelled' : process.env.VERIFY_OUTCOME, digest: process.env.IMAGE_DIGEST || '' });
    save(record);
    try {
      publish(record, {
        save,
        promote: r => command('docker', ['buildx', 'imagetools', 'create', '--tag', `${r.image}:latest`, `${r.image}@${r.digest}`]),
        verifyLatest: r => {
          const inspection = command('docker', ['buildx', 'imagetools', 'inspect', `${r.image}:latest`]).stdout;
          if (inspection.match(/^Digest:\s+(sha256:[a-f0-9]{64})\s*$/m)?.[1] !== r.digest) throw new Error('latest digest does not match this release');
        },
      });
    } finally {
      save(record);
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${renderNotes(record)}\n\nRelease 记录状态：${record.releaseRecorded ? '已发布' : '未发布；检查本次日志，草稿不代表成功'}。\n`);
    }
  } else throw new Error('Expected prepare, verify or finish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
