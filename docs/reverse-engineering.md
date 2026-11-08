# 内置浏览器源码分析与适配记录

## 问题与范围

将目标产品的应用内浏览器体验移植到 DSH Desktop：用户与 Agent 共享可见网页，支持页面观察、输入、截图、会话绑定和停止控制。用户要求参考已解包源码，优先复用适合抽取的实现，不采用净室方式。

本轮分析只读取本机安装的 JavaScript、包声明与公开接口资料；没有启动目标浏览器执行页面操作，也没有修改目标应用或 DSH 发行包。

## 方法

使用用户指定的 [Craft Anything](https://github.com/storytold/craft-anything) 的证据驱动方法。参考提交为 `1f8508a104134c436cbba5ea2f675619ef47702f`，技能位于其 `crates/setup/src/skill.md`。该技能明确已有源码时优先直接读取源码。本环境没有其 CLI/MCP；本页的 `SRC-*` 为本项目源码证据编号，不是其工具生成的 evidence id。

标记规则：**观察**表示在文件中直接可见；**推导**表示根据调用关系形成的依赖结论；**待验证**表示尚需实际运行。

## 源码证据索引

| 编号 | 来源与版本 | 观察内容 |
| --- | --- | --- |
| SRC-01 | 目标桌面应用 `package.json`，`26.1103.32239` | 入口为 `.vite/build/early-bootstrap.js`；构建脚本引用 Owl Electron 类型与运行时，依赖包含 browser-api、browser-backend-common、browser-common。 |
| SRC-02 | 同版 `.vite/build/early-bootstrap-920-a204a41244c4b913.js` | IAB 后端类在该归档条目的字符偏移约 2498816–2560569，编译后符号名 `OC`。包含标签映射、会话控制、导航、CDP、截图相关控制和清理。该条目 SHA-256 为 `92f04b9e66135f8b8542a6888351f5ef5eebc38a20b881fb58787e8b84f55c58`。 |
| SRC-03 | 同版 Browser 插件 `scripts/browser-client.mjs` | `setupBrowserRuntime` 要求 `globalThis.nodeRepl.rpc`，随后调用 browser 服务的 setup/execute；不是独立浏览器引擎。 |
| SRC-04 | 同版 Browser 插件 `scripts/browser-service.mjs` | 服务使用 nativePipe、请求会话/回合 metadata 和结束回合处理；session 范围的后端需要匹配当前会话。 |
| SRC-05 | 同版 `webview/assets/async/620182.5dff767066.js` | 可见浏览器 UI、页面状态订阅、用户交互、光标覆盖层及光标到达确认消息。页面批注依赖其他应用模块。 |
| SRC-06 | 同版 Browser 插件 `docs/api.json` 与插件声明 | API 将 Browser、Tabs、Tab 及可选能力分离；插件声明为 Proprietary。记录声明不等于对再分发权作判断。 |
| SRC-07 | DSH `0.2.2-rc.1` 的 ui-sidebar-browser、ui-sidebar-right、tools、typert、attachments 公开包与桌面 main/preload | 存在可注册的侧栏页、按会话注入、工具执行 Agent 上下文、自己的 guest lease 和图片附件链路。 |
| SRC-08 | [Electron webview](https://www.electronjs.org/docs/latest/api/webview-tag)、[nativeImage](https://www.electronjs.org/docs/latest/api/native-image) 公开文档 | 自有 webview 在 dom-ready 后可调用 executeJavaScript、capturePage、sendInputEvent、insertText。沙箱 renderer 使用 nativeImage.toDataURL，避免依赖 Buffer 返回方法。 |

原始解包产物、可读摘录和公开宿主参考保留在忽略的参考目录；不进入插件分发包。偏移是编译产物定位线索，不声称恢复了原始作者的源码文件结构或符号名。

## 已追踪的控制链

1. **观察，SRC-02：** `createTabForBrowserUse` 取得会话所属的 browser host，生成页面标识，调用 `openPageForBrowserUse`，再将页面映射到工具使用的逻辑标签 ID。
2. **观察，SRC-02：** `requireBrowserUseSession` 读取请求的 session_id；`ensureBrowserUseSessionRoute` 要求当前会话已绑定合法路由。`captureSessionRoute` 将会话与桌面窗口、owner 页面关联。
3. **观察，SRC-02：** `executeCdpForBrowserUse` 验证当前页面、处理导航与取消状态，准备焦点，最终通过 `webContents.debugger.sendCommand` 执行 CDP。截图还会涉及捕获表面的尺寸和页面绘制状态。
4. **观察，SRC-02：** 部分路径调用 `attachBrowserUseNetworkPolicy`、`detachBrowserUseNetworkPolicy`、`setPageCapturePaintLeaseEnabled`。其中网络策略附加属于直接等待的调用；绘制 lease 的失败分支会记录错误。
5. **观察，SRC-05：** 光标显示由 UI 层处理；到达状态通过消息回传。它不是 CDP 自动画出的鼠标。
6. **推导，SRC-02/03/04/05：** 产品体验由客户端库、受信任服务、桌面页面后端和 UI 共同组成；原样复制某个文件不能自动获得其他层的服务和状态。

## 复用判断

| 模块 | 直接复用条件 | DSH 适配决策 |
| --- | --- | --- |
| browser-client 高层 API 包装 | 提供其预期的 browser setup/execute RPC、完整 API manifest 和结果语义 | 可作 API 与动作语义参考；不能将“导入成功”算作浏览器已接通。首版工具优先直接使用 DSH 执行上下文，避免为少量工具补齐整套 SDK 协议。 |
| browser-service | 需要受信任运行时提供 nativePipe、metadata、结束钩子及其他服务 | 当前不把该完整运行时作为首版必需依赖；若后续复用，需单独测试服务契约，不能只设置全局对象来伪造可用性。 |
| IAB 桌面后端 | 需要页面 host、真实 Electron webContents、路由和若干定制运行时接口 | 保留其页面归属与控制生命周期设计作为参考；将 DSH 的自有 guest lease 和工具会话映射接入，不直接搬入混淆后的整段主进程 bundle。 |
| 标签栏、地址栏、批注和光标 UI | 依赖目标应用 React、消息总线、主题、会话及其他 UI 模块 | 在 DSH 原生 slot 内适配；实际使用的动作、生命周期与资源边界记录到实现来源中。首版不宣称已包含批注或光标动画。 |
| DSH 自有 webview 承载 | 当前公开包实现及 Electron 方法 | 优先参考/复用宿主的 guest 创建流程与公开扩展契约；不用其他插件的 DOM 或内部页面对象。 |

“优先复用”指先检查模块是否可独立工作并记录真实依赖，不把未接通的运行时或整段主进程 bundle 当作已完成移植。最终哪些代码实际复制、改编或仅参考，由实现者在 provenance 中按成品记录。

## 假设与结果

- **H1：单独复制浏览器客户端就能运行内置浏览器。已反驳。** SRC-03 明确要求额外的受信任 RPC 服务。
- **H2：桌面后端只使用标准 Electron 方法。已反驳。** SRC-02 还直接调用定制网络策略接口及绘制 lease 接口。
- **H3：没有公开主进程截图代理就无法实现插件截图。静态依据不支持此结论。** SRC-07/08 给出自有 webview 的 renderer 截图方法；是否在本机宿主成功需真实运行验证。
- **H4：基础观察/操作/截图可以不修改 DSH 发行包。待真实 Desktop 验证。** 源码和公开文档支持设计路径，但尚不作为运行事实。

## 当前未知与后续检查

- 当前 DSH Desktop 对插件自有 webview 的实际加载、输入、截图结果。
- 批注、可视光标、持久登录及复杂 iframe/Shadow DOM 场景与目标体验的差异。
- Electron 方法执行中的取消只能阻止后续动作、使旧结果失效；已经发生的网页操作不能回滚。
- 多窗口、会话切换、Client 断线重连时，页面归属与执行控制必须通过实际测试确认。

## 接续记录

分析已定位可读的应用代码与主要调用边界；首版实现正在将页面承载、会话路由与工具结果接入 DSH。下一步以成品代码和验证结果更新实际复用清单，并执行“导航 → 观察 → 填写 → 点击 → 再次观察 → 截图”的闭环。不得将静态源码分析、Node MCP 握手或受控替身测试描述为真实桌面浏览器已验收。
