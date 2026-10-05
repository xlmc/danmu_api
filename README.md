# danmu_api · 自用版

基于 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 的自用分支，保留自用配置和匹配规则，通过审核式同步跟进上游。仅维护 **NAS Docker Compose 部署**，镜像由 GitHub Actions 发布至 GHCR，不需要 Docker Hub 账户。

## 功能与文档

保留官方视频平台、韩剧 TV（hanjutv）、人人视频（renren）、规则匹配和缓存，以及配置、日志和缓存管理。已移除其余第三方弹幕源、360、本地弹幕、收藏、推送、接口调试、AI、Upstash 和云部署管理。具体配置以文档为准。

| 内容 | 文档 |
| --- | --- |
| 每个版本的功能、修复、风险 | [自用版本说明](SELF_USE_CHANGELOG.md) |
| 映射、过滤、鉴权、渐变弹幕 | [自用功能说明](docs/self-use-features.md) |
| API、环境变量、弹幕来源 | [配置参考](docs/configuration.md) |
| 旧部署迁移、测试与回滚 | [部署说明](docs/deployment.md) |
| 上游同步、分支与发布流程 | [维护说明](docs/maintenance.md) |
| 历史变更 | [旧更新日志](CHANGELOG.md) |

## 镜像与版本

**代码、镜像、更新说明共用一个自用版本号。NAS 始终使用 `ghcr.io/xlmc/danmu_api:latest`。**

例如（不是已发布版本声明）：

```text
仓库标签：xdanmu-v0.1
镜像标签：ghcr.io/xlmc/danmu_api:xdanmu-v0.1
更新说明：GitHub Releases 中同名版本
NAS 配置：ghcr.io/xlmc/danmu_api:latest（不用跟着改）
```

版本格式是 `xdanmu-v0.N`，从 `xdanmu-v0.1` 开始，后续按 `v0.2、v0.3…` 递增，不使用日期。main 更新后由 Actions 运行测试、构建并检查 `linux/amd64` 和 `linux/arm64` 镜像，成功后更新 latest 并发布同名更新说明。**构建或检查失败不会更新 latest，草稿和预留标签不代表成功发布。**

- **看版本与更新内容**：[GitHub Releases](https://github.com/xlmc/danmu_api/releases)，包含源码提交、变更摘要、镜像 digest 和构建链接。
- **看失败/进行中的构建**：[Actions](https://github.com/xlmc/danmu_api/actions/workflows/docker-image.yml)，摘要与附件保留当次状态。
- **写功能说明**：[自用更新日志](SELF_USE_CHANGELOG.md)，记录功能含义、配置变化、风险；Release 会链接到对应源码版本并带上增量。

上游版本仅说明代码基于哪个上游版本；Actions 运行编号、SHA、digest 是排错信息，不是需要维护的另一套版本号。新流程不再生成额外的 `build-*` 或 `sha-*` 镜像标签，已有历史镜像不删除。源码合并、镜像发布、NAS 升级分别确认；仓库不会自动升级 NAS。

## NAS 首次部署

> **已有部署请跳到下方迁移章节，不要用新模板覆盖原配置。** 以下均为通用示例，不包含真实主机地址、账号或宿主机路径。

1. 在 NAS 选择项目目录，保存 [compose.nas.yml](compose.nas.yml)。模板使用相对此文件的 `./data/config` 和 `./data/.cache`，分别挂载到 `/app/config` 和 `/app/.cache`。
2. 创建上述目录，将 [配置示例](config/.env.example) 保存为 `data/config/.env`。**启动前**设置自己的 `TOKEN` 和独立的 `ADMIN_TOKEN`，不要使用默认令牌，也不要把真实配置提交到 Git。
3. 模板已设置 latest 镜像，不需要 `DANMU_API_IMAGE`。默认宿主端口为 `9321`；需要修改时，可在项目目录创建供 Compose 使用的 `.env`（与 `data/config/.env` 不是同一个文件）：

```dotenv
NAS_HTTP_PORT=9321
```

4. 在该目录执行（需要 Docker Compose v2 和 Docker 管理权限）：

```bash
docker compose -f compose.nas.yml config --quiet
docker compose -f compose.nas.yml pull
docker compose -f compose.nas.yml up -d
docker compose -f compose.nas.yml logs --tail=100
```

用 NAS 图形化项目管理时，导入同一模板并提供上述变量，确认相对挂载目录的实际解析位置。访问 `http://<NAS_IP>:<NAS_HTTP_PORT>/<TOKEN>`，管理操作使用 `ADMIN_TOKEN`。容器默认端口为 `9321`；如设置了 `DANMU_API_PORT`，需相应调整映射。

保持鉴权开启，不要直接将 API 端口暴露到公网。配置、缓存数据和备份应仅保存在自己的设备上。

## 从已有部署迁移

**迁移的最小改动是：原 Compose 只替换 `image`，其余设置保持不变。** 不需要等待上游合并 PR，也不需要迁移至 Docker Hub。

1. 记录旧镜像 ID/digest，保留旧镜像、原 Compose 和环境配置；停止写入后备份配置与全部持久化数据，本地 Redis 等存储另行备份。
2. 拉取本仓库的 latest 镜像，将备份复制到独立测试目录，用独立端口和独立项目名测试。**不得与生产共享可写挂载**，有外置存储也要隔离。
3. 验证鉴权、搜索/匹配、弹幕获取、分片和缓存恢复后，停止测试容器和旧生产容器。
4. 仅将原 Compose 中该服务的 `image` 改为 `ghcr.io/xlmc/danmu_api:latest`，保留原端口、绝对挂载路径、环境变量、网络和重启策略，拉取后在原项目内重建该服务。
5. 检查日志和播放器调用；失败时停止新容器，用旧镜像和升级前的数据备份回滚。

完整操作与回滚要求见 [迁移指南](docs/deployment.md)。仓库上游同步及镜像发布**不会自动更新 NAS**。

## 日常更新

镜像名称始终使用 latest，不必每次修改 Compose。备份后，在原项目目录执行（以下以仓库模板为例）：

```bash
docker compose -f compose.nas.yml pull danmu-api
docker compose -f compose.nas.yml up -d --no-deps danmu-api
docker compose -f compose.nas.yml logs --tail=100 danmu-api
```

只有拉取成功后才继续重建。`pull` 只下载镜像，`up -d` 才应用更新；仅 `restart` 不会换用新镜像。**使用 latest 不等于自动更新容器**，本仓库不额外安装定时更新服务。若旧 Compose 文件名或服务名不同，使用原来的名称和项目参数。

## 开发与维护

```bash
npm install --no-audit --no-fund
npm test
```

上游更新进入同步分支和 PR，审核后才合入 main；功能分支是否可删除需核对独有提交及开放 PR，详见维护说明。自动测试不代表所有远程弹幕源、播放器或 NAS 生产升级已实测。

项目沿用上游代码及许可，用于学习和自用。请勿在公开文档、Issue、日志或版本说明中提交私人地址、路径、令牌与账户配置。
