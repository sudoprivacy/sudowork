# UI 摘取映射表（Sudowork → Sudowork WebUI）

依据计划 Task 4："从 Sudowork 摘取 Design tokens、Arco 覆盖、侧栏和通用容器，保留 Apache license header"。
所有摘取文件保留原 `Copyright 2026 SudoPrivacy / SPDX-License-Identifier: Apache-2.0` 头部。

## 样式 —— 已抽成共享包 `@sudowork/ui`（不再拷贝）

Stage 3 已将 4 个逐字节相同的样式抽进 monorepo 共享包 `packages/ui`，桌面与 webui **共同 import**、不再各存一份：

| 文件 | 现状 |
|---|---|
| `variables.css` / `base.css` / `markdown.css` / `arco-override.scss` | 移到 `packages/ui/src/styles/`，两端 `@import '@sudowork/ui/styles/*'`（桌面另含 `Markdown.tsx` 的 `?raw` 注入、`index.ts` 的 scss 引入，均已重指）。webui 旧副本已删。 |
| `src/client/styles/index.css` | 保留为 webui 专属入口（各 app 入口顺序不同，从共享包 import 上述 4 个） |

_（`SidebarNavItem.tsx` 两端已发散，暂不共享；layouts/pages 属数据耦合，走后续端口抽象。）_

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
