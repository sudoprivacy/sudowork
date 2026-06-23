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

- [ ] 扫清项目中散落的 types，统一迁移至 `src/types/`（纯类型转 `.d.ts`，运行时常量移至 `src/common/constants.ts`，枚举移至 `src/common/enum.ts`）
  > 扫描命令：`grep -rn "^export const\|^export function\|^export class\|^export enum" <文件>`
  - 纯类型文件（直接转 `.d.ts`）
    - `src/common/nexus/types.ts`
    - `src/common/slash/types.ts`
    - `src/common/updateTypes.ts`
    - `src/process/providers/cron/types.ts`
    - `src/process/providers/types.ts`
    - `src/process/services/safety/types.ts`
    - `src/renderer/components/SettingsModal/contents/channels/types.ts`
    - `src/renderer/components/SettingsModal/contents/secrets/types.ts`
    - `src/renderer/messages/types.ts`
    - `src/renderer/pages/conversation/grouped-history/types.ts`
    - `src/renderer/pages/conversation/workspace/types.ts`
    - `src/renderer/pages/guid/types.ts`
    - `src/renderer/pages/settings/EnterpriseMcpSettings/types.ts`
    - `src/renderer/shared/agents/types.ts`
  - 含枚举（移至 `src/common/enum.ts`，剩余纯类型转 `.d.ts`）
    - `src/common/codex/types/eventTypes.ts`
    - `src/common/codex/types/toolTypes.ts`
  - 含运行时值（需先提取常量再转 `.d.ts`）
    - `src/agent/sudoclaw/types.ts`
    - `src/channels/types.ts`
    - `src/channels/actions/types.ts`
    - `src/channels/plugins/wechat/types.ts`
    - `src/common/codex/types/errorTypes.ts`
    - `src/common/codex/types/permissionTypes.ts`
    - `src/common/skillAuditTypes.ts`
    - `src/extensions/types.ts`
    - `src/process/database/types.ts`

- [ ] 当前项目中修改智能体存在多个功能相同的组件，需要统一合并
