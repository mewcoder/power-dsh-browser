# 浏览器能力清单与验证状态（DSHX）

本页记录 `dshx-browser` 各能力的实现方式、实测状态与剩余差距。区分：**代码实现 / 已实测（真实 DSH 页面）/ 硬边界（宿主不支持）**。

## 工具（12 个）
- `browser_status` / `browser_tabs` / `browser_navigate` / `browser_snapshot`
- `browser_inspect` / `browser_console`
- `browser_network` — 真实 CDP 网络（主目标）：列表、请求/响应头、POST、响应正文、重定向、失败
- `browser_cap` — 进阶能力（见下）
- `browser_act` / `browser_screenshot`（视口，原生 capturePage）
- `browser_annotations` / `browser_stop`

## `browser_cap` 能力与状态
| 能力 | CDP/实现 | 实测 | 说明 |
| --- | --- | --- | --- |
| capabilities | 静态 | ✅ | 返回能力清单 |
| emulate / clearEmulation | Emulation.setDeviceMetricsOverride 等 | ✅ | 视口/DPR/UA/时区/媒体 |
| cookies | Network.getAllCookies/clearBrowserCookies | ✅ | 有界、可清空 |
| accessibility | Accessibility.getFullAXTree | ✅ | 有界扁平树 |
| input | Input.dispatchMouseEvent/KeyEvent | ✅ | CDP 鼠标点击已验证触发页面 |
| screenshot | Page.captureScreenshot | ❌ **硬边界** | 标准 Electron webview 上挂起（CDP_TIMEOUT）；Codex 靠 paint lease |

## 已部署形态
- 原生桥 `native/desktop-browser-bridge.js`：双通道
  - `dsh-browser:network:v1`（旧网络工具，行为不变）
  - `dshx-browser:cap:v1`（新能力）
- `native/preload-cap.cjs`：沙箱内联工厂，暴露 `dshDesktop.browser.cap`。
- 宿主桥以“全新补丁 asar（基于原始备份计算）+ 关闭窗口快速替换”方式部署，保留原始备份可恢复。

## 剩余差距（相对 NCode/Codex）
1. **截图（全页/元素）**：硬边界，需 paint lease 或自研运行时；当前仅视口 `browser_screenshot`。
2. **多目标网络**（OOPIF/Worker/WebSocket）：可用 `Target.setAutoAttach` + 各 session `Network.enable` 实现，需改原生桥 + 再部署一次。
3. **下载/上传**：下载用 main 侧 `session.on('will-download')`，上传用 `DOM.setFileInputFiles`；需原生桥扩展 + 部署。
4. **原始 CDP 直通**：安全敏感，默认不开；如需按白名单开放。

## DSH 生态内浏览器插件对照
| 插件 | 承载方式 | CDP | 完整 Network（头/正文/POST） |
| --- | --- | --- | --- |
| Nono-neko/dsh-browser | 自有面板 + **iframe** | ❌ | ❌ |
| wqty123/dsh-browser | 原生 webview + 多标签 + 虚拟光标 | ✅ 有 CDP 命令转发 | ❌ 无 debugger 事件订阅，故无网络记录 |
| LWJ007/dsh-browser-tabs | 外部 Chrome 标签选择器（MCP） | ❌ | ❌ |
| **本插件 dshx-browser** | 原生 webview + 宿主桥 CDP | ✅ | ✅ 头/正文/POST/重定向/失败 |

结论：截至本页，DSH 生态内**没有其它插件提供完整 Network 读取**；本插件是唯一实现。子目标网络（iframe/Worker）在 DSH 生态内尚无先例。

## 与 Codex / ZCode 的实现对照
| 维度 | Codex | ZCode / NCode | 本插件 |
| --- | --- | --- | --- |
| 页面载体 | 渲染进程真实 `<webview>` | 真实 `<webview>` | 真实 `<webview>`（DSH lease） |
| 引擎 | 自研 Chromium/Owl 运行时 | 标准 Electron | 标准 Electron |
| CDP 归属 | 宿主原生 | 主进程 `webContents.debugger` | 我方宿主桥内 `webContents.debugger` |
| Agent 网络 | 可选 raw CDP（三重门控） | **未暴露** | ✅ 头/正文/POST/重定向 |
| 注入运行时 | 有 | Playwright injected runtime | 无（不注入页面脚本） |
| 全页截图 | paint lease 原生接口 | 原生 capture | ❌ 标准 Electron 挂起 |

结论：ZCode 能做到的（标准 Electron + 主进程 CDP），本插件基本同层且 Agent 网络更强；Codex 的 paint lease / 网络策略属自研运行时特权，纯插件不可得。

## 验证限制
- 本轮在真实 DSH 页面实测了：网络、snapshot/act、emulate/clearEmulation、cookies、accessibility、input、capabilities。
- 主文档截图（`browser_screenshot`）在本环境偶发 `UnknownVizError`，属环境老问题。
- 未在真实页面逐项验证：多目标网络、下载/上传（尚未实现）。
