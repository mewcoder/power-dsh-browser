# PowerDSH 品牌规范

PowerDSH 是面向 DSH 的插件系列品牌，与现有 `power-dsh` 项目保持品牌传承。每个插件都应完整、稳定、可审查、可恢复；系列归属不改变各项目的代码与生命周期边界。

## 命名

- 系列品牌：**PowerDSH**。
- 主项目：`power-dsh`，展示名 **PowerDSH**。
- 本项目与安装包名：`power-dsh-browser`，展示名 **PowerDSH Browser**。
- 系列扩展格式：`power-dsh-<capability>`，全小写、连字符、无 scope；未实现的能力不作为已发布产品列出。
- 本项目仓库：[mewcoder/power-dsh-browser](https://github.com/mewcoder/power-dsh-browser)。
- `package.json` 的 `dsh` 字段继续描述宿主接入要求，不因品牌更名改变接口含义。

## 显示

- 本插件在标题、面板和设置入口中统一显示 **PowerDSH Browser**，中英文一致。
- 系列签名使用 `by PowerDSH`；品牌标识与 Browser 能力名称保持同一层级关系。

## 质量门槛（每个插件都必须）
1. `npm run check` 全绿：构建、语法、lazy client factory、工具契约、行为测试。
2. 完整 README、SPEC、CHANGELOG；说明能力、边界、未验证项。
3. 许可与来源清楚：`THIRD_PARTY_NOTICES.md`、`licenses/`；不宣称净室原创。
4. 资源有界、失败可见、可取消、可回退；不静默伪造结果。
5. 国际化（中/英）、暗色适配、无障碍基本项。
6. 语义化版本，破坏性变更升主版本。
7. 宿主补丁类能力必须可备份、可恢复、有预检。

## 当前系列

- **PowerDSH**（`power-dsh`）— 现有增强项目。
- **PowerDSH Browser**（`power-dsh-browser`）— 会话共享浏览器面板 + Agent 工具 + 网络读取。
- 规划：`power-dsh-annotate`、`power-dsh-network`（按需拆分，未宣称已发布）。

## 设置页

插件设置入口统一命名为 **PowerDSH Browser**（中英文一致），位于「设置 → PowerDSH Browser」。本插件面板展示名也统一为 **PowerDSH Browser**。

## 更名与兼容

GitHub 仓库已更名为 `mewcoder/power-dsh-browser`，本地源码目录已迁移为 `power-dsh-browser`。旧 `dsh-browser` 入口仅作为指向新目录的兼容符号链接保留，支持现有会话、历史 manifest/恢复记录和预览路径。

历史验收中的旧名称，以及已安装桥接协议、ASAR 内路径、旧 manifest 标识和字节校验记录可保留原值，并明确标为历史或兼容性引用。品牌更名不等于这些协议已经迁移，也不等于新名称已完成安装验收；第三方原始仓库名称和许可证署名始终保持准确来源。
