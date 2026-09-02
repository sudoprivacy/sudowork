# UI 摘取映射表（Sudowork → Sudowork WebUI）

依据计划 Task 4："从 Sudowork 摘取 Design tokens、Arco 覆盖、侧栏和通用容器，保留 Apache license header"。
所有摘取文件保留原 `Copyright 2026 SudoPrivacy / SPDX-License-Identifier: Apache-2.0` 头部。

## 样式（全量摘取）

| WebUI 文件 | Sudowork 来源 | 说明 |
|---|---|---|
| `src/client/styles/variables.css` | `sudowork/src/renderer/styles/variables.css` | Design tokens 唯一来源（亮/暗主题 CSS 变量），原样 |
| `src/client/styles/base.css` | `sudowork/src/renderer/styles/base.css` | 基础与 chrome 规则，原样 |
| `src/client/styles/markdown.css` | `sudowork/src/renderer/styles/markdown.css` | Markdown 主题，原样（Task 5 会话消息使用） |
| `src/client/styles/arco-override.scss` | `sudowork/src/renderer/styles/arco-override.scss` | Arco 组件覆盖，原样 |
| `src/client/styles/index.css` | `sudowork/src/renderer/styles/index.css` | 入口顺序调整为 arco.css → variables → base → markdown → arco-override |

## 配置

| WebUI 文件 | Sudowork 来源 | 调整 |
|---|---|---|
| `uno.config.ts` | `sudowork/uno.config.ts` | 保留 presets/transformers/rules/shortcuts/theme/preflights；filesystem 扫描路径改为 `src/client/**`；修正 card shortcut 抄写手误 |

## 组件

| WebUI 文件 | Sudowork 来源 | 摘取方式 |
|---|---|---|
| `src/client/components/SidebarNavItem.tsx` | `sudowork/src/renderer/layouts/components/SidebarNavItem.tsx` | 原样（无 Electron 依赖） |
| `src/client/layouts/AppLayout.tsx` | `sudowork/src/renderer/layouts/layout.tsx` | 裁剪：移除 Titlebar/UpdateModal/DebugPanel/DeepLink/目录选择/ipcBridge 日志桥/租户 logo（首版静态"Sudowork"标识） |
| `src/client/layouts/MainSider.tsx` | `sudowork/src/renderer/layouts/components/Sider.tsx` | 裁剪：保留新会话/Agent/Skill/Cron 菜单与对话-定时任务 Tab、用户区；移除批量管理、本地知识库、安全中心、频道、团队、游客模式；历史列表区为 Task 5 占位 |
| `src/client/layouts/SettingsSider.tsx` | `sudowork/src/renderer/layouts/components/SettingsSider.tsx` | 重写为固定四项：用户中心/MCP 服务/显示/关于；移除扩展 Tab、充值、成员、模型等全部范围外项 |

## 后续 Task 计划摘取（占位，实施时更新本表）

- Task 5：`pages/guid`（新会话页与选择器）、`pages/conversation`（消息列表/Sendbox）、`components/Markdown.tsx`、`Sendbox.tsx`
- Task 6：`pages/agents`、`pages/skills` 卡片/详情/表单组件
- Task 7：`pages/cron` 表单与详情
