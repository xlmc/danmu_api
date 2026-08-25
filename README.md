# danmu_api Fork 更新

本仓库基于上游 `huangxd-/danmu_api`，以下仅记录本 fork 新增或增强的功能。

## 远程与本地剧名映射表

- 新增 `TITLE_MAPPING_TABLE_URL`：支持 GitHub 文件页、Gist、jsDelivr 和任意 TXT 直链。
- 首次下载后保存至 `.cache/title-mapping-remote.txt`；匹配时使用本地缓存，每天北京时间 05:30 自动更新，失败保留旧缓存并重试。
- `TITLE_MAPPING_TABLE`（本地表）优先于远程表；两者均支持标题、季数、年份，以及点号、空格、下划线等常见命名变体匹配。
- 远程表支持每行规则、分号分隔、`#` / `//` 注释、全角箭头和引号；适用于自动匹配、手动搜索、FongMi 与收藏。
- 管理端提供远程映射表手动刷新和独立日志查看。

## 安全季集映射

- `AUTO_MATCH_MAPPING_TABLE_URL` 读取 `Word/auto-match.txt`，下载后保存在本机；匹配不等待远程网络，每天北京时间 05:30 更新。
- 本机 `AUTO_MATCH_MAPPING_TABLE` 优先于远程季集表。远程只接受带完整起止集的有限范围规则，本机仍可显式配置开放规则。
- 匹配采用成功即停止的瀑布顺序：本机手动选择 → 本机标题表 → 本机季集表 → 原始普通匹配 → 远程标题缓存 → 远程季集缓存。每一步必须实际得到作品和剧集才停止，两个远程表不会串联转换。
- 季集规则始终使用规范化标题精确触发，不受 `STRICT_TITLE_MATCH` 是否开启影响；普通未映射请求仍遵守原开关。
- 目标中的 `{[tmdbid=...;type=...]}` 只用于内部候选限定，不写入播放器的匹配结果。季集转换不修改 `DANMU_OFFSET`、链接时间偏移或已有的手动集数偏好。

## 弹幕屏蔽词增强

- `BLOCKED_WORDS` 支持 `/正则/flags` 与纯文本词混用，兼容中英文逗号、逗号前后空格。
- 支持 `i`、`m`、`s`、`u` 标志；会自动避免 `g`、`y` 状态污染。
- 非法正则自动降级为纯文本匹配，并输出规则解析、命中数和拦截示例日志。

## 收藏功能可用性检测

- 收藏列表接口返回 `favoriteSupported`，用于声明当前部署是否具备持久化收藏能力。
- 在 serverless 平台未配置 Redis 时，收藏相关 UI 会禁用并提示配置 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`。

## 渐变彩色弹幕

- B 站大会员渐变弹幕（`color_v2` 扩展字段）透传：源数据携带时原样保留，`color` 字段仍输出单色以保持协议兼容；弹幕合并时会保留组内第一条可用的 `color_v2`。
- `GRADIENT_CHANCE` 渐变命中概率（0-100，默认 `0` 关闭）：`CONVERT_COLOR=color` 模式下，白色弹幕按该概率改为从渐变色带取色；颜色随弹幕出现时间平滑流转（60 秒循环），相邻弹幕颜色渐变过渡。
- `GRADIENT_COLORS` 渐变色带：可填皮肤名（`bilibili` 粉→蓝 / `sweet` 粉紫 / `cyber` 电竞 / `sunset` 日落 / `ocean` 海洋 / `mint` 薄荷 / `rainbow` 彩虹七色）或自定义十进制颜色值逗号分隔串（至少 2 个），默认使用 `bilibili` 皮肤。

## 版本

- 当前 fork 版本：v1.20.8。
