import { Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import { emitter } from '@/renderer/utils/emitter';
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

function TeamDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teamId = '' } = useParams<{ teamId: string }>();
  const { team, statusMap, loading } = useTeamSession(teamId);
  const teamRunView = useTeamRunView(teamId);
  const [leaderConv, setLeaderConv] = useState<TChatConversation | undefined>(undefined);
  const [activeRightPanelTab, setActiveRightPanelTab] = useState('workspace');
  const currentTeam = team?.id === teamId ? team : null;

  const leader = useMemo(() => currentTeam?.assistants.find((a) => a.role === 'leader') ?? null, [currentTeam]);

  // Rebuild the team runtime on mount (附录 §1.3 / 关键事实 4): after an app restart the in-memory
  // sessions are gone, so ensureSession re-attaches members + drains unread backlog.
  useEffect(() => {
    if (!teamId) return;
    void ipcBridge.team.ensureSession.invoke({ teamId }).catch(() => {
      /* ignore — session rebuild best-effort */
    });
  }, [teamId]);

  useEffect(() => {
    if (!leader?.conversation_id) {
      setLeaderConv(undefined);
      return undefined;
    }
    let cancelled = false;
    setLeaderConv(undefined);
    void (async () => {
      try {
        const conv = unwrapTeamResult(await ipcBridge.conversation.get.invoke({ id: leader.conversation_id! }));
        if (!cancelled) setLeaderConv(conv ?? undefined);
      } catch {
        if (!cancelled) setLeaderConv(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leader?.conversation_id]);

  const leaderTeamSendMessage = useMemo(
    () =>
      async ({ input, files, msg_id }: { input: string; files?: string[]; msg_id?: string }) => {
        await ipcBridge.team.sendMessage.invoke({ teamId, input, files, msgId: msg_id });
      },
    [teamId]
  );

  const onEmptyPromptClick = useCallback(
    (prompt: string) => {
      emitter.emit('sendbox.fill', { text: prompt, conversationId: leader?.conversation_id ?? undefined });
    },
    [leader?.conversation_id]
  );

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

  const memberTabNode = <TeamMemberListTab team={currentTeam} statusMap={statusMap} />;
  const runStatus = teamRunView.activeRun?.status;
  const isTeamMemberTabActive = activeRightPanelTab === 'team';
  const currentLeaderConv = leaderConv?.id === leader.conversation_id ? leaderConv : undefined;

  return (
    <ChatLayout
      title={currentTeam.name}
      backend={leader.assistant_backend}
      agentName={leader.assistant_name}
      conversationId={leader.conversation_id}
      workspaceEnabled
      rightSiderWidthOverride={isTeamMemberTabActive ? { widthPx: 440 } : null}
      headerLeft={<AcpModelSelector conversationId={leader.conversation_id} backend={leader.assistant_backend} />}
      headerExtra={runStatus ? <span className={`text-12px px-8px py-2px rounded-full ${runStatus === 'running' ? 'bg-green-500/10 text-green-600' : 'bg-gray-400/10 text-gray-500'}`}>{t(`team.status.${runStatus === 'running' ? 'active' : 'idle'}`)}</span> : null}
      sider={<ChatSider conversation={currentLeaderConv} extraTab={{ id: 'team', label: t('team.detail.memberTab'), node: memberTabNode }} onActiveTabChange={setActiveRightPanelTab} />}
    >
      <AcpChat
        conversation_id={leader.conversation_id}
        backend={leader.assistant_backend as AcpBackend}
        agentName={leader.assistant_name}
        workspace={currentTeam.workspace ?? undefined}
        teamSendMessage={leaderTeamSendMessage}
        showEmptyStateWhenNoMessages
        emptyState={<TeamLeaderEmptyState assistantName={leader.assistant_name} assistantAvatar={leader.icon} assistantBackend={leader.assistant_backend} onPromptClick={onEmptyPromptClick} />}
      />
    </ChatLayout>
  );
}

export default TeamDetailPage;
