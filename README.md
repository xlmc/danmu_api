# danmu_api · 自用版

这是 [xlmc/danmu_api](https://github.com/xlmc/danmu_api) 的个人自用分支，基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api)。保留自己的配置和匹配规则，同时通过审核式同步跟进上游。

## 从哪里看

| 需要了解 | 文档 |
| --- | --- |
| 每次版本有哪些功能、修复、升级风险 | [自用版本说明](SELF_USE_CHANGELOG.md) |
| 自用映射、过滤、鉴权、渐变弹幕等调整 | [自用功能说明](docs/self-use-features.md) |
| API、环境变量与来源说明 | [配置参考](docs/configuration.md) |
| 使用 GHCR 镜像迁移、备份和回滚 | [部署说明](docs/deployment.md) |
| 分支用途、自动同步和版本发布步骤 | [维护说明](docs/maintenance.md) |
| 整理前的历史变更 | [旧更新日志](CHANGELOG.md) |

## 版本怎么区分

- **上游版本**：代码中的 `Globals.VERSION`，本次整理基线为 `1.21.3`；不能据此判断有哪些自用功能。
- **自用版本**：采用 `custom-YYYY.MM.DD.N` 标签，例如 `custom-2026.10.02.1`（仅格式示例，并非已发布标签）。标签、说明、源码与镜像相互对应。
- **精确镜像版本**：`ghcr.io/xlmc/danmu_api:sha-<完整提交 SHA>`，需要更严格固定时使用镜像 digest。
- **当前状态**：本次整理写在版本说明的“未发布”区；未发布不等于已经部署到 NAS。

## NAS 部署（唯一维护方式）

本自用版只维护 **NAS 上的 Docker Compose 部署**。镜像由本仓库 GitHub Actions 构建并发布到 `ghcr.io/xlmc/danmu_api`，不需要 Docker Hub 账户。已移除云平台一键部署配置与 HF 同步工作流，不再提供其他部署教程。

### 路径和配置

| 项目 | 当前 NAS 约定 |
| --- | --- |
| 共享目录 | `\\192.168.31.9\docker\logvar` |
| NAS 目录 | `/volume1/docker/logvar` |
| API 端口 | `29321:9321` |
| 配置挂载 | `data/config` → `/app/config` |
| 缓存、收藏、本地弹幕挂载 | `data/.cache` → `/app/.cache` |

使用仓库中的 [compose.nas.yml](compose.nas.yml)。容器内端口保持 `9321`；如果旧配置自定义了 `DANMU_API_PORT`，需要先核对端口映射。

- **首次部署**：创建上述数据目录，把 [配置示例](config/.env.example) 复制为 `data/config/.env`，设置自己的 `TOKEN` 和独立的 `ADMIN_TOKEN`。不要使用默认令牌，不要将含令牌的配置提交到 Git。
- **从现有容器迁移**：保留原来的 `data/config/.env` 和数据，**不要用配置示例覆盖**。先备份并用独立目录、端口 `29322` 测试，通过后才停止旧容器并替换生产容器。完整步骤见 [迁移与回滚](docs/deployment.md)。
- 保持鉴权开启；不要把 API 端口直接暴露到公网。

### 启动与升级

先把 `compose.nas.yml` 保存到 NAS 的 `/volume1/docker/logvar`，从该版本 Actions 的成功构建摘要选择实际存在的完整 SHA 镜像或 digest。以下占位符必须替换，不能直接当作已发布镜像：

```bash
cd /volume1/docker/logvar
export DANMU_API_IMAGE='ghcr.io/xlmc/danmu_api:sha-替换为已构建成功的完整提交SHA'
sudo -E docker compose -f compose.nas.yml config --quiet
sudo -E docker compose -f compose.nas.yml pull
sudo -E docker compose -f compose.nas.yml up -d
sudo -E docker compose -f compose.nas.yml logs --tail=100
```

命令假定 NAS 已安装 Docker Compose v2，且你有相应管理权限。使用 NAS 图形化项目管理时，导入同一 Compose 文件并设置 `DANMU_API_IMAGE` 变量，也可把 `image` 行替换为经过验证的固定镜像。

访问 `http://192.168.31.9:29321/你的TOKEN`；系统管理使用自己的 `ADMIN_TOKEN`。每次升级前记录当前镜像和数据备份，升级后记录验证结果与实际 digest。

`main` 镜像构建成功后才更新浮动标签 `latest`，`custom-*` 发布标签构建同名镜像。生产固定经过验证的 SHA/custom 标签或 digest，**不自动追踪 latest，不自动更新 NAS**。

## 分支是否可以删除

NAS 只使用 `main` 发布的镜像，不依赖任何功能分支。但分支是否能删，还要检查是否用于上游 PR：

- **保留 `main`**：自用代码、版本说明和 GHCR 发布入口。
- **保留 6 个上游 PR 分支**：对应 #456、#461、#462、#463、#464、#465，仍在等待上游处理，不为精简列表而影响投稿。
- **本次清理 2 个历史分支**：`feat/blocked-words-enhancement`、`feat/layered-danmaku-matching`，已核对提交补丁及合并文件树等价，删除前保存完整 Git bundle。
- **暂留 `codex/fix-domestic-filter-context`**：还有独有历史提交，不把“当前有相似功能”当成“可以安全删除”的证明。
- 临时工作分支在合并后删除；`sync/upstream-main` 仅在上游有待同步内容时使用，不是部署分支。

具体用途与恢复方法见 [分支维护说明](docs/maintenance.md)。

## 本地验证

```bash
npm install --no-audit --no-fund
npm test
```

测试覆盖自用匹配瀑布、过滤、鉴权以及上游本地弹幕等逻辑，不代表所有第三方来源、播放器或 NAS 生产升级已实测。

项目沿用上游代码及许可，主要用于个人学习和自用；上游历史更新日志仅用于追溯，不作为本 fork 的部署指引。
