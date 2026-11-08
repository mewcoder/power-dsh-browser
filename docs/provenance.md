# 资料来源与开发边界

## 开发方式

用户最初提出净室工程，随后明确调整为有源码参考、优先复用实现的适配式移植。本项目从该调整起不再采用或宣称净室开发。实现者可以检查本机目标产品代码与解包参考，识别独立可复用模块和宿主耦合点。

记录每个实际复用模块的来源、版本和许可；区分插件自身实现、本机运行时资源与可分发依赖。目标产品的本机可读代码不自动获得再分发许可。

## 接口与研究依据

- DSH 本机发行版 0.2.2-rc.1 的公开包说明与实现，放在忽略的 `.reference/dsh-runtime/` 中，仅供发现当前宿主接口。
- [DSH 上游](https://github.com/deepseek-ai/deepseek-harness)。上游版本差异需要与本机接口核对。
- [Electron webview 文档](https://www.electronjs.org/docs/latest/api/webview-tag)。
- [Electron webContents 文档](https://www.electronjs.org/docs/latest/api/web-contents)。

## 实际使用与适配

本会话没有 `cordis_inspect_list` / `cordis_inspect_query`。公开接口来自当前本机发行包、对应版本的 npm SDK 和 Electron 文档核对；没有猜测额外的 `ctx.browser`、主进程执行或任意事件 RPC。

| 来源 | 使用方式 | 成品位置与边界 |
| --- | --- | --- |
| DSH 0.2.2-rc.1 `dsh-client-ui-sidebar-right`、`dsh-client-ui-sidebar-browser`（MIT） | 参考并适配公开 tab/slot/locale 注册、会话注入、工作目录存储标识及 lease 创建流程 | 插件 Client 与 Electron adapter；不导入宿主浏览器插件内部组件或控制其 webview |
| DSH Desktop 0.2.2-rc.1 main/preload（MIT） | 核对 browser lease、partition、真实 guest map 和原有 sender 校验；用户后续明确授权宿主桥接补丁 | 0.5.0 可选安装器以精确版本/散列和短锚点加载本项目原生模块，并在 sandbox preload 内联本项目 factory；新增固定 Network IPC，保留既有准入、权限、下载策略；完整原归档备份且可恢复 |
| DSH 0.2.2-rc.1 `dsh-tools`、`dsh-typert-protocol`、`dsh-mcp-client`（MIT） | 使用已安装 SDK 的 defineTool/TypertRemoteService；参考 descriptor、owner principal 与图片附件投影模式 | Host 工具与严格 RPC，模型不提供会话 ID；截图用附件 image block，不打包 SDK 副本 |
| DSH 0.2.2-rc.1 `dsh-client-ui-conversation`、`dsh-client-ui-input-trigger`、`dsh-client-ui-reference`、`dsh-api-session-controller`（MIT） | 核对 retained session scope、公开 InputActions、`slash/input-insert-reference`、source 注册与 reference codec 序列化 | 批注通过公开引用片与受版本校验的折叠选区插入，不覆盖现有草稿，不修改发送服务；codec 只序列化批次元数据，详情由会话绑定的 Host 工具读取，不导入宿主内部 UI |
| 本地 DSH Mod 的 RPC 适配范例 | 参考 `ctx.typert.register`、`remote.$mount` 和 `RemoteResult.ok` 的实际结构；重新定义本插件协议 | 没有导入或依赖相邻项目，也没有复制其无关产品功能；分发不包含范例源码 |
| Electron webview / nativeImage 官方文档 | 使用公开 executeJavaScript、capturePage、toDataURL、sendInputEvent、insertText、导航方法与事件 | 自有 guest 上的受限操作；不使用 debugger/CDP 控制宿主或其他页面 |
| Craft Anything 提交 `1f8508a104134c436cbba5ea2f675619ef47702f` | 按技能“已有源码则直接读取”的方法做证据驱动分析 | 没有安装或调用其 CLI/MCP，不声称产生其 evidence id；不打包其代码 |
| Nono-neko/dsh-browser，`3b30aa740ece9cc2057cb9c81bf1e5df5f1bef3e`（Apache-2.0） | 改编标签栏、工具栏与地址栏的 scoped 样式；参考 BrowserPanel、StartPage 的结构 | 仅用于本插件自有面板，不采用全局布局接管、代理页面、编辑器和更新机制；许可全文和修改说明见 [第三方声明](../THIRD_PARTY_NOTICES.md) |
| zhxnix/dsh-sidebar-annotations，`c6d04864ee386010359ac73a7e94b67a4a0e1706`（MIT） | 改编透明捕获层、元素选择与编辑期间手势锁定机制 | 本插件有界选择结果与生命周期；不采用 profile 安装脚本、宿主补丁、全局输入区 DOM hook 或自动发送；保留 MIT 声明 |
| wqty123/dsh-browser，`5c5eedcaa2e119b7997088de64ff4b27c16998f2`（MIT） | 阅读操作反馈、宿主启动注入、CDP transport seam 和安装恢复流程作为实现参考 | overlay 保持 scoped；0.5.0 改为原有 lease/sender 的 IPC 桥，独立实现原生模块和可恢复 ASAR transform；不复制其 TCP 桥、React Fiber/宿主 DOM 探测、全局 debugger detach、Electron 运行时或 CLI 路径补丁 |
| 目标产品 26.1103.32239 浏览器客户端、服务、IAB 后端和 UI | 由协作研究会话完成源码阅读和依赖映射，结论见 [源码分析记录](reverse-engineering.md) | **仅作为行为和依赖研究参考，没有复制、改编或直接导入目标代码到插件**；所需定制运行时、nativePipe、nodeRepl 与 UI 总线不适合直接作为 DSH 首版依赖；不宣称已获其再分发许可 |

协议 broker、过期/取消代次、有限 DOM 快照、原生动作准备、生命周期与测试为本项目实现。实际交付没有目标产品资源、运行时、本机脚本加载器或专有依赖；运行时不读取目标产品安装。选择适配公开 DSH/Electron 接口，是基于已核实的目标模块耦合和本项目不依赖目标安装的要求，不能描述为原实现的完整移植。

## 验证记录

- `npm run check`：Host/Client 构建、语法、lazy Client bundle、Cordis patch、工具合约与受控行为测试。测试覆盖会话隔离、owner、歧义窗口、取消/超时/离线/卸载、快照过期、原生输入序列、导航恢复与截图附件投影。
- 可选的真实 Chromium 测试使用本项目表单和独立临时 profile，直接执行成品页面 runtime；仅证明 Chromium 页面逻辑和原生输入策略，不证明 DSH Desktop guest 或 RPC 已注册。
- 0.1.0 经用户明确授权后，已通过原生管理器安装并启用；真实 Desktop 完成导航、快照、原生填写、点击提交、再次读取、模型图片截图与停止控制的基本闭环。该结果不代表所有界面、生命周期或后续版本已经验收；详细边界见 [验证说明](verification.md)。
- npm 安装全部使用 `--ignore-scripts`，依赖只安装到本项目。开发依赖的传递 Zod 安全公告尚未通过更改宿主 SDK 解决；README 已记录。分发包含 `lib`、插件源码、构建脚本、受控测试、Bundle patch 和说明文档，便于审查重跑；不包含 node_modules、参考材料、个人日志或凭据。

