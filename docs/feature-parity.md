# 浏览器功能对照与批注集成契约

本页区分源码观察、可集成模块、受控验证和真实 Desktop 验证。批注模块已完成受控验证；本页不将其等同于真实 Desktop 页面上的视觉/输入验收。主浏览器实现的导航、会话路由、截图和多标签验证由主实现记录。

## 来源与复用

遵循用户指定 Craft Anything 技能的源码优先路径：直接读取已提供源码，没有安装 Rust/CLI/MCP，也没有构造工具 evidence id。以下为本项目源码定位线索。

| 证据 | 直接观察 | 对本实现的影响 |
| --- | --- | --- |
| Codex 桌面应用 26.1103.32239，异步模块 620182 | 注释工具栏包含 `onAddToComposer`、`onDiscard`、`onExit`、`onSubmit`、`markersVisible`、`pendingAnnotationCount`；页面状态具有 comment 模式与浏览模式 | 保留“选取→标记→填写→加入输入”的用户流程；本实现不接自动提交 |
| 同版异步模块 622516 | 注释入口和批量工具依赖 `browserHost`、工具栏能力、会话及懒加载组件 | 不整体搬运私有 App bundle 或假定其消息总线在 DSH 可用 |
| ChatGPT Browser 插件的 tab mention 文档 | 引用携带页签、会话、标题和 URL；匹配变化时不能悄悄换目标 | 卡片保留捕获页面 URL/标题；明确选择器是捕获时提示，不提供跨导航的可执行引用 |
| `zhxnix/dsh-sidebar-annotations`，提交 `c6d04864ee386010359ac73a7e94b67a4a0e1706`，MIT | 独立 picker 使用透明全视口捕获层、临时关闭层 hit testing 查找目标、window capture、pointerdown 锁定、编辑期间保持拦截及完整清理 | [选取模块](../src/annotations.js) 适配上述实现结构，保留完整 MIT notice；增加 token/代次、轮询、执行期限、有界摘录及拒绝正文根节点。没有复用发送 monkeypatch、全局样式、宿主正文查询或安装脚本 |
| DSH 实际发行包 `@deepseek-ai/dsh-client-ui-conversation` 0.2.2-rc.1 | `SessionInputShell.actions` 明示 public provide-channel；`captureInsertion` 捕获带 draftRev 的范围，`insertText` 检查冻结/销毁/版本并使用编辑器插入；`persistDraft` 提交持久回调 | [草稿适配器](../src/annotation-ui.js) 使用公开 InputActions，保留已有引用片和引用块；不用整篇 `setDraft` 替换 |
| 同版 `@deepseek-ai/dsh-api-session-controller` | `sessions.scope(id)` 借用已保留的会话 scope；`scopeOf(scope)` 返回其绑定 ID；`conversation.input.for(scope)` 要求当前保留的 generation | 始终解析传入面板的会话，scope 缺失或不匹配时拒绝；不从“当前全局会话”猜目标 |

DSH 实际发行包源码定位：ui-conversation 的 public InputActions 为 15367–15394，整篇 setDraft 为 15452–15457，input.for 为 16127–16132；api-session-controller 的 scope/scopeOf 为 4029–4050。行号仅供本轮提取版本定位，不作为跨版本稳定接口。

详细总体来源与许可由 [资料来源](provenance.md) 统一登记；私有应用仅用于静态流程和依赖观察，其打包代码不进入本插件。

## 功能差异

| 体验 | 本轮模块行为 | 验证与剩余差异 |
| --- | --- | --- |
| 元素选取 | 主框架普通 DOM 的悬停边框、点击选取、数字 1 标记；插件自己 viewport 的宿主覆盖层接收真实指针，guest 只按固定脚本执行 elementFromPoint | 受控 DOM 覆盖完整 guest 捕获兜底序列及 host 坐标查询不派发 guest 事件；真实 Electron overlay hit testing、触摸和系统级事件待集成验收 |
| 原网页手势 | 必须同时挂载 `SelectionOverlay`：选取及编辑期间真实鼠标/键盘留在宿主 renderer，pointerdown 锁定目标，Esc 退出；guest 不接收选择输入 | 已测早于 picker 注册的 guest window capture listener 在坐标查询路径下收到 0 个输入事件。单靠 guest capture listener 不能拦住先注册的 window listener，故不作为产品保证；恶意修改 guest DOM 方法仍不构成脚本安全隔离 |
| 批注编辑 | 主题 token、局部内联样式、中英文、目标摘要、2000 字符批注、引用卡片预览和复制；不注入全局 CSS | 界面源码与 bundle 检查可验证；真实 Desktop 暗/亮主题、尺寸和键盘视觉验收尚需完成 |
| 会话输入 | 用户确认并发布批次后，通过公开 source + scoped insert-reference 插入真正的“N 条注释”引用片；插入范围折叠到选区末尾，保留原内容。引用片 owner codec 只序列化 batchId/revision/count，详情由会话授权工具读取 | 按实际 0.2.2 发行包确认完整协议；测试覆盖注册/插入/codec、跨会话本地 review 拒绝、刷新恢复和非法 ref；真实 Desktop 最终消息序列化待主实现验收 |
| 降级 | 不提供插入回调时显示复制引用；剪贴板失败时展开只读卡片并聚焦全选，用户可手动复制 | 无需 composer 服务仍可完成“选择→写批注→可复制引用”；复制自身受宿主剪贴板能力约束 |
| 取消与生命周期 | Esc、pointercancel、touchcancel、pagehide、beforeunload 清理 guest；controller 监听主框架导航/同文档导航、崩溃和 destroyed；过期 token 不影响后来的选取 | 受控测试覆盖 Esc、pointercancel、pagehide、导航、销毁与延迟安装；调用方必须在切页签、Agent 输入、关闭/卸载前取消或 dispose |
| 目标刷新 | 标记随选中 DOM 节点的滚动/resize 更新，节点被移除时隐藏边框；卡片是静态捕获 | 不重新定位选择器，不在导航后恢复标记，不承诺 DOM 被替换后仍标到同一语义目标 |
| 多批注/设计调整 | 页面可保留最多 20 个已保存标记，稳定编号不因删除重排；guest 只保存真实捕获节点并读取矩形，宿主 AnnotationMarkers 绘制数字；队列编辑/确认和归档由主实现负责 | 标记显隐不修改 guest DOM，已测 MutationObserver 0 records；不通过选择器找回节点。样式 tweak、原视图切换和权限教练提示仍有差异 |
| iframe/Shadow DOM/文本选区 | 不穿透；可选 iframe/自定义元素本身 | 不承诺跨框架、Shadow DOM 内部或独立文字 range 选取 |
| 截图附件 | 批注卡片包含有界文本与结构片段 | 不附批注截图、不自动采集整 DOM；已有浏览器截图工具是独立功能 |

## 有界数据与执行范围

[选取模块](../src/annotations.js) 每次运行的是固定、白名单为 `start`/`poll`/`cancel`/`hover`/`pick` 的 guest 脚本。hover/pick 只接受 0–20000 范围内的有限坐标；查询 DOM，不派发任何页面输入事件。调用者不能提供任意 JS；没有 page→host IPC、Node/Host eval 或跨插件 DOM 查找。

- 选取文本上限 800 字符，结构片段上限 1600，选择器 512，标题 200，URL 2048；批注 2000，整个卡片 9000。
- 结构片段先以最多 60 个节点、8 层深度及 1600 字符预算遍历再序列化，不先读取整棵子树的 outerHTML。拒绝 html/body 目标，跳过脚本、样式、模板及表单值/可编辑正文。
- URL 仅接受 HTTP(S)，去除用户名/密码；不读取 Cookie、表单实时值或页面控制凭据。
- guest poll 在返回 renderer 前再次按字段限长，renderer 只接收已知字段并再次校验。数据使用 JSON 字符串字段，控制符清理；转义膨胀时先缩减摘录再序列化，保持 JSON 完整。
- 选择器仅展示和复制，不作为自动动作授权；引用卡片明确标注网页内容不可信。不存在“读到网页文字后执行指令”的链路。
- 一次 guest 调用最多等待 2.5 秒，轮询串行且默认每 150ms 一次。取消递增本地代次、停轮询；晚到安装会按原 token 再次清理。已进入 Electron 的脚本不能强制终止，崩溃/永久无响应仍可能需关闭页面。

## 主实现集成契约

```js
import { createAnnotationController } from './annotations.js';
import { AnnotationPanel, SelectionOverlay, createAnnotationDraftInserter } from './annotation-ui.js';

// 每个自己持有的 ElectronPage 一个实例；也可在 active page 变化时销毁重建。
const annotations = createAnnotationController(page, {
  // 两个回调均可省略；AnnotationPanel 会直接订阅 controller。
  onChange: snapshot => {},
  onSelection: selection => {},
});

// 与面板所属会话绑定，ctx 需注入公开 sessions、conversation 服务。
const onInsertDraft = createAnnotationDraftInserter({
  sessions: ctx.sessions,
  conversation: ctx.conversation,
}, sessionId);

// 必须放在自己 position:relative 的 viewport 中，在自有 webview 上方。
React.createElement(SelectionOverlay, { controller: annotations, disabled: agentBusy, locale: 'zh' });
React.createElement(AnnotationPanel, {
  controller: annotations,
  locale: 'zh',           // 非 zh 前缀使用英文。
  disabled: !ready || agentBusy,
  onInsertDraft,          // 可省略，完整复制卡片降级仍可用。
});

// UI 清除/切换先同步取消，立刻隐藏宿主 overlay。
annotations.cancel();
// 在 Agent 输入、截图或手工导航前，必须等 guest 解除拦截并清理。
// unlock失败/超时要拒绝当前动作，不继续发送输入。
await annotations.unlock(); // cancelAsync() 为同义接口。
// 关闭页签、panel/context 卸载时，在释放 guest lease 前销毁。
annotations.dispose();
```

`page` 需要 `execute(script)`、`element` EventTarget、可选的 `status().ready`。只有 controller 内部可生成上述固定脚本，不能把 execute 暴露成 Agent 参数。

controller 还导出 `start(): Promise<void>`、同步 `cancel()`/`clear()`、`unlock(): Promise<void>`/`cancelAsync()`、`hoverAt(x,y): Promise<void>`、`pickAt(x,y): Promise<void>`、`getSnapshot()`、`subscribe(listener): unsubscribe`。unlock 等待在途安装及 guest 清理确认，失败抛错；hover 合并连续位置，坐标相对 webview viewport。快照是稳定冻结对象，形如 `{ phase: 'idle' | 'selecting' | 'selected' | 'error', selection: null | { id, tag, selector, text, outerHTML, title, url, truncated }, error: string }`。`start()` 对不可用页面返回 error 快照，不使 UI 留下未处理 rejection。

`AnnotationPanel` 可接受可选 `state` 替代内部订阅得到的快照；仍应传 controller 供按钮动作使用。组件卸载会 cancel，controller 的 dispose 仍由页签所有者负责。若复用同一个 React 组件切换 controller，建议 `key={tabId}`，避免不同页签的异步通知和编辑状态混合。

`createAnnotationDraftInserter(services, sessionId)` 返回同步 `(card: string) => true`。缺服务、scope 不一致或无公开动作时抛 `DRAFT_UNAVAILABLE`；冻结/过期插入被拒时抛 `DRAFT_CHANGED`。不会提交消息。组件捕获这些错误并保留可复制卡片。适配器只有受用户点击才被调用，不在选择或轮询时写草稿。

## 多标记与真正的 composer 引用片

本段是按用户最新反馈增加的批次工作流。上面的单卡片/AnnotationPanel 契约保留兼容；主界面可使用自己的紧凑编辑器，不必渲染旧 JSON 预览。

[标记控制器](../src/annotations.js) 增加 `setMarkers(items, visible=true)`、`setMarkersVisible(visible)`、`clearMarkers(dropNodes=false)`，均返回 Promise。items 只使用 `{id, number, selection.id}`，最多 20 个、ID 最长 80、编号为正安全整数。guest 内最多留 40 个实际捕获节点，不通过 selector 重新授权目标动作。快照增加 `markers: [{id, number, rect:{left,top,width,height}}]` 和 `markersVisible`；150ms 有界轮询读取当前位置。`start()` 与同步 `cancel()` 保留已保存标记，`unlock()` 清除选择层和标记并等待确认，清理失败可重试且拒绝继续原生动作；主框架导航清除捕获节点。标记 set/clear 带独立递增版本，晚到的旧 set 不能覆盖新 clear。

在自己 viewport 中加入 [AnnotationMarkers](../src/annotation-ui.js)，传 `{controller, onMarker?: id=>{}, disabled?}`。它只绘制插件自己的 DOM，故 marker 显隐/位置更新不触碰 guest 的 MutationObserver。单个未保存选择仍由原选择模式的边框处理。

[会话引用适配器](../src/annotation-composer.js) 根据实际 DSH 0.2.2-rc.1 公开包实现：

- input-trigger `registerSource` 在 1556–1570 注册/释放 owner；`serializeReference` 在 1249–1252 路由到 `owner.codec.serialize(ref, signal)`；该 codec 没有当前会话参数。
- input-trigger 1376–1379 使用 `scope.bail(scope, 'slash/input-insert-reference', {reference,span})`；ui-conversation 15735–15740 校验 phase/draftRev 后生成真实编辑器 reference chip，16201 接收公开事件，15911–15913 在用户正常发送时交给 owner codec。
- ui-conversation 22816 声明 `conversation.input.dock` 为 session list；19937–19955 给出官方 slot 注册样例。没有采用 sendSession monkeypatch、其他插件 DOM 或内部 React 组件。

精确集成接口：

```js
import { registerAnnotationReferenceSource, createAnnotationBatchInserter,
  AnnotationReviewDock } from './annotation-composer.js';

// 在插件 context 生命周期中注册一次；services 是公开依赖注入得到的服务。
const services = { sessions: ctx.sessions, conversation: ctx.conversation,
  inputTriggers: ctx.inputTriggers };
const referenceSource = registerAnnotationReferenceSource(services, {
  locale: 'zh', onReview: confirmedBatch => {},
});
ctx.effect(() => () => referenceSource.dispose());
const insert = createAnnotationBatchInserter({ ...services, referenceSource }, sessionId);

// 必须由明确用户点击触发：先取得 immutable confirmed batch 并成功 publish 到 Host，
// 再插入引用片。此模块不调用 confirm/publish/send/submit。
const result = insert(confirmedBatch); // {ok:true, mode:'chip'}
```

confirmedBatch 的边界为 `{version:1,sessionId,batchId,revision,confirmed:true,items}`，1–20 条，原始 UTF-8 JSON 不超过 32KB。适配器保留每条原 number、tabId/documentId，清理并限制 selection/comment。services 无 referenceSource 时返回 `mode:'text'`：插入最多 9000 字符的可读反馈及完整批次读取指引，不把整批 JSON 塞进正文；调用方需如实显示该降级。

引用片的 ref 是有界版本化自描述 metadata，含 batchId/revision/count，不含用户批注、页面正文、URL 或实际会话 ID。它只是定位信息，不证明批次已发布，也不赋予跨会话读取能力；codec 只输出 `browser_annotations read` 的 batchId/revision 指引，真正归档读权限由 Host 从工具执行会话确定。本地 openReference review 另外检查会话匹配。源码没有提供可靠的 codec 当前会话参数，故不能在 codec 中直接展开缓存的私密反馈。

重新注册 source 后，codec 无需内存 records 仍可解析已有草稿的合法 ref，避免 renderer 刷新使整条消息无法发送。非法或超限 ref 会拒绝。内存 review 内容丢失时 openReference 返回 false；Host 重启、归档过期或淘汰后，Agent 读取可能得到 NOT_FOUND，需用户重新加入批注，不声称详情永久存在。卸载 source 本身时宿主仍会按其既有语义拒绝缺 owner 的 reference 发送。

`AnnotationReviewDock({store,onReview?,onInsertBatch?,locale?})` 可作为公开 input.dock 的 review chip；它是审阅入口，只有用户点“插入草稿”才调用传入动作，不伪称待审内容已经随消息附件发送。主实现也可直接依赖真实 inline chip 和自己的 review UI。

## 验证记录与交接

[批注测试](../test/annotations.test.mjs) 当前新增至 19 项，保留此前 raw installation 及按 token cleanup retry 修复。使用现有 happy-dom 和真实固定 guest 程序；仅模拟页面布局/命中点和公开服务，不模拟结论。覆盖完整 guest 兜底手势拦截、host 坐标查询不触发早期 guest 事件监听、多标记/显隐/节点移除/导航/20条上限/0 DOM mutation、清理失败可重试、晚到安装及 unlock 等待、有界输出与私密控件跳过；引用片 source 插入及 metadata codec、stable number、跨会话 review、刷新后 ref 恢复、非法 ref、可读 text 降级、选区含文字/chip 的非覆盖插入和永不发送。

本轮 `npm run check` 已通过：构建、34 项测试（含 11 项批注测试）、lazy Client Bundle、仅 React 外部依赖与七工具静态合约均成功。

父代理另完成独立真实 Chromium 检查，报告 9/9 通过：网页在 picker 前注册 window pointerdown/mousedown/click/keydown 捕获，controller.hoverAt/pickAt 选中按钮时捕获计数为 0；await unlock 后 guest 捕获层计数为 0，原生点击能改变页面且先前捕获监听收到事件。这验证实际 Chromium 上固定命中查询不派发输入，以及等待解锁后可恢复正常输入；它没有模拟为 Host overlay 实际 UI 手动点击验收。

本页不声称测试已经在真实 Desktop 上执行了批注点击、宿主 composer 芯片保留、剪贴板权限、输入焦点、多窗口或 iframe。上述项目应在主实现集成后按 [验证说明](verification.md) 验收；测试替身、独立 Chromium、构建通过与真实 Electron 宿主行为保持区分。
