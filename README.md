# dsh-x-browser · DSHX

DSHX 系列的 DSH Desktop 独立 Cordis Bundle：用户与 Agent 在聊天旁共享插件自己的 Electron webview。**1.0.0** 增加 owned-guest Network 桥接和 `browser_network`：读取真实请求/响应头、POST 数据、完成后的响应正文、重定向与失败状态。多标签、导航、DOM/样式、控制台、截图和已有批注功能继续保留。

版本 **1.0.0**（能力对齐 ZCode / Qoder 级别）。目标为 **DSH 0.2.2-rc.1 / macOS Desktop**。基础插件使用 DSH 公开 webview 接口；Network 另外需要用户已授权的宿主桥接补丁。1.0.0 的代码检查、受控测试与宿主实际加载/真实页面验收分别记录，不把构建成功或假 debugger 测试当作已安装。

## 构建与安装

需要 Node.js 22 或以上版本。在项目目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

通过 **DSH 设置 → 插件 → 安装第三方插件**安装本项目本地目录或本地 npm 包；更新也由原生管理器维护，不手写 profile。运行宿主需已有 tools、typert、Client remote、locale、sidebarRightTabs、slots 和 workspaces 服务。模型图片截图还需要附件存储和支持图片输入的模型。

Network 桥的安装流程独立：

```sh
node scripts/desktop-bridge.mjs --check
node scripts/desktop-bridge.mjs --prepare
```

预检和准备不会修改已安装应用。准备产物包含补丁、原归档备份和 manifest。**必须完全退出 DSH 后，才能按 manifest 执行 apply；安装器不会代替用户关闭应用。** 它会核对准确版本、源文件散列、Electron 加载策略、进程和原始备份，再原子替换归档；restore 只恢复该 manifest 对应的原始字节。

完整命令和边界见 [宿主桥安装说明](docs/desktop-bridge.md)。普通基础浏览无需此补丁；未加载桥时 Network 明确报告不可用，不切换外部浏览器或伪造流量。

## 使用

1. 使用浏览器工具时，**Agent 浏览器 / Agent Browser** 面板会按需自动打开（应用启动时不弹出；关闭后保持关闭，直到下次真正需要）。也可从会话右侧栏手动打开。每个会话保留一个可操作面板，面板内最多 12 个独立标签。多个窗口或面板同时提供同一会话时返回 `AMBIGUOUS_PANEL`。
2. 地址栏支持网址、HTTP(S) 与搜索词；本地 localhost 默认 HTTP。新建、切换和关闭标签保留独立页面和历史。
3. Agent 先通过 `browser_status` / `browser_tabs` 取得活动 tabId，再使用对应工具。所有会话身份来自真实 `exec.agent.session.id`，工具不接受自行指定的会话 ID。
4. 页面快照包含 tabId、generation、documentId、snapshotId 和元素引用。动作会消耗快照；导航或页面变化后必须重新观察，不猜坐标。
5. 捕获网络时先在当前标签调用 `browser_network` 的 start，再导航或触发请求。用 list 找到 requestId/hop，read 查看头和状态，body 分页读取正文。完整用法见 [Network 工具](docs/network.md)。
6. **停止 Agent** 会取消当前工作并停止所有 owned tab 的网络捕获；正常切换标签或导航保留录制。关闭标签、面板、Client 断连或 Host 卸载会释放相应资源。

| 工具 | 功能 |
| --- | --- |
| browser_status / browser_tabs | 当前连接和活动标签；标签列表、新建、切换、关闭 |
| browser_navigate | 打开、前进、后退、刷新 |
| browser_snapshot / browser_inspect | 有界页面语义、元素引用、DOM、矩形、样式与图片来源 |
| browser_console | 公开 native console-message 事件的有界记录 |
| browser_network | owned guest 的真实网络捕获、头/状态和正文读取 |
| browser_cap | 进阶能力：capabilities / emulate·clearEmulation / cookies / accessibility / CDP input（截图见下） |
| browser_act / browser_screenshot | 原生输入动作和模型可见 PNG（视口截图） |
| browser_annotations | 用户确认后的会话反馈读取与处理标记 |
| browser_stop | 撤销当前控制并请求停止网络捕获 |

已有元素批注只写当前会话草稿，需用户审核后发送；插件不自动发送消息。具体流程见 [批注说明](docs/annotations.md)。

## 设置
面板工具栏的齿轮可打开轻量设置（本地持久化）：
- **需要时自动打开面板**（默认开）
- **新标签默认主页**
- **最大标签数**

网络抓包预算（请求数/单正文/总正文）仍在调用 `browser_network` 时按需指定。偏好存于本机 `localStorage`，后续可平滑迁到 DSH 设置页。

## 边界

- DOM 快照与 inspect 仍限主框架普通 DOM，不穿透 iframe/Shadow DOM，不读取表单实时值或可编辑内容，不暴露任意页面/Node 脚本工具。
- `browser_cap` 的设备模拟 / Cookie / 无障碍 / CDP 输入已接入；**全页/元素截图（CDP `Page.captureScreenshot`）在标准 Electron webview 上会挂起**（Codex 靠 paint lease 才有），因此 `cap.screenshot` 快速返回“不支持”，截图请用 `browser_screenshot`（视口）。
- Network 记录真实 CDP 事件，不拦截、重放或另发请求；当前 scope 是 **owned-root-target**，不承诺跨进程 iframe、worker 或 WebSocket 消息内容。捕获前的请求不能回溯。
- 默认最多 200 个请求 ID、每正文 1 MiB、总正文 8 MiB；上限 500、2 MiB、16 MiB。超限/缓存缺失/分离会给出明确状态；大响应分页，UTF-8 JSON 保持在通道预算内。
- 保留宿主既有 lease、工作区分区、页面准入、权限和下载策略。分区可能共享站点存储，会话路由隔离不等于账号隔离。桥不提供任意 CDP、Cookie 导入或系统控制 API。
- 取消不回滚已发生的网页行为。挂起或晚到的捕获启动会清理自身资源，不会接管其他页面或中断其他 debugger。
- 研究参考和原始应用 bundle 不进入分发包；研究报告留在源码工作区。宿主补丁只针对精确核查过的版本，新版本需要重新适配。

## 验证与资料

`npm run check` 构建 Host/Client、检查 lazy Client factory、Bundle 和 11 个工具合约，运行页面、协议、网络记录、lease、桥和安装器测试。受控 DOM/假 debugger 测试均有明确边界。

可选 `npm run test:chromium`、`npm run test:ui` 使用隔离测试页面/profile，不是产品运行依赖。真实 Electron 网络集成用 `ELECTRON_PATH=/absolute/path/to/Electron npm run test:electron-network`，只启动隔离测试应用/profile。当前已通过 12 项真实流量、正文和生命周期检查，不能代替更新后的 DSH 实际加载验收。

完整功能清单见 [功能清单](docs/features.md)。行为要求见 [SPEC](SPEC.md)，来源及复用边界见 [资料来源](docs/provenance.md)，历史验收见 [验证说明](docs/verification.md)。采用源码参考适配，不宣称净室工程。
