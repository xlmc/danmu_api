import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SYNC_BRANCH = 'sync/upstream-main';
const UPSTREAM_REF = 'refs/remotes/upstream/main';
const MAIN_REF = 'refs/remotes/origin/main';

function command(program, args, { cwd = process.cwd(), env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    // 不输出调用环境或认证 header。
    throw new Error(`${program} ${args[0]} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

export function prepareSync({ cwd = process.cwd() } = {}) {
  const git = (...args) => command('git', args, { cwd }).stdout.trim();
  const main = git('rev-parse', MAIN_REF);
  const upstream = git('rev-parse', UPSTREAM_REF);
  if (git('status', '--porcelain')) throw new Error('Sync requires a clean checkout');
  if (git('rev-parse', 'HEAD') !== main) throw new Error('Checkout must start at origin/main');
  const ancestor = command('git', ['merge-base', '--is-ancestor', upstream, main], { cwd, allowFailure: true });
  if (ancestor.status === 0) return { changed: false, main, upstream };
  if (ancestor.status !== 1) throw new Error('Unable to compare upstream ancestry');
  const oldBranch = command('git', ['rev-parse', '--verify', `refs/remotes/origin/${SYNC_BRANCH}`], { cwd, allowFailure: true });
  const merge = command('git', ['merge', '--no-ff', '-Xignore-space-at-eol', '--no-edit', UPSTREAM_REF], { cwd, allowFailure: true });
  let conflicts = [];
  if (merge.status !== 0) {
    conflicts = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    if (!conflicts.length) throw new Error(`Merge failed without file conflicts: ${merge.stderr || merge.stdout}`);
    git('merge', '--abort');
    // 冲突时只提交上游快照供 PR 显示冲突；绝不写 main 或选 ours/theirs 掩盖冲突。
    git('checkout', '--detach', upstream);
  }
  return { changed: true, main, upstream, conflicts, head: git('rev-parse', 'HEAD'), oldBranch: oldBranch.status === 0 ? oldBranch.stdout.trim() : '' };
}

export function pushArgs(state) {
  if (![state.head, state.main, state.upstream].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Invalid commit identity');
  if (state.oldBranch && !/^[a-f0-9]{40}$/.test(state.oldBranch)) throw new Error('Invalid branch lease');
  return ['push', `--force-with-lease=refs/heads/${SYNC_BRANCH}:${state.oldBranch || ''}`, 'origin', `HEAD:refs/heads/${SYNC_BRANCH}`];
}

export function publishSync(state, { cwd = process.cwd(), repository = 'xlmc/danmu_api', env = process.env, run = command } = {}) {
  if (!state.changed) return;
  if (repository !== 'xlmc/danmu_api') throw new Error('This self-use sync is restricted to xlmc/danmu_api');
  const opts = { cwd, env };
  const actualHead = run('git', ['rev-parse', 'HEAD'], opts).stdout.trim();
  if (actualHead !== state.head) throw new Error('HEAD changed after preparation; refusing to publish');
  run('git', pushArgs(state), opts);
  const body = `自动同步上游 huangxd-/danmu_api。\n\n- 上游基线：\`${state.upstream}\`\n- 自用 main 基线：\`${state.main}\`\n- ${state.conflicts.length ? `存在冲突：${state.conflicts.join(', ')}。未覆盖个人代码，需要手工合并和回归测试。` : '临时合并成功；本次同步工作流中 npm test 已通过。'}\n\n仅更新专用同步分支，不自动合并 main、不自动部署 NAS。合并前补充 SELF_USE_CHANGELOG.md。\n\nGITHUB_TOKEN 创建 PR 可能不触发独立 PR 工作流；本次同步任务自身的测试日志才是相应验证依据。`;
  const prs = JSON.parse(run('gh', ['pr', 'list', '--repo', repository, '--base', 'main', '--head', SYNC_BRANCH, '--state', 'open', '--json', 'number'], opts).stdout);
  try {
    if (prs.length) run('gh', ['pr', 'edit', String(prs[0].number), '--repo', repository, '--body', body], opts);
    else run('gh', ['pr', 'create', '--repo', repository, '--base', 'main', '--head', SYNC_BRANCH, '--title', 'chore: sync upstream changes', '--body', body, ...(state.conflicts.length ? ['--draft'] : [])], opts);
  } catch (error) {
    throw new Error(`同步分支已保存，PR 创建/更新失败。请检查 Settings > Actions > General 的 Allow GitHub Actions to create and approve pull requests；或配置有最小 contents/pull_requests 写权限的 UPSTREAM_SYNC_TOKEN。${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [phase, stateFile] = process.argv.slice(2);
    if (!stateFile) throw new Error('Missing state file');
    if (phase === 'prepare') {
      const state = prepareSync();
      fs.writeFileSync(stateFile, JSON.stringify(state));
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${state.changed}\nconflicts=${Boolean(state.conflicts?.length)}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Upstream sync\n\nMain: \`${state.main}\`\n\nUpstream: \`${state.upstream}\`\n\n${!state.changed ? 'Already up to date.' : state.conflicts.length ? `Conflicts: ${state.conflicts.join(', ')}` : 'Clean merge prepared; tests must pass before publication.'}\n`);
    } else if (phase === 'publish') {
      if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
      // 认证仅存在于发布子进程环境，不持久化 token 到 Git 配置/文件。
      const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString('base64')}` };
      publishSync(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { env, repository: process.env.GITHUB_REPOSITORY });
    } else throw new Error('Expected prepare or publish');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
