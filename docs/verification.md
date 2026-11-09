# PowerDSH Browser 验证说明

本页保留各版本实际验收记录。旧包名、旧设置入口名、历史绝对路径和宿主注册标识按当时证据保留；它们不是当前品牌名。当前品牌更名的验收范围见下一节。

## 2026-11-09 PowerDSH Browser 更名

- 包名、Bundle/Client 模块 ID、Host/Client RPC 包前缀、侧栏与设置注册、Locale、设置存储键、测试夹具、打包元数据和当前文档统一更名。英文、中文展示名与设置标题均为 PowerDSH Browser。
- GitHub 仓库实际更名为 `mewcoder/power-dsh-browser`，本地 origin 已核对为新 URL。本地目录迁移为 `power-dsh-browser`，旧 `dsh-browser` 入口为兼容符号链接，以支持现有会话、历史 manifest/恢复路径与两个演示服务。
- `npm run check`：191 项测试通过，0 失败、0 跳过。包含3项本地设置迁移检查及6项 Host 原子迁移检查，覆盖新配置优先、并发用户修改、缺失旧 namespace、缺失 CAS 支持和取消后的后续动作阻断。
- Host 迁移使用已核对的公开 ConfigForm `mutate(ops, expectedRevision)`，只在旧配置仍可读且新配置未定制时迁移。未将旧 namespace 不可读的情况当作迁移成功；本机旧 Host 个性化设置未独立读取验收。本地偏好新键保留旧记录可回退。
- `npm pack --dry-run` 的包名与文件名为 `power-dsh-browser` / `power-dsh-browser-1.1.1.tgz`，76个文件；不包含 `.reference`、`artifacts`、`node_modules`、`demos`。
- 原生插件管理器实际安装并启用新本地链接、移除旧依赖别名，全部返回 `application: applied`、`warnings: []`。Host 插件条目 `include:power-dsh-browser` 为 active；没有手写 profile、重启 DSH 或修改已安装宿主归档。
- 真实 Desktop：改名后工具能自动打开面板，恢复百度原站/仿真与 DeepSeek 原站/复刻四个标签；快照与能力查询正常。启动 Network → 刷新本地复刻 → 列出7条完成的真实 HTTP 200 请求 → 停止捕获成功，确认保留的旧 IPC 协议仍可用。
- 设置页标题及注册由真实 Client apply 的受控 React 测试验证；未取得宿主设置页视觉截图。此前其他版本测试结果保留为历史边界，不扩大本次验收范围。本次验收不包含 npm 发包或 GitHub Release。

## 检查层次

各层次相互独立，不能把其中一种替代其余层次：

| 层次 | 状态 | 实际覆盖 |
| --- | --- | --- |
| `npm run check` | 全部通过（191 测试零失败零跳过） | Host/Client 构建、语法、lazy Client factory、外部依赖仅 react 与宿主 primitives、十一工具合约、开发脚本导入完整性、桥抓包预算与 `NETWORK_BUDGETS` 同步，以及协议、标签、页面、设置、网络记录、lease、桥安装器与生命周期 |
| `test/client-panel.test.mjs` | 通过 | 真实 React BrowserPanel 经 ui-preview 适配器在 happy-dom 中渲染；走真实 Broker/RPC 链路验证地址栏提交驱动导航（controls 回归网）与非被动命令零未处理拒绝 |
| `npm run test:chromium` | 通过（本机 Chrome 实测，零失败） | 实际 Chromium 的页面 runtime、原生输入、截图、滚动与文档引用失效 |
| `npm run test:ui` | 通过（本机 Chrome 实测：9 项检查、零失败、零 console 错误，含后退/前进/刷新工具栏检查） | 实际 React BrowserPanel、SessionTabs、PageRunner 与 Broker 的渲染和交互；ElectronPage 用隔离 iframe 测试适配器替代 |
| DSH Desktop | 基本闭环及多标签已确认；1.1.0 曾引入面板手动操作回归，修复后建议复验一次手动浏览 | 原生安装、真实 guest、工具路由、页面输入、状态保留、旧引用拒绝与模型截图 |

## 2026-11-09 设置空白页修复

- 原因：SettingsPage 将 Host ConfigFormController 的 `subscribe` / `getSnapshot` 方法作为裸函数交给 React，丢失方法接收者后渲染报错；修复前实际 `settings.section` 检查中 `dsh-x-browser` 为 `active: false`。
- 修复：为外部 store 提供稳定的接收者保留回调；设置页与图标使用 slots.inject 跟随宿主声明生命周期。另修复 takeover 初始值与默认 false 相同、导致首次同步跳过浏览器类型注册的问题。
- 新增 `test/client-settings.test.mjs`：执行真实 Client apply 和 SettingsPage，用带接收者依赖的配置对象检查实际 React 渲染、Host 更新、点击保存、类型切换和清理。随 `npm run check` 实际执行；181 测试通过，无失败、无跳过。
- 原生插件管理器移除后重新安装本地链接成功，`application: applied`、`warnings: []`；实际 Client Inspect 确认设置页与浏览器主体注册均为 `active: true`。未获取实际设置页截图，视觉验收仍需在 Desktop 打开设置页确认；本次未重启应用、未更改宿主桥。

### 设置页样式对齐 PowerDSH

- 参考 PowerDSH 当时的设置页源码与 UI 规范，PowerDSH Browser（当时设置入口名为 X Browser）的设置页拆到 `src/settings-page.js`，使用自身 scoped CSS 对齐 16px/24px 标题、14px/22px 描述、16px 行留白、0.5px 分隔线和 36×20px 滑块开关。开关在右侧，样式随组件卸载；按用户后续要求移除「新标签默认主页」和「最大标签数」两项设置及输入框样式、草稿状态。
- 开关形状修正：核对当前安装包 ui-theme 的说明与 PowerDSH/原生 Switch 样式，轨道和滑块显式设置 `corner-shape: round`，避免宿主通配规则的 superellipse 使胶囊和圆形变形；焦点圈改用宿主 focus-ring token。修正后重新运行 181 项检查通过并经原生管理器应用；实际 Desktop 外观尚未截图验证。
- 更新现有设置页回归测试，检查页面只有两开关、没有输入框，以及真实 React 渲染、Host 更新、点击保存及拒绝保存时恢复已接受的值。`npm run check` 181 测试全部通过，无跳过。
- 原生管理器重新安装成功（`application: applied`、`warnings: []`），Client Inspect 确认设置页 `active: true`。未取得实际 Desktop 设置页截图，浅深主题和窄面板的视觉效果未实测；未改动 PowerDSH 项目。

## 2026-11-08 修复记录

1.1.0 移除批注的重构引入三处回归，均未被当时的 `npm run check` 发现（test:ui / test:chromium 依赖已删除的批注模块，本身无法加载）：

- `src/client.js` 恢复 `controls.current` 赋值。此前地址栏、前进/后退/刷新、标签按钮、停止与重连按钮全部静默失效。
- `src/client.js` 移除 `run()` finally 中残留的 `setMarkerRevision` 调用。此前每个非被动命令完成后产生未处理 ReferenceError。
- `scripts/ui-smoke.mjs`、`scripts/chromium-smoke.mjs`、`test/fixtures/ui-preview.js` 移除对已删除批注模块的引用，`npm run test:ui` / `test:chromium` 恢复可加载。

新增防线：

- `scripts/check.mjs` 校验 scripts/ 与 test/fixtures/ 中全部开发脚本的相对导入均指向存在的文件（模板字面量内生成代码除外），坏 import 在 check 阶段即失败。
- `test/client-panel.test.mjs` 以真实组件覆盖面板布线（见上表），进入 `npm test`；其依赖的固定版本 React/ReactDOM UMD 由 `test:ui` 首次运行缓存，缺失时该测试明确跳过（已缓存，现随 `npm test` 实际执行并通过）。

### 1.1.1 精简复核

代码复核发现的死代码已全部移除：`LIMITS` 无消费方的 `text`/`elements` 字段、`controls.current` 未被读取的 `signal` 字段、仅模块内部使用的 `fail`/`pageRuntime`/`normalizeHostSettings` 取消导出、ui-preview 失去调用方的 `agentForSession` helper。`check.mjs` 新增 native 桥抓包预算上限与 `NETWORK_BUDGETS` 的同步断言（双份自包含拷贝没有运行时握手，漂移只能在 check 阶段拦截）。修复后四层验证全部重跑通过：`npm run check`、`npm test`（client-panel 实际执行）、`test:chromium`、`test:ui`；真实 Desktop 的手动浏览复验仍待进行（见上表与下文）。

## Chromium 页面测试

macOS 自动尝试标准 Chrome/Chromium 应用位置，其他位置通过 `CHROME_PATH` 指定可执行文件。运行 `npm run test:chromium`。

脚本使用受控的 [表单页面](../test/fixtures/form.html)，检查真实 DOM 的可见标签快照、原生输入覆盖已有文本、点击提交后的渲染状态、替换元素后拒绝旧引用、文本域填写、真实 PNG、视口滚动和完整导航后旧文档引用失效。输入通过测试浏览器 CDP 执行，不直接调用 Electron webview。

## React 界面测试

运行 `npm run test:ui`。它编译实际组件，在隔离 Chromium 中以真实鼠标和键盘操作地址栏、标签栏，并验证后退/前进/刷新按钮驱动真实导航历史。测试只替换 ElectronPage 的环境适配器，不另画一套浏览器界面。

- 核对 400/720px、浅色的新标签页布局：根节点、页面和工具栏均无横向溢出。
- 验证新建、切换、关闭标签后页面文字保留。
- 通过真实 Host 工具走 Broker 到 PageRunner 的快照往返。
- consoleErrors 为空；截图、布局尺寸与源码 SHA256 写入忽略的验证目录。

首次运行下载固定版本 React/ReactDOM 18.3.1 UMD，仅缓存于忽略的开发验证目录，并校验固定 SHA256；它们不加入项目依赖或插件分发。临时 Chrome profile、loopback 服务只用于测试，报告确认浏览器与服务均已退出。这不是替代 DSH GUI，也不证明真实 Electron 焦点和宿主编辑器实现的全部行为。

## Desktop 实际证据

- 经用户明确授权，0.1.0 通过原生管理器安装启用，完成导航、快照、原生填写、点击提交、读取提交结果、截图进入模型与停止控制。
- 0.2.0 经原生管理器移除旧包再安装启用，之后继续使用同一项目的本地链接。没有手写 profile、修改宿主发行包或运行第三方桌面补丁。
- 工具确认真实 Desktop 的 MDN 标签；受控表单标签内填写姓名后切换标签再切回，提交结果仍包含原文字，证明 guest 状态保留。
- 携带旧表单 tabId 在另一标签发出无害滚动得到 `STALE_TAB`；切回后复用旧代次得到 `STALE_DOCUMENT`；重新快照后点击正常。
- 一次空白页捕获产生黑色图片，不计为页面截图通过；工具随后确认那时确实为 about:blank。
- 检查中一次关闭已消失的旧标签返回 `TAB_NOT_FOUND`，新列表确认面板已成为另一新标签。
- 1.1.0 的面板手动操作回归（地址栏与工具栏按钮失效）属于 Client 侧缺陷，Desktop 宿主链路不受影响；修复后建议在真实 Desktop 复验一次手动浏览与断线重连。

## 尚未逐项实测

真实 Desktop 中多窗口/多会话同时操作、完整卸载后的资源统计、不同系统主题和语言、剪贴板、长时间卡住仍需进一步验收。受控验证不能替代这些系统行为。

"替代 DSH 内置浏览器"开关（默认关）的宿主行为同样待真实 Desktop 验收：开启后侧栏只剩一个浏览器条目（扩展 band 遮蔽内置类型）、聊天链接经 `openTab("browser", { params })` 复用本面板并新开内部标签、关闭开关后内置浏览器类型恢复；文件类资源链接（`openResource` 路径）是否受接管影响需一并确认。

当前是一版可用的浏览器与内部多标签实现；不宣称已经拥有 Codex 的完整 AX/iframe/Shadow DOM、样式调整、完整 Agent 光标动画或定制网络后端。
