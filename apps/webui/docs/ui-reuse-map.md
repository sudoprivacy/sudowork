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

| WebUI 文件 | Sudowork 来源 | 现状 |
|---|---|---|
| ~~`src/client/components/SidebarNavItem.tsx`~~ | — | ✅ **已抽成共享包** `@sudowork/ui/components/SidebarNavItem`（纯展示、无 Electron；两端 import，webui 副本已删） |
| `src/client/layouts/AppLayout.tsx` | `sudowork/src/renderer/layouts/layout.tsx` | **App 专属（非重复）**：webui 裁剪版（移除 Titlebar/UpdateModal/DebugPanel/DeepLink/目录选择/ipcBridge 日志桥/租户 logo）。与桌面布局是**有意的不同产品面**，不共享——真要共享得先做数据端口抽象（见下）。 |
| `src/client/layouts/MainSider.tsx` | `sudowork/src/renderer/layouts/components/Sider.tsx` | **App 专属（非重复）**：webui 裁剪版（保留新会话/Agent/Skill/Cron，移除批量管理/本地知识库/安全中心/频道/团队/游客等桌面独有项）。同上。 |
| `src/client/layouts/SettingsSider.tsx` | `sudowork/src/renderer/layouts/components/SettingsSider.tsx` | **App 专属（非重复）**：webui 重写为固定四项（用户中心/MCP/显示/关于）。同上。 |

> **Stage 3 结论**：真正的逐字节重复只有「样式 + SidebarNavItem」，均已抽进 `@sudowork/ui`。布局是两端**有意分化的产品面**（不是拷贝），要共享它们（及数据耦合的 pages）需要**数据端口抽象**（renderer 只依赖一个 port，桌面注 Electron-IPC adapter / web 注 HTTP adapter）——那是独立的大重构（桌面渲染层 ~822 处 `ipcBridge` 调用），不属"消拷贝"范畴。新的共享展示型组件应从 `@sudowork/ui` 起步、不再拷贝。

## 后续 Task 计划摘取（占位，实施时更新本表）

- Task 5：`pages/guid`（新会话页与选择器）、`pages/conversation`（消息列表/Sendbox）、`components/Markdown.tsx`、`Sendbox.tsx`
- Task 6：`pages/agents`、`pages/skills` 卡片/详情/表单组件
- Task 7：`pages/cron` 表单与详情
