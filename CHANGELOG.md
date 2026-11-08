# Changelog

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
- 双通道：`dsh-browser:network:v1`（兼容旧网络工具）+ `dsh-x-browser:cap:v1`（新能力）
- 仅绑定本插件合法 lease/guest，同一 sender 校验
- 可恢复安装：原始归档备份 + manifest，支持回退
