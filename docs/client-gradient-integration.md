# 客户端通用渐变接入：iOS、Android 与 PC

本文补充 [播放器渐变字段指南](player-gradient-integration.md)，适用于已有弹幕 API 接入能力的 iOS、Android 和 PC 客户端。所有平台使用相同字段与接入流程；平台只影响最后的文字填充 API。请求 URL、响应外层、`p/m`、匹配、服务端开关与概率继续按原方式工作。客户端以每条评论的可选 `danmux` 字段决定效果，无需新增配置请求或重新抽概率。

## 最小接入范围

接入者先完成这三个动作即可开始验证：

1. 原评论转换时保留一个可选样式属性；它与评论一起传递和缓存。
2. 原文字准备时读取支持的样式并准备渐变，复用宿主的文字尺寸。
3. 在原填充入口调用参考绘制方法；该方法负责无效果时的原单色降级。

renderer 提供可复制的 Kotlin 和 Swift 参考；PC 作者按原画刷、字形或图片准备入口映射。复用原模型、调度和缓存，不要求统一语言、框架或安装某个 SDK。最短接入示例见下表；后文用于检查已有路径是否能承接可选样式。

| 原文字绘制入口 | 最小接法 | 参考 |
| --- | --- | --- |
| Android Canvas | 加载时 `readFill`，准备时 `prepareText`，将原填充调用改为 `GradientPainter.drawText`，自动单色兜底 | [Kotlin](https://github.com/xlmc/danmux-renderer/blob/main/mobile/android/README.md) |
| iOS / macOS Core Graphics、文字图片缓存 | 加载时 `readFill`，在原文字准备处创建渐变与填充 alpha 图像，在原位置调用 `GradientPainter.draw`，自动调用原填充兜底 | [Swift](https://github.com/xlmc/danmux-renderer/blob/main/mobile/apple/README.md) |
| Windows / 跨平台 Avalonia、Direct2D、Qt | 将原文字 brush 或原图片生成入口接入线性填充，沿用原 glyph/layout | [PC 接入片段](https://github.com/xlmc/danmux-renderer/blob/main/docs/DESKTOP_INTEGRATION.md) |
| Flutter、GPU 图片/图集 | 在原文字前景 Paint 或光栅化阶段应用渐变，继续使用原图片调度 | [跨平台绘制入口](https://github.com/xlmc/danmux-renderer/blob/main/docs/NATIVE_INTEGRATION.md) |

先按播放器的绘制入口选择实现，而不是要求某个操作系统使用指定引擎。Swift 参考支持 iOS 和 macOS；Avalonia、Qt、Flutter 也可用于多个平台。PC 片段是 API 映射参考，须在所用框架版本中构建验证。

当前服务端人工渐变是 `extensionVersion=1` 的 `gradient + fill + linear`。客户端可以先只支持这一组；其他版本、目标和来源按收到的基础颜色绘制，不要求实现整个效果体系或安装 DanmuX。

最小改动涉及两个边界：加载时保留并读取可选样式；绘制时把样式用于已有文字填充。原播放器继续负责文字、字号、轨道、时间偏移、透明度、屏蔽、暂停和拖动。

```text
原 API 响应（p/m + 可选 danmux）
 → 原评论转换/缓存（带一个可选样式属性）
 → 原布局/内部传递（保留样式，不参与时间与轨道计算）
 → 原文字准备（按宿主文字框准备渐变）
 → 原绘制（支持效果则填充渐变，否则原单色）
```

“两个边界”不表示所有播放器只改两行。若内部有多个模型、进程或语言层，每次重建对象时都需承接可选样式。

## 如何穿过内部模型

优先使用已有的 `extra`、metadata 或样式属性；没有时增加一个可空属性即可，不替换整套模型。检查以下原有步骤：

| 步骤 | 接入要求 |
| --- | --- |
| `p/m` 转内部评论 | 保留可选扩展或解析后的线性填充；基础解析不受影响 |
| 磁盘缓存/跨语言桥接 | 写出和读回可选 JSON 数据；不要序列化 Shader、Paint 或图像对象 |
| 偏移、过滤、排序、模型复制 | 保留幸存评论的样式，沿用原处理规则 |
| 合并相同弹幕 | 显示合并结果时沿用原规则选定的代表评论样式；不要额外重抽效果概率 |
| 布局结果转渲染对象 | 继续带上样式，文字框尺寸仍由宿主决定 |

跨语言时可透传 JSON 兼容的可选扩展，在绘制平台只校验一次；同语言时可保留解析后的不可变样式。不要让每一层各维护一套校验器。旧缓存没有扩展时按普通弹幕使用；仅因缓存缺少渐变不应使播放失败。

以 LinPlayer 的 [接口解析](https://github.com/zzzwannasleep/linplayer/blob/78af5215aaa7b9e3f81014b090d8d55cbabf11c0/core/danmaku/client.go)、[播放层传递](https://github.com/zzzwannasleep/linplayer/blob/78af5215aaa7b9e3f81014b090d8d55cbabf11c0/core/player/danmaku_feed.go) 为例，API 返回值会被重新构造成内部对象。这种常见结构说明仅保留 HTTP 响应还不够，必须检查数据能否到达绘制层。它是链路分析参考，不是专用适配方案。

NipaPlay 的 [API 转换](https://github.com/AimesSoft/NipaPlay-Reload/blob/c0d563422faa27ac4d8c23aa29d185f59bc34088/lib/services/dandanplay_service_io.dart#L1697-L1758) 会先重建评论再存入 [客户端缓存](https://github.com/AimesSoft/NipaPlay-Reload/blob/c0d563422faa27ac4d8c23aa29d185f59bc34088/lib/services/danmaku_cache_manager.dart)。它的 [应用模型](https://github.com/AimesSoft/NipaPlay-Reload/blob/c0d563422faa27ac4d8c23aa29d185f59bc34088/lib/models/danmaku/danmaku_item.dart) 虽有 extra 属性，但后面的 [Next 引擎转换](https://github.com/AimesSoft/NipaPlay-Reload/blob/c0d563422faa27ac4d8c23aa29d185f59bc34088/lib/danmaku_next/nipaplay_next_engine.dart#L554-L588) 还会构造只带已知属性的绘制内容。这说明模型有 extra 并不自动证明整条链路保留扩展。

通用做法是让可选样式沿用原数据路径，并在真正进入文字准备阶段时读取一次。跨语言或磁盘缓存可用普通 JSON 对象/字符串承载；Kotlin `readFillJson` 和 Swift `readFillJSON` 可读取该字符串，旧缓存或非法字符串返回空样式。需要在自己的转换入口添加一个可选属性，无需复刻参考播放器的内部类。

## 复用原文字绘制与缓存

渐变方向和色标来自服务端；以文字框为坐标系，在原文字准备或原光栅化阶段创建渐变。每帧只移动和绘制准备好的文字。直接绘制、图片缓存和图集都可沿用各自现有入口，不需要另外创建覆盖层、轨道或时钟。

已有缓存键应在原文本、字体、字号等条件外，包含实际渐变样式（角度、色标、alpha 和目标）以及会影响外观的效果开关/预设。字体或文字框变化后重新准备；关闭效果时使用原单色分支，不能继续显示带渐变的旧图像。渐变数据相同才复用同一外观，不能只按文本或基础单色复用。

NipaPlay 的 [Next 图集绘制](https://github.com/AimesSoft/NipaPlay-Reload/blob/c0d563422faa27ac4d8c23aa29d185f59bc34088/lib/danmaku_next/danmaku_atlas_painter.dart) 将文字 Paragraph 和预光栅化图像缓存，再用于图集绘制。这类实现适合在原文字生成入口应用渐变，并让样式参与原缓存键，后续图片移动和图集逻辑继续使用。参考路径里合并计数有独立白色文本样式：宿主有计数、标签或彩色 emoji 时应保留这些独立文字片段，避免将整张包含阴影/计数的图像统一着色。需要在文本填充阶段区分片段，而不是无条件给最终图像叠一层渐变。

绘制顺序沿用宿主：阴影/描边照常处理，渐变只接入受支持的填充。共享 Paint 的 shader 和 Canvas 状态应在绘后恢复，防止下一条普通弹幕继承效果。保留宿主透明度并与色标 alpha 相乘。

[renderer 通用原生绘制参考](https://github.com/xlmc/danmux-renderer/blob/main/docs/NATIVE_INTEGRATION.md) 展示独立的解析、准备和填充入口。Kotlin / Swift 参考只支持线性填充，可复制源码进工程，无需引入 JS 运行时。桌面端和 Flutter 映射按宿主现有 API 实现，同样保留基础绘制。

## 所有平台相同的渐变几何

以原文字框左上角为局部原点，宽 w、高 h，角度 θ 顺时针，0°向右、90°向下：

```text
dx = cos(θ × π / 180), dy = sin(θ × π / 180)
r = (w × abs(dx) + h × abs(dy)) / 2
center = (w/2, h/2)
start = center - r × (dx, dy)
end   = center + r × (dx, dy)
```

创建原绘制 API 的线性渐变，按稳定排序的 position 添加 color/alpha。宿主若用向上的 y 轴，局部 y 转为 `h-y`；不要直接把角度当作原生 API 的角度参数，也不要套用整块视频尺寸。宿主负责将局部文字框移动到原位置，渐变随文字移动。

文字字号和基线沿用原度量。逻辑单位、图片像素密度与坐标缩放沿用原规则；不能在图片生成和绘制时重复乘 scale。宿主 opacity 与色标 alpha 相乘，mask 不预先乘同一透明度。

## 缓存刷新与能力降级

服务端配置变化影响后续请求。播放器已有缓存、正在显示的评论和已生成文字图片，仍按原刷新/过期机制更新。无需新增轮询接口。手动重新加载弹幕时，应能重新获取新响应并刷新该批评论的绘制资源。

未知版本、非法效果或不支持的效果不删除基础弹幕，不替换成默认渐变。合法的其他支持效果可以继续使用。客户端本地关闭增强时，基础色仍取收到的 `p`。采用 XML 的路径继续单色；JSON 扩展不会自动通过 XML 或 ASS 转换保留下来。

## 各平台宿主验收

1. 开关关闭、零概率、无扩展、旧缓存时，原弹幕和收到的基础颜色正常显示。
2. 合法线性填充的角度、色标、透明度正确，阴影/描边和后续普通弹幕不被污染。
3. 非法填充、未知版本、纹理或仅描边时正常降级；同一批的合法评论不受影响。
4. 缓存写入读回、模型复制、跨语言传递、时间偏移及合并后仍能按约定显示。
5. 字号、字体、横竖屏、窗口/DPI 变化、效果开关变化后重新生成正确外观，缓存不串色。
6. 暂停、拖动、倍速、退出、换集和资源释放仍符合原行为；密集弹幕在目标设备上验收性能。

共享样例和参考库测试可减少校验规则的重复实现，但不能代替具体客户端的构建、画面与播放操作验收。Sen/Hills 的支持需在其实际客户端确认。
