# 本地规则共享入口

TITLE_MAPPING_TABLE 和 AUTO_MATCH_MAPPING_TABLE 的编辑弹窗内有“上传共享”按钮，上传当前表全部已保存规则；修改后需先保存并重开编辑器。多于 100 条或接近大小限制时自动分批，无需勾选。
只读取这两项原始本地已保存配置，不分享混入的远程映射表。
点击按钮即上传当前表全部已保存规则，不要求最终用户创建 GitHub Token。
实际入口 POST /api/title-mapping/share 使用配置写入的管理员权限：配置了 ADMIN_TOKEN 时普通 TOKEN 无权上传；
未配置 ADMIN_TOKEN 时延续项目原有管理员判断；TOKEN_AUTH_DISABLED 模式也延续原有行为。

固定中央接收地址：
https://danmu-rules-upload.cbzj.workers.dev/api/rules/submit

不要把 Cloudflare 或 GitHub 的凭证放进客户端。本地项目 Token 也不会被转发。
修改本地规则后先保存并重新打开编辑器，避免上传已过期的文本。
结果区会分别列出新增、重复、冲突、无效的数量；新候选等待审核，不自动发布。
任何上传失败都不更改本地规则。

上线依赖 xlmc/danmu-mapping 配套接收端与审核代码，以及维护者一次性配置 Worker Secret。
当前接收端部署但关闭，因此安装新版界面后暂不能实际提交。

验证：npm test；新增 mapping-share.test.js 覆盖真实 handleRequest 入口、权限、本地上传、
超限请求、仅转发规则、失败保留配置、Node 请求流和实际生成的 UI JavaScript 语法。
浏览器组件验证使用真实组件函数和模拟接收服务，不能替代正式配置页及线上 GitHub 验收。
