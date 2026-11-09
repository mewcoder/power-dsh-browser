# 市场同类插件研究

本次按应用内浏览器、标签页、元素选择、批注和 Agent 操作反馈检索市场，并将可读取源码浅克隆到忽略的参考目录。只读取源码，没有运行参考项目的安装脚本、修改 profile 或给宿主打补丁。

| 项目 | 实际核对的提交与许可 | 读取模块与结论 |
| --- | --- | --- |
| [Nono-neko/dsh-browser](https://github.com/Nono-neko/dsh-browser) | `3b30aa740ece9cc2057cb9c81bf1e5df5f1bef3e`，Apache-2.0 | `BrowserPanel.tsx`、`StartPage.tsx`、`panel.module.css`：有完整标签栏、圆角地址栏、新标签页和评论区域。本项目适配其自有面板样式；原项目的中心列布局接管、Puppeteer 代理、iframe 承载、编辑器和更新功能不搬入。 |
| [zhxnix/dsh-sidebar-annotations](https://github.com/zhxnix/dsh-sidebar-annotations) | `c6d04864ee386010359ac73a7e94b67a4a0e1706`，MIT | `lib/picker.js`、`src/client.js`：元素选择、引用信息、编辑期间手势锁定和会话批注。本项目改编 picker 并适配当前草稿 API；不采用自动发送 hook、全局输入区 DOM 操作和宿主补丁。当前项目进一步使用插件自有的 Host 拾取层，避免只在 guest 追加监听器无法拦住页面已有 window capture 监听的问题。 |
| [wqty123/dsh-browser](https://github.com/wqty123/dsh-browser) | `5c5eedcaa2e119b7997088de64ff4b27c16998f2`，MIT | `src/browser-electron/virtual-cursor.ts` 及运行时目录：具备原生共享浏览器、CDP、多标签与光标反馈。参考操作可视化机制；本项目使用自有 viewport 覆盖层，不纳入其额外 Electron 进程、bridge 安装器或完整 CDP 控制 Host。 |
| [LWJ007/dsh-browser-tabs](https://github.com/LWJ007/dsh-browser-tabs) | `79c624d4ff9e8e3deb65d481de56ca41c1687ab7`，MIT | 实际是 `/tabs` 外部 Chrome 标签选择器，通过 chrome-devtools MCP 获取页列表，再把 URL 放入 composer。它不是应用内多标签浏览器，只用来交叉参考输入草稿接口。 |

另一个搜索结果 `Shuffle-1992/dsh-browser-kit` 的 Git 克隆返回 Repository not found，GitHub API 请求受到速率限制；本轮没有取得其源码，不将搜索摘要当作已验证实现，也没有引用其代码。

许可证全文和实际改编说明见 [第三方声明](../THIRD_PARTY_NOTICES.md)。第三方旧版的安装方式、API 或实现策略不自动等于当前 DSH 发行版支持的接口；所有实际调用仍以本机 DSH 0.2.2-rc.1 核对和运行结果为准。

## 与本插件的对比

| 维度 | Nono-neko | wqty123 | LWJ007 | PowerDSH Browser 1.0.0 |
| --- | --- | --- | --- | --- |
| 承载 | iframe | webview | 外部 Chrome | webview |
| 多标签 | ✅ | ✅ | ❌ | ✅ |
| 完整网络（头/正文/POST） | ❌ | ❌ | ❌ | ✅ |
| 子目标/OOPIF 网络 | ❌ | ❌ | ❌ | ✅ |
| 设备模拟 / Cookie / 无障碍 | ❌ | ❌ | ❌ | ✅ |
| 批注 | 评论区域 | ❌ | ❌ | ✅ |
| 需宿主补丁 | 否 | 是 | 否 | 是（可恢复） |

**iframe 方案已明确排除**：iframe 没有主进程 `webContents`，拿不到 CDP；跨源时 DOM 不可读；大量站点通过 `X-Frame-Options`/CSP 拒绝嵌入；也无法控制导航、下载、新窗口。详见[架构说明](architecture.md#二设计决策为什么必须是-webview不用-iframe)。

wqty123 虽也用 webview 并补丁宿主，但其桥只做 CDP **命令转发**、不订阅 debugger 事件，因此无法实现网络记录；本插件是 DSH 生态内唯一提供完整网络读取的实现。
