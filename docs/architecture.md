# 实现原理（1.0.0）

本页说明 PowerDSH Browser（`power-dsh-browser`）为什么这样实现、各层如何协作、边界在哪里。架构说明保留 1.0.0 的设计背景；宿主桥的旧协议字符串是兼容标识，不能按展示品牌直接改写。

## 一、整体架构

```
Agent 工具 (Host)
   │  tools.register / Typert RPC
   ▼
Host 进程：Broker（会话路由、epoch、超时、取消）
   │  Typert RPC（connect / poll / reply）
   ▼
Client（浏览器面板）：SessionTabs → PageRunner → ElectronPage
   │  每个标签一个 <webview>，绑定 DSH 发的 lease
   ▼
DSH 主进程：DesktopBrowserGuests（lease / partition / guest 准入）
   ▲
   │  宿主桥（安装进 main）：IPC handler + webContents.debugger
   └── dshx-browser:cap:v1 / dsh-browser:network:v1
```

关键点：**Agent 不直接碰 webview**。所有操作经 Host→Client→自己的 guest；网络/进阶能力经宿主桥在 main 进程用 CDP 执行，且只认**本插件自己 lease 的 guest**。

## 二、设计决策：为什么必须是 webview，不用 iframe

**iframe 方案已明确排除。** 理由：

1. **拿不到 CDP**：iframe 没有对应的主进程 `webContents`，也就没有 `debugger`。网络、控制台、设备模拟、无障碍全部不可得。
2. **跨域即失效**：跨源 iframe 内 DOM 不可读（同源策略），无法做快照/检查/操作。
3. **站点直接拒绝**：`X-Frame-Options` / `frame-ancestors` 会让大量站点无法嵌入（含主流网站）。
4. **无导航/下载/新窗口控制**：没有 `setWindowOpenHandler`、`will-navigate`、`will-download`。
5. **输入不精确**：无法可靠派发原生输入事件。
6. **隔离不可控**：无法使用独立 session/partition，等于共用用户登录态。

因此采用 **Electron `<webview>` guest + DSH lease**，代价是需要一次可恢复的宿主桥补丁。这个取舍是有意的：**能力优先于零安装**。

## 三、为什么需要宿主桥

DSH 公开给插件的只有 webview 的 `executeJavaScript / capturePage / sendInputEvent / 导航事件`。这些够做浏览与 DOM，但**拿不到网络**（需要 `webContents.debugger` 的 CDP 事件）。

因此加了一层**可恢复的宿主补丁**：
- 在 `lib/main.js` 的 `assertProductSender` 之后调用 `installDesktopBrowserBridge(...)`
- 在 `preload-app.cjs` 内联两个自包含 CJS 工厂（sandbox preload 不能 `require` 相对模块）
- 只注册两个固定通道，不开放任意 CDP

## 四、宿主桥内部

### 3.1 双通道
| 通道 | 用途 |
| --- | --- |
| `dsh-browser:network:v1` | 旧网络工具，只允许 status/start/list/read/body/frames/clear/stop |
| `dshx-browser:cap:v1` | 新能力：网络 + screenshot/emulate/cookies/accessibility/input/downloads/upload |

两通道共用**同一个 handler 逻辑、同一个 network service、同一套 lease/sender 校验**。legacy 通道拒绝非网络操作。

`dshx-browser:cap:v1` 与 `dsh-browser:network:v1` 是更名前已使用、为兼容已安装桥而保留的协议名称，不是 PowerDSH Browser 的当前包名。历史变更记录中的 `dsh-x-browser:cap:v1` 保持原文；此处按当前代码核对为 `dshx-browser:cap:v1`。ASAR 内的 `lib/dsh-browser-bridge/` 路径及旧 manifest 标识同样按兼容要求保留，不能靠品牌替换改变其字节校验与恢复关系。

### 3.2 认证
每次请求：
1. 先做**结构校验**（字段白名单、类型、长度、边界）——在碰认证/lease/CDP 之前
2. `assertProductSender(event)`：只接受主窗口主框架
3. `browserGuests.leases.get(lease)` 且 `entry.owner === event.sender`
4. guest 未销毁

客户端**不能**传 webContents id；lease 是唯一凭据，来自 DSH 的 acquire。

### 3.3 网络录制器
- `Network.enable` + 事件订阅，**只观察不拦截**（不重放、不改写）
- 记录 `requestWillBeSent / responseReceived / loadingFinished / loadingFailed`
- ExtraInfo（附加头）用**每请求有序队列** + `hasExtraInfo` 标志关联；旧跳/乱序不猜
- 正文：`getRequestPostData` / `getResponseBody`，有界预算
- 重定向：同一 requestId 多 hop
- 子目标：`Target.setAutoAttach`（flatten）后，**每个子会话独立 Network.enable**，记录带 `sessionId/targetId/targetType`
- WebSocket：`webSocketCreated/Handshake/Closed` 建记录，帧存独立 ring（不进 list/read 预算）

### 3.4 一次性 CDP 能力
`withDebugger(guest, fn)`：
- 若 debugger 已被占用（正在抓包）→ `CDP_BUSY`，**绝不抢占**
- 否则 attach('1.3') → 执行 → finally detach
- 每命令 8s 超时 → `CDP_TIMEOUT`

用于 screenshot/emulate/cookies/accessibility/input/upload。**不执行页面 JS**（无 Runtime.evaluate）。

## 五、安全边界（为什么这样设计）

| 决策 | 原因 |
| --- | --- |
| 只绑自己 lease | 不碰别的插件/页面，不扫 DOM、不抢 debugger |
| 白名单操作 | 不暴露任意 CDP；原始 CDP 需单独安全策略 |
| 结构校验先于认证 | 恶意 payload 不触达宿主能力 |
| JSON < 60k（截图 5.4M） | 防止通道被大对象撑爆 |
| 错误码白名单 | 不泄露路径/堆栈 |
| 不注入页面脚本 | 页面内容是不可信数据，避免被诱导执行 |
| 快照/inspect 有界 | 不返回整页 outerHTML、不读表单值 |

## 六、会话与生命周期

- **每会话独立**：面板与标签按 sessionId 隔离；Host 只从 `exec.agent.session.id` 取身份
- **Broker**：一个会话一个 panel，多个窗口会 `AMBIGUOUS_PANEL`；epoch 递增使旧请求失效
- **标签 fence**：`tabId/documentId/snapshotId/generation`，导航后旧引用作废
- **按需打开**：工具需要面板但离线时，Host 记一个短时 demand，Client 轮询消费一次并 `openTab`（消费即清，避免边框反复闪）
- **清理**：关闭标签/面板/断连/宿主退出 → 释放 lease、停止抓包、dispose debugger

## 七、能力分层（与 Codex/ZCode 的界限）

| 层 | 谁能做 | 我们 |
| --- | --- | --- |
| 标准 Electron webview + 主进程 CDP | ZCode、Qoder | ✅ 已做到，网络更强 |
| 自研内核特权（paint lease 截图、网络策略、页面接管） | Codex | ❌ 做不到 |

所以：**视口截图有、整页长图没有**；**网络/子目标/OOPIF 有、原始 CDP 没有**。

## 八、可恢复性

- 安装前备份原始 `app.asar`（`f21d83…`）
- 补丁基于原始归档重算，manifest 记录每个模块哈希
- `artifacts/restore-original.sh` 一键还原（关闭 DSH 后执行）
- 所有部署脚本都有哈希校验与失败中止

## 九、已知限制

- 整页/元素截图：标准 Electron 无 paint lease，`cap.screenshot` 快速返回不支持
- WebSocket 帧：部分 Electron 版本不向根会话推送，可能为空
- 跨进程 Worker 网络：支持但未在真机证实
- 主文档正文可能因 Chromium 检查器缓存淘汰而不可读（会明确标注）
