---
name: detect-cross-entry-duplicate-code
description: "检测本项目 Renderer 层'同功能不同入口'的语义重复代码（jscpd token 比对覆盖不到的）。当用户说'有没有重复代码'、'同功能多入口'、'扫一下重复'、'这个功能是不是在别处也写了一遍'时使用。典型信号：同一组 ipcBridge 调用 + 同一组领域 utils + 相同 UI 结构出现在不同文件。"
---

# 检测跨入口语义重复代码

本项目 Renderer 层存在「同功能不同入口」的复制粘贴实现（设置页 vs 业务页、Modal vs Drawer、不同路由页面）。jscpd 这类纯 token 比对工具对 **变量名重命名后的重复** 和 **大文件里的小比例重复** 会漏报，本方法用语义线索补齐。

## When to Use

当怀疑同一功能在多个入口有复制粘贴实现时使用。触发场景：
- 同一组 `ipcBridge.xxx.yyy` 持久化 API 出现在多个文件
- 同一组领域 utils（如 `getInstalledSkillDisplay` + `normalizeSkillVersion` + `resolveAvatarImage`）被多个文件同时引入做同类事
- 注释里出现 "same as / 对齐 / 和xx一致 / Provides the same" 等自首信号
- jscpd 报告某文件自身重复（内联写两遍），但实际是和另一文件的抽组件版本重复

## Procedure

1. **基线扫描**：`bunx jscpd`（项目根已有 `.jscpd.json`，配置 min-tokens:50/min-lines:8，ignore test/locales/types/assets，输出 `reports/jscpd`）。这能抓逐字复制，但抓不到重命名和大文件小重复。

2. **grep 注释自首信号**：
   ```bash
   rg -n -i 'same (as|experience)|对齐|和.*一致|参考.*实现|Provides the same|与.*相同' src/renderer
   ```
   注释里承认的复制是最强信号——`AssistantEditDrawer.tsx` 文件头直接写了 "Provides the same editing experience as the Settings > Agents drawer"。

3. **按共享 IPC 聚类**：
   ```bash
   rg -o 'ipcBridge\.\w+\.\w+' src/renderer --no-filename | sort | uniq -c | sort -rn | head -30
   ```
   找高频 IPC 方法，再 `rg -l 'ipcBridge.xxx.yyy' src/renderer` 看每个高频方法出现在哪些文件。同功能多入口几乎必然调用同一组持久化 API。

4. **按共享领域 utils 群聚类**：找同一组领域 utils 被多个文件同时引入做同类事。`rg -l 'getInstalledSkillDisplay' src/renderer` 逐个 utils 取交集。多个领域 utils 同时出现在两个文件，是语义重复的强指标。

5. **对比功能骨架而非逐字**：对每个候选文件对，列两侧的 状态变量集合 / 核心 handler（`handleSave`/`handleDelete`/`loadXxx`）/ UI 段落标题与顺序。忽略变量名重命名，只看语义角色是否一一对应。

6. **识别两种典型假阴性并补救**：
   - (a) **大文件小重复**：大文件里重复段占比小不触发阈值，靠第 2/3/4 步语义线索定位。（案例：`AgentModalContent.tsx` 2874 行里只有 ~200 行与 Drawer 重复）
   - (b) **内联 vs 抽组件**：一方抽了子组件（如 `SkillCard`），另一方内联写两遍，jscpd 只报内联方自身重复，需人工关联到另一文件。

7. **输出重复对照表**：每对文件列出 重复的功能模块名 / 文件A位置(行号) / 文件B位置(行号) / 差异类型(逐字|重命名|结构变形) / 重构建议(抽 hook|抽组件|提 utils)。

## 已知重复热点（排查起点）

- 通知平台配置表单群：`components/SettingsModal/contents/` 下 `DingTalk/Lark/Telegram/WeCom/WeChat/ZentaoConfigForm.tsx`（最大 817 tokens/100 行）
- `components/BdpanDirPicker/index.tsx` vs `components/BdpanFileSelector/index.tsx`（5 处重复）
- `components/SettingsModal/contents/AgentModalContent.tsx` vs `pages/guid/components/AssistantEditDrawer.tsx`（本 skill 的典型案例）
- `pages/conversation/preview/components/viewers/ExcelViewer.tsx` vs `PPTViewer.tsx`、`WordViewer.tsx` 自身重复
- `pages/settings/EnterpriseMcpSettings/components/InstallJsonModal.tsx` vs `pages/settings/components/JsonImportModal.tsx`

## 判定标准

两处是否服务 ① 同一组持久化 API ② 同一组领域 utils ③ 同一组 UI 段落 —— 三者满足两项即判定为语义重复。

## Pitfalls

- jscpd 对变量名重命名后的重复不敏感，会漏报；必须用语义线索补
- 大文件里的小比例重复不触发 token 阈值，是最大假阴性来源（`AgentModalContent.tsx` 2874 行 vs `AssistantEditDrawer.tsx` 537 行）
- 一方抽了子组件、另一方内联写两遍时，结构差异导致跨文件 token 不匹配；jscpd 只会报内联方的自重复，不会关联到另一文件（本案例 `SkillCard` 已抽 vs 内联两遍）
- 不要把合理的 utils 复用误判为重复——重点是业务编排逻辑（加载/保存/状态机）是否被复制
- 注释线索有滞后性：复制后两边各自演化注释可能被删，注释没命中不代表没重复
- 对比功能骨架时要忽略重命名差异（`isReadonly` vs `isReadonlyAssistant`、`assistant` vs `activeAssistant`），只看语义角色是否对应
- 本项目 Renderer 路径别名：`@renderer/*` 或 `@/*`，grep IPC 调用时注意 `ipcBridge.xxx.yyy` 三段式命名

## Verification

- 对每对候选文件产出功能模块对照表，确认两侧差异是重命名或结构变形而非真正业务差异
- 检查是否真的同功能：两处是否服务同一组持久化 API、同一组领域 utils、同一组 UI 段落——三者满足两项即判定语义重复
- 重构后重新 `bunx jscpd` 确认该重复对消失且未引入新重复
- 重构后跑 `bun run test` 和 `bunx tsc --noEmit` 确认行为不变（本项目 TypeScript strict 模式，类型错误会阻塞）
