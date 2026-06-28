# Todo

## 代码清理

- [ ] 清理未用到的变量及相关性代码 bunx eslint src/renderer/ --format unix 2>/dev/null | grep "no-unused-vars" | cut -d: -f1 | sort -u
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/AgentStatusBanner.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/Markdown.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/SettingsModal/contents/CopilotModalContent.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/SettingsModal/contents/SkillModalContent.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/SettingsModal/contents/TelegramConfigForm.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/SettingsModal/contents/ToolsModalContent.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/SettingsModal/contents/WebuiModalContent.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/components/SettingsModal/contents/WeComConfigForm.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/context/AuthContext.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/hooks/mcp/useMcpAgentStatus.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/hooks/mcp/useMcpServerCRUD.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/hooks/useMultiAgentDetection.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/hooks/usePreviewLauncher.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/hooks/useResizableSplit.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/hooks/useTheme.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/messages/acp/MessageAcpQuestion.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/messages/MessagePlan.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/acp/AcpSendBox.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/grouped-history/index.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/LibreOfficeInstallPrompt.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/PreviewPanel/PreviewPanel.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/PreviewPanel/PreviewToolbar.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/renderers/HTMLRenderer.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/viewers/ExcelViewer.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/viewers/PDFViewer.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/viewers/PPTViewer.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/components/viewers/WordViewer.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/preview/hooks/useScrollSyncHelpers.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/utils/createConversationParams.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/workspace/hooks/useWorkspaceFileOps.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/workspace/hooks/useWorkspacePaste.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/workspace/index.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/workspace/skillRoots.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/conversation/workspace/TaskPanel.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/guid/components/AssistantEditDrawer.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/guid/components/AssistantSelectionArea.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/guid/hooks/useGuidSend.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/moss-session/MossSessionPage.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/settings/about/components/OpsModal.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/settings/EnterpriseMcpSettings/api/mcpEvents.ts
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/settings/EnterpriseMcpSettings/components/EditConfigModal.tsx
      ✅ /Users/xiaohei/Documents/freelancer/jinjing/sudoclaw/sudowork/src/renderer/pages/settings/MemberManagement.tsx

- [ ] `src/types/` 边界策略：只存放 ① 第三方无类型包的 `.d.ts` shim；② 跨两个及以上进程（main/renderer/worker）共用的类型。模块内部类型保持原地，不强制迁移。

- [ ] 当前项目中修改智能体存在多个功能相同的组件，需要统一合并

- [ ] 整理功能模块及步骤
  1. 整理功能代码：梳理 `{模块路径}` 下各文件的职责，删除冗余逻辑，拆分过长组件
  2. 扫描 components/hooks/utils/types，内聚到功能目录
     1. 组件：扫描 `{模块路径}` 下所有 import，找出只被本模块引用的组件，迁移到 `components/`
     2. Hooks：找出只被本模块引用的 hook，迁移到 `hooks/`
     3. 工具方法：找出只被本模块引用的工具函数，迁移到 `utils/`
     4. Interface：找出只被本模块引用的非 props interface，迁移到 `types/`
     5. 去除 bg-fill-n，bg-n 这种方式的使用
  3. 扫描缺失国际化 key：使用 `.claude/agents/i18n-checker.md` agent 扫描该模块，补全缺失的 i18n key
  4. 清理该目录下错误的 `Message.useMessage` 用法：在该模块下下全局搜索 `Message.useMessage`，替换为正确的 `Message.info` 调用方式
  5. 修正 UnoCSS 的用法：使用 `.claude/agents/unocss-style-fixer.md` agent 检查该模块下不符合项目 UnoCSS 规范的写法并修正
  6. 使用 .claude/agents/icon-compat-checker.md 扫描该目录
  7. 看看能否使用 lucide-react的icon替换该目录下的'@icon-park/react'
