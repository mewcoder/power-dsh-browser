# Changelog

## 未发布

### 品牌更名

- 本项目统一更名为 `power-dsh-browser`，展示名与设置入口为 **PowerDSH Browser**，系列品牌为 **PowerDSH**，与 `power-dsh` 项目保持品牌传承；仓库链接统一为 [mewcoder/power-dsh-browser](https://github.com/mewcoder/power-dsh-browser)。
- 统一包/Bundle/Client/RPC/侧栏与设置身份，新设置键支持从旧键迁移；旧 Host 配置仍可读时用固定 revision 原子导入，不覆盖新用户偏好。
- GitHub 仓库和本地源码目录已更名；旧目录保留兼容符号链接。原生插件管理器已启用新包并移除旧依赖别名；191项检查和真实 Desktop 页面/Network 冒烟通过，具体范围见验证说明。
- 品牌更名不直接改写既有宿主桥协议、ASAR 路径、旧 manifest 标识或历史校验记录。

## 1.1.1

修复 1.1.0 移除批注时引入的回归，并补上防复发防线。

### 修复
- 侧栏注册临时失败后重置同步状态，同一设置的后续通知可以重试，避免浏览器入口持续缺失。
- 设置开关不再被宿主 ConfigForm 卡死：此前 `status !== 'ready' || writable !== true` 门槛在表单未就绪时让全部开关永久禁用（默认值也无法显示）。现在表单就绪且可写时走宿主文档（权威），否则回落到本地偏好存储；保存始终镜像到本地，新增 `subscribeSettings` 通知使侧栏注册在两条路径下都即时切换，注册失败不污染通知链。
- 设置开关的轨道和滑块补充 `corner-shape: round`，避免宿主全局超级椭圆样式使其变形；键盘焦点圈使用宿主 focus-ring token。
- 设置 → PowerDSH Browser 修复空白页：通过稳定回调保留 Host ConfigForm 的方法接收者，避免 React 外部 store 读取/订阅时抛错；设置页与图标注册跟随宿主 slot 生命周期。
- 修复默认关闭「替代 DSH 内置浏览器」时首次加载未注册浏览器入口的问题。
- 恢复 `client.js` 面板 `controls.current` 赋值：此前地址栏、前进/后退/刷新、标签管理、停止与重连按钮全部静默失效（Agent 工具链路不受影响）。
- 移除 `run()` finally 中残留的 `setMarkerRevision` 调用：此前每个非被动命令完成后产生未处理 ReferenceError。

### 修复（测试）
- `scripts/ui-smoke.mjs`、`scripts/chromium-smoke.mjs`、`test/fixtures/ui-preview.js` 移除对已删除批注模块的引用；`test:ui` 恢复可用并新增后退/前进/刷新工具栏检查，`test:chromium` 恢复可加载。

### 新增
- **面板视觉对齐内置浏览器**：标签改胶囊形、工具栏按钮改圆形、地址栏加高、空态简化为单行提示 + 快捷链接，全部经公开 `--dsw-alias-*` 主题 token 实现（不复制内置样式表）；工具栏新增"在系统浏览器打开"按钮（与内置浏览器同为 `window.open` 通道）。
- **替代 DSH 内置浏览器开关**（默认关闭）：开启后面板以扩展优先级注册宿主 `browser` kind，内置浏览器类型被遮蔽（关闭开关自动恢复），侧栏只剩一个浏览器；接管卡片显示原生文案「浏览器」与宿主 UI 套件的浏览器图形（`GuideArtworkBrowser`），新建菜单不再出现内置卡片（guide 列表只取各 kind 的生效类型）。聊天链接（宿主 `linkOpening: "sidebar"`）经 `openTab("browser", { params: { url } })` 复用本面板，`multiple: false` + 导航参数驱动面板内新标签。统一在「设置 → PowerDSH Browser」切换；Client 外部依赖在 `react` 之外新增宿主提供的 `@deepseek-ai/dsh-client-ui-primitives`，不打包副本。
- `check.mjs` 校验开发脚本相对导入完整性，坏 import 在 check 阶段即失败。
- `check.mjs` 断言 native 桥内自包含的抓包预算上限与 `constants.js` 的 `NETWORK_BUDGETS` 一致：双份拷贝没有运行时握手，漂移只在 check 阶段可拦。
- `test/client-panel.test.mjs`：happy-dom 中渲染真实 BrowserPanel 走真实 Broker/RPC 的回归网（React UMD 未缓存时跳过），防止面板布线回归再次漏过 `npm run check`。

### 精简
- PowerDSH Browser 设置页按 PowerDSH 的行式布局调整：统一标题与说明字号、留白、细分隔线，右侧滑块开关；移除「新标签默认主页」和「最大标签数」两项设置；保存中阻止重复提交，失败显示对应行错误并恢复开关值。
- 移除浏览器面板的设置按钮、内嵌设置区域与对应状态，偏好统一在「设置 → PowerDSH Browser」修改。
- **移除产品不可达的 cap 截图**：工具 schema、`cap-client`、宿主桥（CDP `Page.captureScreenshot` 实现、dataUrl 大信封特例）与 preload 同步删除，`capabilities` 不再声明 screenshot。桥 build 升至 `2026-11-08.2`，旧桥会报 `BRIDGE_OUTDATED`，需重新安装桥。
- `settings` 删除无消费方的抓包预算键；抓包预算常量集中到 `constants.js`（native 侧保持自包含镜像并注明同步关系）。
- 删除 `SessionTabs` 死分支与未使用图标；`configForms` 由 `globalThis` 全局变量改为 slot 显式注入；`Broker` 请求取消逻辑去重。
- 代码复核移除残留死代码：`LIMITS` 无消费方的 `text`/`elements` 字段、`controls.current` 未被读取的 `signal` 字段、仅模块内部使用的 `fail`/`pageRuntime`/`normalizeHostSettings` 改回私有、ui-preview 失去调用方的 `agentForSession` helper。

## 1.1.0

重构与清理版本，功能对齐 1.0.0 并移除批注。

### 移除
- 批注功能整体移除（元素选取、批注存储、引用片、`browser_annotations` 工具）。后续将以独立模块重新实现。

### 重构
- `client.js` 拆分：`locale.js`（文案）、`cursor-asset.js`（光标资源）、`agent-cursor.js`（光标/涟漪组件）、`use-panel-settings.js`（配置同步）。
- 新增 `constants.js`：标签数上限等常量单点定义，Host schema / Client / 标签管理共用。
- 宿主桥新增 `build` 版本标识与客户端校验：桥过旧时报 `BRIDGE_OUTDATED`，不再静默失败。

## 1.0.0

第一个稳定版。目标能力对齐 ZCode / Qoder 级别的应用内浏览器，网络能力更强。

### 浏览
- 会话共享的 Electron webview 面板，每会话独立、最多 12 标签
- 打开/前进/后退/刷新、地址栏、标签管理、按需自动打开面板
- 页面快照（有界文本 + 可操作元素）、DOM/样式/矩形/图片检查
- 控制台（原生 console-message 有界记录）
- 视口截图（原生 capturePage，含失败重试）

### 网络（真实 CDP）
- 请求列表、请求/响应头、POST、响应正文、重定向多跳、失败状态
- 子目标捕获（`childTargets`）：跨进程 OOPIF 子会话可独立取正文
- 有界预算：请求数 / 单正文 / 总正文，UTF-8 分页
- 页面内 WebSocket 生命周期记录（帧为 experimental）

### 进阶能力（`browser_cap`）
- 设备/视口模拟与清除（宽高、DPR、UA、时区、媒体）
- Cookie 读取/清除
- 无障碍树（有界扁平）
- CDP 鼠标/键盘输入
- 下载事件追踪、取消、清空
- 文件上传（experimental）

### 已知边界
- **整页/元素截图不可用**：标准 Electron webview 无 paint lease，`cap.screenshot` 直接返回不支持；请用视口截图。
- WebSocket 帧在部分 Electron 版本可能为空（experimental）。
- 不提供原始 CDP 直通、请求拦截改写、网络策略强制、页面接管（需自研内核）。
- 不注入页面脚本，不执行任意 JS。

### 宿主桥
- 双通道：`dsh-browser:network:v1`（兼容旧网络工具）+ `dsh-x-browser:cap:v1`（新能力）。此行是当时的历史记载，保留原协议文字；当前实际兼容通道见 [架构说明](docs/architecture.md#31-双通道)，不因品牌更名直接替换。
- 仅绑定本插件合法 lease/guest，同一 sender 校验
- 可恢复安装：原始归档备份 + manifest，支持回退
