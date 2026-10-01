# 自用仓库维护约定

## 目录只做必要整理

- `README.md`：自用版入口，不再混合完整上游手册与所有自用细节。
- `SELF_USE_CHANGELOG.md`：当前自用版本功能、修复、上游基线、镜像和部署状态。
- `CHANGELOG.md`：原有历史，保留但不把旧 Unreleased 当作已发布版本。
- `docs/self-use-features.md`：稳定的自用行为和配置说明。
- `docs/configuration.md`：本次同步的上游参考快照；下一次同步要复核与上游 README 的差异，不会自动刷新这份快照。
- `docs/deployment.md`：GHCR 迁移、测试、备份、回滚。
- 业务代码、配置和已有部署入口不随意改名搬目录，避免增加上游合并冲突。

## 分支用途

`main` 用于通过验证的自用代码；`codex/self-use-maintenance` 是本次整理分支，合并后可删除。

以下 6 个分支对应仍开放的上游 PR，必须保留，不能因代码已出现在自用 main 就删除：

| 分支 | 上游 PR | 用途 |
| --- | --- | --- |
| `feat/remote-title-mapping` | #456 | 远程剧名映射 |
| `feat/gradient-color-danmaku` | #461 | 渐变弹幕 |
| `feat/domestic-celebrity-context-filter` | #462 | 当前作品演员/角色语境过滤 |
| `feat/remote-season-mapping` | #463 | 远程季集映射 |
| `feat/auto-match-rule-enhancements` | #464 | 自动匹配规则改进 |
| `fix/auto-match-title-episode-accuracy` | #465 | 剧名/季集准确性 |

2026-10-02 已安全删除以下 6 个远程分支（删除前逐个复核 main 祖先关系、开放 PR 和备份 SHA）：

- `codex/publish-ghcr`
- `dev_new`
- `feat/blocked-words-names-context`
- `feat/blocked-words-region-context`
- `feat/celebrity-context-filter`
- `feat/region-context-filter`

上面 6 个 tip 均已在整理前 main 历史中，不存在开放上游 PR。

暂时保留的历史分支：`feat/blocked-words-enhancement`、`feat/layered-danmaku-matching`（patch 等价不是完整祖先关系，后续核对后再删）；`codex/fix-domestic-filter-context` 有独有提交 `a001b196d9a513a46d32f6f5192361b018c3b0e9`，不能仅凭分支名删除。当前 main 已有相应人名/地区语境测试，但未据此宣称该分支每个修改都冗余。

清理前已保存所有分支完整 SHA 和完整 Git bundle。备份位于本次工作目录的 `outputs/branches-before-cleanup-2026-10-02.txt` 和 `outputs/danmu-api-before-cleanup-2026-10-02.bundle`，不是仓库内文件。请另存到你的备份位置，避免依赖这台电脑。恢复示例：

```bash
git bundle verify /path/to/danmu-api-before-cleanup-2026-10-02.bundle
git fetch /path/to/danmu-api-before-cleanup-2026-10-02.bundle refs/remotes/origin/dev_new:refs/heads/restore/dev-new
```

恢复前用 `git bundle list-heads` 核对实际 ref；只有需要恢复远程分支时再明确推送。

## 自动同步上游

`Fork Sync` 工作流每天 UTC 00:00 / 北京时间 08:00 尝试同步，也可手动运行；定时任务可能延迟，并非准点保证。

1. 从自用 `origin/main` 开始，获取上游 `main`。
2. 上游已在 main 历史中：不创建重复提交/PR。
3. 没有冲突：创建保留双父历史的临时合并，运行 `npm test`，通过后推送到 `sync/upstream-main` 并创建/更新 PR。
4. 有冲突：中止临时合并，在专用分支保存上游快照，PR 写明冲突文件，需要手工解决；不自动选 ours/theirs。
5. 测试失败、网络错误、PR 权限错误：任务失败并给出提示；不更新 main，不部署 NAS。
6. 由你审阅 PR、补充版本说明并合并后，main 的 GHCR 流水线才构建新镜像。

专用分支使用 **force-with-lease** 防止覆盖获取之后发生的远程变化；仅用于 `sync/upstream-main`，绝不 force main。不要在该自动生成分支上长期手工开发；解决冲突请另开工作分支。

### 需要一次性确认的 GitHub 权限

本次读取的仓库设置：`can_approve_pull_request_reviews=false`，自动创建 PR 尚未证实可用。默认使用 `GITHUB_TOKEN` 时，请由仓库管理员在 **Settings → Actions → General → Workflow permissions** 开启 **Allow GitHub Actions to create and approve pull requests**；工作流只创建/更新 PR，不执行自动 approve。

此整理不会静默修改仓库权限或生成 PAT。若组织策略不允许开启，可由你配置 `UPSTREAM_SYNC_TOKEN`（该仓库最小 Contents / Pull requests 写权限），工作流会优先使用它。不要将 token 写入仓库。

默认 GITHUB_TOKEN 创建 PR 不一定触发独立 PR 工作流，因此同步工作流自身会先执行回归测试；PR 中应查看该次 Fork Sync 日志。权限开通后，应手动运行一次验证，才能确认 PR 创建链路实际可用。

## 自用发布流程

1. 每次功能/修复先更新 `SELF_USE_CHANGELOG.md` 的“未发布”，写入口、配置、行为、上游基线、风险和测试证据。
2. 工作分支运行 `npm test`，在 PR 上看 CI；远程来源、管理界面和 NAS 需要对应实测，不能用单元测试替代。
3. 合并到 main 后确认 GHCR 构建成功。记录完整提交和 digest，不假定 latest 已更新。
4. 准备自用发布记录，确定未使用的 `custom-YYYY.MM.DD.N` 标签，将记录提交到 main。
5. 在已确认的目标提交创建并推送标签，例如：

```bash
# 示例：日期与序号需按实际发布确定，不是执行本次发布的命令
git tag -a custom-YYYY.MM.DD.N VERIFIED_COMMIT_SHA -m "自用版：本次功能与修复主题"
git push origin refs/tags/custom-YYYY.MM.DD.N
```

6. 标签触发同名 GHCR 镜像构建；将构建 digest、Actions 记录和 Git 标签实际 SHA 补充到 GitHub Release 或后续文档提交，已有标签不移动。
7. 按部署文档在独立环境测试，通过后手动升级 NAS，再记录部署状态和回滚点。

`Forward` 插件构建目前仍有 Node 内建模块/依赖解析兼容失败；不作为 NAS 发布成功证据，也不在本次维护中擅自大幅改造播放器打包链路。HF 自动同步仍保持原来的显式开关，本次不启用。
