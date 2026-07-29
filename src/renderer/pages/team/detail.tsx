import { Message, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import { shouldSyncWorkspaceSkills } from '@/common/utils/workspaceSkillSync';
import { emitter } from '@/renderer/utils/emitter';
import { useAuth } from '@/renderer/context/AuthContext';
import { useHasAvailableModel } from '@/renderer/hooks/useHasAvailableModel';
import type { AcpBackend } from '@/types/acpTypes';
import AcpChat from '@renderer/pages/conversation/acp/AcpChat';
import ChatLayout from '@renderer/pages/conversation/ChatLayout';
import ChatSider from '@renderer/pages/conversation/ChatSider';
import AcpModelSelector from '@renderer/components/AcpModelSelector';
import { unwrapTeamResult } from './utils';
import { useTeamSession } from './hooks/useTeamSession';
import { useTeamRunView } from './hooks/useTeamRunView';
import TeamMemberListTab from './components/TeamMemberListTab';
import TeamLeaderEmptyState from './components/TeamLeaderEmptyState';
import TeamWarmupOverlay from './components/TeamWarmupOverlay';
import { useTeamWarmup } from './hooks/useTeamWarmup';
import { resolveTeamAssistantIcon, toChatLayoutAgentLogo } from './utils/teamAssistantIcon';

function TeamDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teamId = '' } = useParams<{ teamId: string }>();
  const { team, statusMap, loading, addMember, renameMember, removeMember } = useTeamSession(teamId);
  const teamRunView = useTeamRunView(teamId);
  const teamWarmup = useTeamWarmup(teamId);
  const [leaderConv, setLeaderConv] = useState<TChatConversation | undefined>(undefined);
  const [activeRightPanelTab, setActiveRightPanelTab] = useState('workspace');
  const [isLeaderChatProcessing, setIsLeaderChatProcessing] = useState(false);
  const currentTeam = team?.id === teamId ? team : null;

  const leader = useMemo(() => currentTeam?.assistants.find((a) => a.role === 'leader') ?? null, [currentTeam]);

  useEffect(() => {
    setIsLeaderChatProcessing(false);
    if (!leader?.conversation_id) {
      setLeaderConv(undefined);
      return undefined;
    }
    let cancelled = false;
    setLeaderConv(undefined);
    void (async () => {
      try {
        const conv = unwrapTeamResult(await ipcBridge.conversation.get.invoke({ id: leader.conversation_id! }));
        if (conv && shouldSyncWorkspaceSkills(conv)) {
          await ipcBridge.conversation.syncWorkspaceSkills.invoke({ conversation_id: conv.id }).catch((error) => {
            console.warn('Failed to sync team leader workspace skills:', error);
          });
        }
        if (!cancelled) setLeaderConv(conv ?? undefined);
      } catch {
        if (!cancelled) setLeaderConv(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leader?.conversation_id]);

  const { isGuest } = useAuth();
  const { hasModel, ready } = useHasAvailableModel();
  const leaderTeamSendMessage = useMemo(
    () =>
      async ({ input, files, msg_id }: { input: string; files?: string[]; msg_id?: string }) => {
        // claude/scode leaders carry their own config and must not be blocked by model.config.
        // Probing on every team message is too costly, so skip the guard for these two backends only.
        if (isGuest && ready && !hasModel && leader.assistant_backend !== 'claude' && leader.assistant_backend !== 'scode') {
          Message.error(t('guid.modelNotConfigured', { defaultValue: '未配置可用模型，请在设置页添加模型' }));
          return;
        }
        await ipcBridge.team.sendMessage.invoke({ teamId, input, files, msgId: msg_id });
      },
    [teamId, t, isGuest, hasModel, ready, leader?.assistant_backend]
  );

  const onLeaderTeamAnswerQuestion = useMemo(
    () =>
      async ({ conversationId, toolCallId, answers }: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => {
        if (!leader?.slot_id) return { success: false, msg: t('team.detail.leaderNotFound') };
        return await ipcBridge.team.answerQuestion.invoke({ teamId, memberId: leader.slot_id, conversationId, toolCallId, answers });
      },
    [teamId, leader?.slot_id, t]
  );

  const onEmptyPromptClick = useCallback(
    (prompt: string) => {
      emitter.emit('sendbox.fill', { text: prompt, conversationId: leader?.conversation_id ?? undefined });
    },
    [leader?.conversation_id]
  );

  const activeSlotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slotId of Object.keys(teamRunView.childTurnsBySlot)) ids.add(slotId);
    for (const work of teamRunView.activeRun?.slot_work ?? []) {
      if (work.active_turn_id || (work.starting_child_count ?? 0) > 0) ids.add(work.slot_id);
    }
    return ids;
  }, [teamRunView.activeRun?.slot_work, teamRunView.childTurnsBySlot]);

  if (loading && !currentTeam) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Spin />
      </div>
    );
  }

  if (!currentTeam || !leader || !leader.conversation_id) {
    void navigate('/guid');
    return null;
  }

  const memberTabNode = <TeamMemberListTab team={currentTeam} statusMap={statusMap} activeSlotIds={activeSlotIds} onAddMember={addMember} onRenameMember={renameMember} onRemoveMember={removeMember} />;
  const runStatus = teamRunView.activeRun?.status;
  const isRunActive = runStatus === 'accepted' || runStatus === 'running';
  const isHeaderActive = isRunActive || isLeaderChatProcessing;
  const isHeaderStatusVisible = Boolean(runStatus || isLeaderChatProcessing);
  const isTeamMemberTabActive = activeRightPanelTab === 'team';
  const currentLeaderConv = leaderConv?.id === leader.conversation_id ? leaderConv : undefined;
  const leaderIcon = resolveTeamAssistantIcon({ assistantId: leader.assistant_id, source: leader.source, backend: leader.assistant_backend, avatar: leader.icon, name: leader.assistant_name });
  const leaderLogoProps = toChatLayoutAgentLogo(leaderIcon);

  return (
    <ChatLayout
      title={currentTeam.name}
      backend={leader.source === 'assistant' && leaderLogoProps.agentLogo ? undefined : leader.assistant_backend}
      agentName={leader.assistant_name}
      agentLogo={leaderLogoProps.agentLogo}
      agentLogoIsEmoji={leaderLogoProps.agentLogoIsEmoji}
      conversationId={leader.conversation_id}
      workspaceEnabled
      rightSiderWidthOverride={isTeamMemberTabActive ? { widthPx: 440 } : null}
      headerLeft={<AcpModelSelector conversationId={leader.conversation_id} backend={leader.assistant_backend} />}
      headerExtra={isHeaderStatusVisible ? <span className={`text-12px px-8px py-2px rounded-full ${isHeaderActive ? 'bg-green-500/10 text-green-600' : 'bg-gray-400/10 text-gray-500'}`}>{t(`team.status.${isHeaderActive ? 'active' : 'idle'}`)}</span> : null}
      sider={<ChatSider conversation={currentLeaderConv} teamId={teamId} extraTab={{ id: 'team', label: t('team.detail.memberTab'), node: memberTabNode }} isOverflowTabsEnabled onActiveTabChange={setActiveRightPanelTab} />}
    >
      <div className='relative flex min-h-0 flex-1 flex-col'>
        <AcpChat
          conversation_id={leader.conversation_id}
          backend={leader.assistant_backend as AcpBackend}
          agentName={leader.assistant_name}
          workspace={currentTeam.workspace ?? undefined}
          onTeamAnswerQuestion={onLeaderTeamAnswerQuestion}
          teamAnswerQuestion={onLeaderTeamAnswerQuestion}
          teamSendMessage={leaderTeamSendMessage}
          showEmptyStateWhenNoMessages
          emptyState={<TeamLeaderEmptyState assistantName={leader.assistant_name} assistantAvatar={leader.icon} assistantBackend={leader.assistant_backend} assistantId={leader.assistant_id} source={leader.source} onPromptClick={onEmptyPromptClick} />}
          onProcessingChange={setIsLeaderChatProcessing}
        />
        <TeamWarmupOverlay phase={teamWarmup.phase} members={currentTeam.assistants} runtimeStatus={teamWarmup.runtimeStatus} error={teamWarmup.error} onRetry={teamWarmup.onRetry} />
      </div>
    </ChatLayout>
  );
}

export default TeamDetailPage;
