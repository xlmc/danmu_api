# danmu_api Fork 更新

本仓库基于上游 `huangxd-/danmu_api`，以下仅记录本 fork 新增或增强的功能。

## 远程与本地剧名映射表

- 新增 `TITLE_MAPPING_TABLE_URL`：支持 GitHub 文件页、Gist、jsDelivr 和任意 TXT 直链。
- 首次下载后保存至 `.cache/title-mapping-remote.txt`；匹配时使用本地缓存，每天北京时间 05:30 自动更新，失败保留旧缓存并重试。
- `TITLE_MAPPING_TABLE`（本地表）优先于远程表；两者均支持标题、季数、年份，以及点号、空格、下划线等常见命名变体匹配。
- 远程表支持每行规则、分号分隔、`#` / `//` 注释、全角箭头和引号；适用于自动匹配、手动搜索、FongMi 与收藏。
- 管理端提供远程映射表手动刷新和独立日志查看。

## 弹幕屏蔽词增强

- `BLOCKED_WORDS` 支持 `/正则/flags` 与纯文本词混用，兼容中英文逗号、逗号前后空格。
- 支持 `i`、`m`、`s`、`u` 标志；会自动避免 `g`、`y` 状态污染。
- 非法正则自动降级为纯文本匹配，并输出规则解析、命中数和拦截示例日志。

## 收藏功能可用性检测

- 收藏列表接口返回 `favoriteSupported`，用于声明当前部署是否具备持久化收藏能力。
- 在 serverless 平台未配置 Redis 时，收藏相关 UI 会禁用并提示配置 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`。

## 版本

- 当前 fork 版本：v1.20.8。
