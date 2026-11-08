# 功能清单（1.1.0）

状态：✅ 真机实测通过 ｜ ⚠️ 已实现但受限/实验 ｜ ❌ 不支持

## 浏览
| 功能 | 工具 | 状态 |
| --- | --- | --- |
| 会话内共享浏览器面板 | — | ✅ |
| 多标签（新建/切换/关闭，≤12） | `browser_tabs` | ✅ |
| 打开/前进/后退/刷新 | `browser_navigate` | ✅ |
| 页面文本 + 可操作元素快照 | `browser_snapshot` | ✅ |
| DOM 结构/计算样式/矩形/图片 | `browser_inspect` | ✅ |
| 控制台消息 | `browser_console` | ✅ |
| 视口截图 | `browser_screenshot` | ✅ |
| 按需自动打开面板 | 设置 | ✅ |
| 面板内设置（自动打开/主页/标签上限） | 设置 | ✅ |

## 网络（真实 CDP）
| 功能 | 工具 | 状态 |
| --- | --- | --- |
| 请求列表（状态/类型/时序） | `browser_network` list | ✅ |
| 请求/响应头 | read | ✅ |
| POST 请求体 | body(kind=request) | ✅ |
| 响应正文（分页） | body(kind=response) | ✅ |
| 重定向多跳 | list/read | ✅ |
| 失败请求 | list/read | ✅ |
| 子目标（OOPIF/iframe） | start(childTargets) | ✅ |
| WebSocket 生命周期 | list/read | ✅ |
| WebSocket 帧 | start(websocketFrames)+frames | ⚠️ 部分 Electron 为空 |

## 进阶能力（`browser_cap`）
| 功能 | 状态 |
| --- | --- |
| capabilities 能力清单 | ✅ |
| 设备/视口模拟（宽高/DPR/UA/时区/媒体） | ✅ |
| 清除模拟 | ✅ |
| Cookie 读取/清除 | ✅ |
| 无障碍树（有界） | ✅ |
| CDP 鼠标/键盘输入 | ✅ |
| 下载事件列表 | ✅ |
| 取消下载 / 清空 | ✅ |
| 文件上传 | ⚠️ 实验 |
| 全页/元素截图 | ❌ 标准 Electron 无 paint lease |

## 页面交互与批注
| 功能 | 工具 | 状态 |
| --- | --- | --- |
| 点击/填表/回车/滚动 | `browser_act` | ✅ |
| 停止 Agent 控制 | `browser_stop` | ✅ |

## 明确不支持（需自研内核）
- 全页/元素截图（paint lease）
- 原始 CDP 直通
- 请求拦截/改写
- 网络策略强制
- 页面接管/转移
- 注入页面脚本 / 任意 JS 执行
