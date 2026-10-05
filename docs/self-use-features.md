# NAS 精简版功能

- 官方平台、韩剧 TV（hanjutv）、人人视频（renren）搜索、分集及弹幕获取，支持分片与播放器协议。
- 规则匹配：文件名解析、严格标题/季号、年份判断、平台优先级、标题映射、季集映射及手动选择记忆。
- 内存搜索/弹幕缓存，本地查询快照与可选本地 Redis。
- 配置预览、日志、系统配置与缓存管理。
- 原有多源合并、偏移、过滤、输出格式和 Cookie 管理继续保留，本轮未扩大其删减范围。

已移除其余第三方来源（含 dandan；保留 hanjutv、renren）、360、本地弹幕、收藏/定时刷新、推送、Forward Widget、接口调试、弹幕测试、AI、Upstash、云部署管理、IP 黑名单及 TLS 校验关闭选项。

配置与 API 见 [configuration.md](configuration.md)，部署与迁移见 [deployment.md](deployment.md)。
