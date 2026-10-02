# NAS 自用版部署、迁移与回滚

本仓库仅维护 NAS Docker Compose 部署，统一使用根目录的 [compose.nas.yml](../compose.nas.yml)。首次部署和启动命令见 [README](../README.md#nas-部署唯一维护方式)；本文补充已有 NAS 的迁移、独立测试和回滚步骤。

## 镜像来源

- 仓库：`ghcr.io/xlmc/danmu_api`，由本仓库 GitHub Actions 构建，无需 Docker Hub 信息。
- `latest`：仅 `main` 构建成功后更新，是浮动标签，不建议生产无审核自动拉取。
- `custom-YYYY.MM.DD.N`：发布标签对应的镜像，先核对 [版本说明](../SELF_USE_CHANGELOG.md)。
- `sha-<完整提交 SHA>`：精确源码身份；最严格固定方式是 `ghcr.io/xlmc/danmu_api@sha256:<digest>`。
- 镜像标签存在不等于 NAS 已更新；必须查看该次 Actions 的成功状态和 Published GHCR image 摘要，核对 `linux/amd64`、`linux/arm64`。

新镜像未构建成功时不要把示例标签直接放入生产。若匿名拉取失败，检查 GHCR 包可见性或使用有 `read:packages` 权限的凭据登录，切勿把 token 写入 compose/仓库。

## 当前 NAS（本次未修改）

共享目录：`\\192.168.31.9\docker\logvar`；NAS 实际路径：`/volume1/docker/logvar`。

既有生产镜像是 `logvar/danmu-api:latest`（仅为迁移前的历史记录，不是本仓库发布镜像）。原端口 `29321:9321`，原挂载如下，升级时保持不变：

- `/volume1/docker/logvar/data/config:/app/config`
- `/volume1/docker/logvar/data/.cache:/app/.cache`

不要把新模板直接作为第二个生产项目启动：两个容器不能同时写这些目录。保留旧 Compose 中已有的环境变量、网络或其他自定义设置；新模板是最小配置，不覆盖旧配置。

## 迁移顺序

1. 记录旧容器的实际镜像 ID/digest 和 compose；旧 `latest` 也会漂移，不能只记录这个字符串。
2. 停止写入后备份 `data/config`、`data/.cache` 以及原 compose；备份放在独立目录。存在 Redis 等外置持久化时另行备份。
3. 准备已经构建成功的 GHCR SHA/custom 标签，把旧数据**复制**到独立测试目录。
4. 用独立容器名、端口 `29322` 和独立数据副本测试；不要让两个容器共享生产可写目录。
5. 测试管理端登录/鉴权、已知剧名和季集规则、弹幕获取、收藏、过滤及本地弹幕上传；记录异常与版本。
6. 验收后停止旧容器，仅替换生产 compose 中的 `image` 行（使用本仓库模板时设置 `DANMU_API_IMAGE`），保留 `29321:9321` 和原挂载路径；拉取后重建容器。
7. 将实际部署标签、digest、日期及结果补充到版本说明或 GitHub Release。

测试 compose 示例（先替换占位镜像；测试数据需预先准备）：

```yaml
services:
  danmu-api-self-use-test:
    image: ghcr.io/xlmc/danmu_api:sha-REPLACE_WITH_VERIFIED_FULL_COMMIT_SHA
    ports:
      - "29322:9321"
    volumes:
      - /volume1/docker/logvar/test-self-use/config:/app/config
      - /volume1/docker/logvar/test-self-use/.cache:/app/.cache
    restart: unless-stopped
```

在 NAS 上使用 Docker Compose CLI 的命令示例：

```bash
# 指定你实际保存的独立测试 compose 文件
sudo docker compose -f compose.self-use-test.yml pull
sudo docker compose -f compose.self-use-test.yml up -d
sudo docker compose -f compose.self-use-test.yml logs --tail=100
```

这里不默认提供/执行 SSH 登录，不自动替换生产 compose，也不安装自动拉取部署服务。

## 回滚

- 停止新容器，用记录下来的旧镜像 ID/digest 或已保留的旧版本重建。
- 若新版本写入了不兼容数据，恢复升级前 config/cache 快照，再启动旧镜像；不能只换镜像而忽略数据。
- 测试失败时直接停止独立测试容器，生产容器及生产数据不应受到影响。
- 保留备份和镜像，直到生产验收完成；不能先清理旧镜像再验证回滚。

TOKEN 默认保留，`TOKEN_AUTH_DISABLED=true` 会关闭所有 API 鉴权，只适合你主动确认受信任的内网；不能作为迁移必需项。
