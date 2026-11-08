# DSHX 品牌规范

DSHX 是一套面向 DSH 的精品插件系列。每个插件都必须达到“出品即精品”：完整、稳定、可审查、可恢复。

## 命名
- 系列前缀：`dshx-`
- 格式：`dshx-<capability>`，全小写、连字符、无 `/`、无 scope
- 示例：`dsh-x-browser`、`dshx-annotate`、`dshx-network`
- `dsh` 平台属性放在 `package.json` 的 `dsh` 字段与文档中，不挤进品牌名

## 显示
- 显示名：`DSHX · <中文名>`（如 `DSHX · 浏览器`）
- 签名：`by DSHX`

## 质量门槛（每个插件都必须）
1. `npm run check` 全绿：构建、语法、lazy client factory、工具契约、行为测试。
2. 完整 README、SPEC、CHANGELOG；说明能力、边界、未验证项。
3. 许可与来源清楚：`THIRD_PARTY_NOTICES.md`、`licenses/`；不宣称净室原创。
4. 资源有界、失败可见、可取消、可回退；不静默伪造结果。
5. 国际化（中/英）、暗色适配、无障碍基本项。
6. 语义化版本，破坏性变更升主版本。
7. 宿主补丁类能力必须可备份、可恢复、有预检。

## 当前系列
- `dsh-x-browser` — 会话共享浏览器面板 + Agent 工具 + 网络读取
- 规划：`dshx-annotate`、`dshx-network`（按需拆分）

## 设置页
插件设置入口统一命名为 **X Browser**（中英文一致），位于「设置 → X Browser」。面板本身仍保留各自名称。
