# PowerDSH Browser

**让你和 Agent，在 DSH 里一起浏览网页。**

[![CI](https://github.com/mewcoder/power-dsh-browser/actions/workflows/ci.yml/badge.svg)](https://github.com/mewcoder/power-dsh-browser/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.1.1-blue)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

PowerDSH Browser 是 **PowerDSH** 系列的 DSH Desktop 浏览器插件。网页直接运行在聊天旁的浏览器面板里：你可以手动浏览，Agent 也能在当前会话中读取页面、点击、填写表单和截图。查看网页与操作结果，都在同一个可见的页面里完成。

与 `power-dsh` 沿用同一系列品牌，浏览器插件独立安装、独立维护，包名为 `power-dsh-browser`。

## 可以做什么

- **共享浏览**：每个会话一个浏览器面板，最多 12 个标签页，支持地址输入、搜索、前进、后退和刷新。
- **操作网页**：Agent 可以打开页面、点击按钮、填写表单、提交和滚动；你随时可以继续手动操作。
- **分析页面**：读取页面文字、可操作元素、DOM 结构、元素位置、计算样式、图片来源和控制台消息。
- **查看截图**：获取当前视口的真实截图，让支持图片输入的模型看到页面效果。
- **排查网络**：捕获真实请求，查看请求与响应头、POST 数据、响应正文、重定向和失败状态。
- **按需扩展**：通过 Desktop 桥提供设备模拟、Cookie、无障碍树、输入及下载管理等进阶能力。

普通浏览、页面分析、交互和视口截图使用 DSH 的公开接口。**网络与进阶能力需要额外安装 Desktop 桥**，安装方式见下文；能力可用性及限制见 [功能清单](docs/features.md)。

## 安装

当前支持 **macOS DSH Desktop 0.2.2-rc.1**，构建需要 **Node.js 22 或更新版本**。

```sh
git clone https://github.com/mewcoder/power-dsh-browser.git
cd power-dsh-browser
npm ci --ignore-scripts
npm run check
```

在 **DSH 设置 → 插件 → 安装第三方插件** 中安装本地项目目录。也可以运行 `npm pack` 生成安装包，再通过原生插件管理器安装或更新。

模型查看截图还需要宿主附件存储，以及支持图片输入的模型。浏览器面板依赖 DSH Desktop 的 Electron webview；普通 Web GUI 的能力范围见 [规格说明](SPEC.md)。

### 安装 Desktop 桥

需要 Network 或进阶能力时，先检查当前宿主是否受支持，再准备补丁：

```sh
node scripts/desktop-bridge.mjs --check
node scripts/desktop-bridge.mjs --prepare
```

准备阶段会生成原始归档备份、补丁和 manifest，不修改已安装应用。核对输出后，**完全退出 DSH**，再用生成的 manifest 安装：

```sh
node scripts/desktop-bridge.mjs --apply --manifest /absolute/path/to/manifest.json
```

安装器只接受核对过的精确版本、构建与文件散列；拒绝在 DSH 运行时替换归档。保留 manifest 和原始备份，可按同一记录恢复。完整预检、安装、恢复流程见 [Desktop 桥说明](docs/desktop-bridge.md)。

## 开始使用

1. 在会话右侧栏打开 **PowerDSH Browser**，或让 Agent 打开一个网址。默认会在需要时自动打开面板。
2. 手动浏览，或直接向 Agent 描述任务，例如“读取这个页面的主要内容”“填写表单后截图”或“检查刚才请求的响应正文”。
3. 需要中止时停止 Agent 控制。取消会阻止后续动作，已经发生的网页操作仍然保留。

偏好统一放在 **DSH 设置 → PowerDSH Browser**：

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| 需要时自动打开面板 | 开启 | Agent 需要浏览网页时显示浏览器面板 |
| 替代 DSH 内置浏览器 | 关闭 | 使用本插件承接侧栏浏览器和聊天中的网页链接 |

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `browser_status` / `browser_tabs` | 读取状态，创建、切换和关闭标签页 |
| `browser_navigate` | 打开网址、前进、后退和刷新 |
| `browser_snapshot` / `browser_inspect` | 读取页面文字、元素引用、DOM 与计算样式 |
| `browser_act` | 点击、填写、回车提交和滚动 |
| `browser_screenshot` / `browser_console` | 获取视口截图与控制台消息 |
| `browser_network` | 捕获真实网络请求，读取头、请求体和响应正文 |
| `browser_cap` | 查询及使用 Desktop 进阶能力 |
| `browser_stop` | 停止当前会话的 Agent 浏览器控制 |

页面观察携带标签、文档和快照标识；导航或切换标签后需要重新观察，旧元素引用会失效。工具根据真实 Agent 执行上下文绑定会话。详细调用方式见 [Network 工具](docs/network.md) 与 [进阶能力](docs/capabilities.md)。

## 使用边界

- 网页内容作为不可信数据处理；操作只针对本插件持有的页面 lease，保留宿主的导航、权限和下载策略。
- DOM 快照和样式分析限主框架普通 DOM，不穿透 iframe 或 Shadow DOM。工具不提供任意页面脚本或原始 CDP 执行入口。
- 截图覆盖当前视口；全页和元素截图尚不支持。
- Network 只记录开始捕获后的真实流量，不拦截、重放或改写请求。子目标和 WebSocket 的覆盖受 Electron 实现限制。
- 页面存储分区可能共享站点登录状态；会话操作隔离不等于账号隔离。
- 文件上传等实验能力及未完成的真实 Desktop 验收，单独标注在 [功能清单](docs/features.md) 和 [验证说明](docs/verification.md) 中。

## 开发与验证

```sh
npm run check             # 构建、语法、Bundle/工具合约与受控行为测试
npm run test:chromium     # 可选：隔离 Chromium 页面测试
npm run test:ui           # 可选：隔离浏览器中的真实 React 面板测试
npm pack --dry-run        # 核对分发文件
```

当前 `npm run check` 通过 **191 项测试**。构建检查、受控集成测试、宿主加载和真实 Desktop 页面验证分别记录，不以其中一层替代另一层。具体环境、结果与未验证项见 [验证说明](docs/verification.md)。

## 更名与升级

项目现统一使用 **PowerDSH Browser / `power-dsh-browser`**。升级通过 DSH 原生插件管理器完成，避免同时保留新旧包的重复注册。

已有本地偏好在首次读取时迁移到新存储键，并保留旧记录。旧 Host 配置仍可读取、且新配置未被用户修改时，通过固定 revision 的原子操作迁移；旧配置不可读时保留新配置。桥接协议、历史 manifest、恢复记录和第三方来源中的旧标识按兼容要求保留。

## 文档与许可

- [功能清单](docs/features.md) · [行为规格](SPEC.md) · [实现原理](docs/architecture.md)
- [Desktop 桥](docs/desktop-bridge.md) · [Network](docs/network.md) · [进阶能力](docs/capabilities.md)
- [更新记录](CHANGELOG.md) · [验证说明](docs/verification.md) · [品牌规范](BRAND.md)
- [来源与适配边界](docs/provenance.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

采用源码参考与适配的开发方式，实际参考、复用和许可范围均有记录。项目采用 [MIT License](LICENSE)，第三方代码与资源遵循各自许可证。
