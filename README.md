# danmu_api · 自用版

这是 [xlmc/danmu_api](https://github.com/xlmc/danmu_api) 的个人自用分支，基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api)。保留自己的配置和匹配规则，同时通过审核式同步跟进上游。

## 从哪里看

| 需要了解 | 文档 |
| --- | --- |
| 每次版本有哪些功能、修复、升级风险 | [自用版本说明](SELF_USE_CHANGELOG.md) |
| 自用映射、过滤、鉴权、渐变弹幕等调整 | [自用功能说明](docs/self-use-features.md) |
| 上游 API、环境变量及各平台部署参考 | [上游配置参考](docs/configuration.md) |
| 使用 GHCR 镜像迁移、备份和回滚 | [部署说明](docs/deployment.md) |
| 分支用途、自动同步和版本发布步骤 | [维护说明](docs/maintenance.md) |
| 整理前的历史变更 | [旧更新日志](CHANGELOG.md) |

## 版本怎么区分

- **上游版本**：代码中的 `Globals.VERSION`，本次整理基线为 `1.21.3`；不能据此判断有哪些自用功能。
- **自用版本**：采用 `custom-YYYY.MM.DD.N` 标签，例如 `custom-2026.10.02.1`（仅格式示例，并非已发布标签）。标签、说明、源码与镜像相互对应。
- **精确镜像版本**：`ghcr.io/xlmc/danmu_api:sha-<完整提交 SHA>`，需要更严格固定时使用镜像 digest。
- **当前状态**：本次整理写在版本说明的“未发布”区；未发布不等于已经部署到 NAS。

## Docker / NAS

镜像由本仓库 GitHub Actions 构建到 `ghcr.io/xlmc/danmu_api`，不需要 Docker Hub 账户。`main` 构建成功才会更新 `latest`，`custom-*` 标签构建发布同名镜像；生产建议固定经过验证的版本，不直接追踪 `latest`。

迁移只需替换镜像来源，保留原来的端口和数据挂载；必须先备份并在独立端口、独立数据副本上测试，详见 [部署说明](docs/deployment.md)。本次仓库整理不自动修改 NAS。

## 本地验证

```bash
npm install --no-audit --no-fund
npm test
```

测试覆盖自用匹配瀑布、过滤、鉴权以及上游本地弹幕等逻辑，不代表所有第三方来源、播放器或部署平台已实测。

项目沿用上游代码及许可，主要用于个人学习和自用；上游资料中提及的官方镜像、社区和发布方式不代表本 fork 的发布状态。
