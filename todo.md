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
- [ ] 清理当前项目错误的Message使用 Message.useMessage 不应该这种的

- [ ] 整理功能模块及步骤
  - [ ] 整理功能代码
  - [ ] 扫描出关联的components，内聚到功能目录
  - [ ] 扫描丢失的国际化 key
  - [ ] 修正 UnoCSS 的用法
