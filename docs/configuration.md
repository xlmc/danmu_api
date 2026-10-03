# NAS 精简版配置参考

保留官方视频平台和 dandan。搜索与匹配使用这些来源；360、豆瓣/TMDB 聚合搜索、VOD、人人、韩剧、爱壹帆、Animeko、自定义与兜底弹幕源已移除。TMDB/Bangumi Data 仍可辅助译名及季集判断。

## 播放器接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/v2/search/anime?keyword= | 搜索作品，也支持保留平台的播放链接 |
| POST | /api/v2/match | 按 fileName 解析并匹配作品和集数 |
| GET | /api/v2/search/episodes | 搜索分集 |
| GET | /api/v2/bangumi/:animeId | 作品详情 |
| GET | /api/v2/comment/:commentId | 获取弹幕 |
| GET | /api/v2/comment?url= | 按官方平台 URL 获取弹幕 |
| POST | /api/v2/segmentcomment | 下载源站分片 |
| GET/POST | /api/v2/fongmi/danmaku 或 /danmaku | 播放器兼容接口 |

以上接口按原 TOKEN 路径鉴权。配置管理、日志与缓存管理入口保留，接口调试和弹幕测试页面已移除。配置 ADMIN_TOKEN 后，配置修改、缓存清理和 Cookie 保存需管理员权限。

## 来源

可选：tencent、iqiyi、youku、imgo、bilibili、migu、sohu、leshi、xigua、maiduidui、hongguo、bahamut、dandan。默认启用腾讯、爱奇艺、优酷、芒果、B站、dandan。旧配置中不支持的来源会被过滤；全部无效时使用默认来源。dandan 账号、密码与其既有获取链路保留。

## 缓存

普通搜索与弹幕结果仅保存在内存，分别使用 TTL 和 500 条上限，TTL=0 禁用。COMMENT_CACHE_MIN_COUNT 控制少量弹幕的缓存重查。

本地文件及可选 LOCAL_REDIS_URL 保存作品详情、集数 ID、计数器和手动选择记录等查询快照；不会持久化普通搜索/弹幕内容。已有 .cache 目录且 LOCAL_CACHE_ENABLED=true 时启用文件缓存；本地 Redis 优先恢复，文件可回退。读取失败的后端不会覆盖未知数据，损坏文件会先备份。旧快照中已删除来源会被过滤，已分配 ID 的上界保留。

## 设置

| 配置项 | 类型 | 说明 |
|---|---|---|
| TOKEN | text | API访问令牌 |
| TOKEN_AUTH_DISABLED | boolean | 关闭 API 和管理界面的 TOKEN 鉴权（仅建议在受信任的内网环境使用） |
| ADMIN_TOKEN | text | 系统管理访问令牌 |
| RATE_LIMIT_MAX_REQUESTS | number | 限流配置：1分钟内最大请求次数，0表示不限流，默认3 |
| SOURCE_ORDER | multi-select | 源排序配置，默认腾讯、爱奇艺、优酷、芒果、B站、dandan，按配置顺序排列搜索结果 |
| MERGE_SOURCE_PAIRS | multi-select | 源合并配置，配置后将对应源合并同时一起获取弹幕返回，允许多组，允许多源，允许填单源表示保留原结果，一组中第一个为主源其余为副源，副源往主源合并，主源如果没有结果会轮替下一个作为主源。 格式：源1&源2&源3 ，多组用逗号分隔。 示例：tencent&iqiyi,youku&bilibili,dandan |
| CUSTOM_MERGE_RULES | text | 合并映射表，用于自定义源合并行为。 格式1(合并)：副源剧名/S季数@来源 -> 主源剧名/S季数@来源 \| E副源集数>E主源集数 格式2(阻断)：副源剧名/S季数@来源 × 主源剧名/S季数@来源 说明：[/S季数] 与 [\|路由规则] 为可选项，留空则交由程序判断。多个规则用分号隔开，多段路由用逗号分隔。 示例： 1. 常规合并：天气之子@bilibili -> 天气之子@dandan 2. 多集路由：我推的孩子/S01@bahamut -> 我推的孩子/S03@dandan \| E25~E35>E25~E35 3. 阻断合并：辉夜大小姐想让我告白？～天才们的恋爱头脑战～(2020)@bilibili × 辉夜大小姐想让我告白～天才们的恋爱头脑战～ OVA(2021)【OVA】@dandan |
| BILIBILI_COOKIE | text | B站Cookie |
| YOUKU_CONCURRENCY | number | 优酷并发配置，默认8 |
| DANDANPLAY_ACCOUNT | text | 弹弹play账号（dandan 源获取弹幕使用）。 与密码同时填写后自动开启，无需额外开关。 开启后 dandan 源改由 NipaPlay 中转弹弹play服务端获取弹幕，并把同一请求下发的弹弹关联链接分发给对应平台源实时拉取（需开启对应源）： 最终弹幕为 NipaPlay 中转弹弹play服务端弹幕与自有链路弹幕合并去重后的结果。 注意：关联链接指向的平台视频若已下架将无法通过自有链路补取；关联含巴哈姆特平台时需确保能够连通巴哈 |
| DANDANPLAY_PASSWORD | text | 弹弹play密码（dandan 源获取弹幕使用），与账号同时填写后启用。 |
| PLATFORM_ORDER | multi-select | 平台排序配置，可以配置自动匹配时的优选平台。 当配置合并平台的时候，可以指定期望的合并源， 示例：一个结果返回了"dandan&bilibili"和"youku"时， 当配置"youku"时返回"youku"  当配置"dandan&bilibili"时返回"dandan&bilibili" |
| ANIME_TITLE_FILTER | text | 剧名过滤规则 |
| EPISODE_TITLE_FILTER | text | 剧集标题过滤规则 |
| ENABLE_ANIME_EPISODE_FILTER | boolean | 控制手动搜索的时候是否根据ANIME_TITLE_FILTER进行剧名过滤以及根据EPISODE_TITLE_FILTER进行集标题过滤 |
| STRICT_TITLE_MATCH | boolean | 严格标题匹配模式 |
| TITLE_TO_CHINESE | boolean | 外语标题转换中文开关 |
| ANIME_TITLE_SIMPLIFIED | boolean | 搜索的剧名标题自动繁转简 |
| TITLE_MAPPING_TABLE | map | 本机剧名映射表，用于自动匹配时替换标题进行搜索。本机规则优先于远程规则。远程映射默认关闭；启用时请在下方 TITLE_MAPPING_TABLE_URL 填写：https://raw.githubusercontent.com/xlmc/danmu-mapping/main/Word/2026.txt。格式：原始标题->映射标题;原始标题->映射标题;...，例如："唐朝诡事录->唐朝诡事录之西行;国色芳华->锦绣芳华" |
| TITLE_MAPPING_TABLE_URL | text | 远程剧名映射表（默认关闭，填写后启用）。推荐地址：https://raw.githubusercontent.com/xlmc/danmu-mapping/main/Word/2026.txt。程序首次下载后保存到本地，匹配时只读取本地缓存，不连接远程；每天北京时间05:30更新，失败保留旧缓存。本机 TITLE_MAPPING_TABLE 优先于远程表。支持 GitHub 文件页、Gist、jsDelivr 及任意 TXT 直链；内容格式为每行 原始标题->映射标题，# 或 // 开头为注释 |
| AUTO_MATCH_MAPPING_TABLE | map | 自动匹配映射表，仅作用于 POST /api/v2/match。多个规则使用分号分隔。 开放映射：永生 S05E02 -> 永生 S01E58 有限范围：永生 S05E02~03 -> 永生 S01E58~59 指定结果：海贼王 S02E01 -> 航海王(1999)【动漫】 S01E62 指定平台：航海王 S01E01 -> 航海王 S01E01 @iqiyi 可选发布组：作品 S01E01 {[group=ANi]} -> 作品 S01E02；文件名有发布组时优先专用规则，失败后回退通用规则 |
| AUTO_MATCH_MAPPING_TABLE_URL | text | 远程季集映射表（默认关闭）。推荐填写 danmu-mapping 的 Word/season-candidates.txt。下载后保存到本机缓存，匹配过程中只读取本机缓存；每天北京时间05:30更新，失败沿用旧缓存。本机 AUTO_MATCH_MAPPING_TABLE 优先。为防止过度转换，远程表只接受同时写明起止集的有限范围规则；源侧可选使用 {[group=ANi]} 发布组标记。 |
| TITLE_NOISE_FILTER | text | 剧名杂音清理规则，按正则表达式清理搜索与匹配阶段的剧名杂音词（如`百花杀（真彩）`→`百花杀`）。 默认值：[（(\[［](?:臻彩\|真彩\|高清\|标清\|超清\|国配\|中配\|日配\|粤语\|原声\|台配\|无修\|未删减\|完整版\|日语版\|国语版\|英语版\|中字\|字幕\|助听\|原版)[\])）］]，中英文圆方括号均匹配。 设为空值可禁用 |
| USE_BANGUMI_DATA | boolean | Bangumi Data 加速匹配开关，开启后将动画元数据缓存至本地或内存中给源调用，提升动画源的检索与匹配速度并解锁隐藏/区域番剧。 本地和Docker部署使用时请先挂载.cache目录获得最佳体验，云部署使用时会将数据缓存至临时内存中如果体验不佳请关闭。 |
| BLOCKED_WORDS | text | 屏蔽词列表：支持 /正则/flags、纯文本词、@人名（按语境分析匹配：二字人名仅在明确人物语境中命中，避免误伤同名词；姓氏仅在被称谓指代时命中，如"杨老师"）；地区和日期时间可在编辑器中添加预设正则，删除相应规则即可停用。兼容 地区:地区名 和 地区:*（包含名称即屏蔽整条） |
| BLOCK_DOMESTIC_CELEBRITIES | boolean | 当前华语作品演员/角色名屏蔽开关，默认关闭。开启后通过 TMDB 获取当前国产/港台作品的中文演员名和角色名；作品角色表中的完整角色名和派生昵称直接匹配（含二字角色名、去姓称呼及单字名的阿/子/儿/哥/姐称呼；同名普通词也会命中）；演员完整名直接匹配，含二字姓名。需要可用的 TMDB_API_KEY，或能够代为认证的 TMDB 反代；动画角色名单同时合并 Bangumi 当前条目及动画前传、续集的角色资料；维基百科补充当前作品演员、角色及表中化名，校验作品名称与首播/上映年份，不遍历演员作品表。各资料源与弹幕拉取并行，返回前完成过滤，匹配兼容简繁中文；查询失败或名单不完整时五分钟后允许重试，完整名单缓存一天。 |
| PERSON_FILTER_EXCLUDED_TITLES | text | 不屏蔽人物的动漫/作品名单，支持逗号、分号或换行分隔。可填写实际作品名或已有别名，例如“诛仙4”；系统通过现有名称对应关系取得实际作品名后判断是否免屏蔽，名单里只填名字。仅跳过自动演员/角色屏蔽，其他屏蔽词、地区和日期规则继续生效。 |
| GROUP_MINUTE | number | 分钟内合并去重（0表示不去重），默认1 |
| DANMU_LIMIT | number | 弹幕数量限制，单位为k，即千：默认 0，表示不限制弹幕数 |
| DANMU_SIMPLIFIED_TRADITIONAL | select | 弹幕简繁体转换设置：default（默认不转换）、simplified（繁转简）、traditional（简转繁） |
| CONVERT_TOP_BOTTOM_TO_SCROLL | boolean | 顶部/底部弹幕转换为浮动弹幕 |
| CONVERT_COLOR | select | 弹幕转换颜色配置 |
| COLOR_POOL | text | 自定义颜色池（CONVERT_COLOR为color时生效），不配置使用默认颜色池，格式：十进制颜色值逗号分隔 |
| GRADIENT_CHANCE | number | 渐变色弹幕概率（CONVERT_COLOR为color时生效），单位百分比 0-100，默认 0，弹幕按此概率从渐变色带取色（随出现时间平滑流转），0 表示关闭 |
| GRADIENT_COLORS | text | 渐变色带（CONVERT_COLOR为color时生效），默认使用default；可选皮肤：bilibili/sweet/cyber/sunset/ocean/mint/rainbow，或十进制颜色值逗号分隔（至少2个） |
| DANMUX_GRADIENT_STOPS | text | DanmuX 标准渐变 stops JSON；留空时使用 GRADIENT_COLORS 皮肤 |
| DANMUX_GRADIENT_ANGLE | number | DanmuX 标准线性渐变角度，默认0 |
| DANMU_OUTPUT_FORMAT | select | 弹幕输出格式，默认json |
| LIKE_SWITCH | boolean | 弹幕点赞数显示开关，默认开启 |
| HONGGUO_MERGE_ALL_EPISODES | boolean | 红果短剧合并全集弹幕，默认关闭 |
| DANMU_OFFSET | text | 弹幕时间偏移配置，格式：剧名:秒 或 剧名/季:秒 或 剧名/季/集:秒，支持指定来源：剧名@来源:秒 或 剧名/季@来源1&来源2:秒，多条用逗号分隔，正数表示弹幕延后（向右），负数表示弹幕提前（向左）。支持百分比模式：在路径或来源末尾追加 %，如 东方/S03/E02@tencent%:11，按公式 原时间 * (视频时长 + 偏移秒数) / 视频时长 缩放全部弹幕时间。示例：overlord/S01:90,re-zero/S02@bilibili:120,re-zero/S02/E03@dandan&bilibili:10,东方/S03/E02@tencent%:11 |
| LOCAL_CACHE_ENABLED | boolean | 通用文件缓存开关，默认开启且仍需已有 .cache 目录；关闭后不读取或写入通用文件缓存，包括收藏与定时计划；已配置 Upstash 时仍可持久化。不影响本地弹幕文件、Bangumi Data 或 Redis |
| SEARCH_CACHE_MINUTES | number | 搜索结果缓存时间(分钟)，默认3 |
| MATCH_SEARCH_BUDGET_MS | number | 自动匹配快速搜索等待时间，默认1500毫秒。优先平台组已有准确季集时提前返回，慢源继续完成完整搜索；没有准确候选仍等待回退。0关闭目录复用和提前返回，等待全部来源及合并。手动搜索不受影响。 |
| COMMENT_CACHE_MINUTES | number | 弹幕缓存时间(分钟)，默认3 |
| COMMENT_CACHE_MIN_COUNT | number | 弹幕缓存最少条数，低于该值时重新获取，默认100，设置0关闭 |
| REMEMBER_LAST_SELECT | boolean | 记住明确手动选择的结果；自动匹配后直接获取其返回结果不会写入偏好 |
| MAX_LAST_SELECT_MAP | number | 记住上次选择映射缓存大小限制，默认100 |
| MAX_ANIMES | number | 动漫标题缓存最大数量，默认100 |
| LOCAL_REDIS_URL | text | 本地 Redis 连接URL，示例：redis://:password@127.0.0.1:6379/0，只支持本地部署和docker部署 |
| BANGUMI_DATA_CACHE_DAYS | number | Bangumi Data 缓存有效期(天)，设置0则每次请求时强制异步更新，默认7天 |
| UI_THEME | select | 管理界面主题 |
| PROXY_URL | text | 代理/反代地址 |
| TMDB_API_KEY | text | TMDB API密钥 |
| LOG_LEVEL | select | 日志级别配置 |

云部署凭据、Upstash、AI、IP 黑名单和关闭 TLS 证书校验的管理项已移除。HTTPS 使用 Node 默认的证书校验。
