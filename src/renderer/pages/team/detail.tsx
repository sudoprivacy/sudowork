import { Spin } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import type { AcpBackend } from '@/types/acpTypes';
import AcpChat from '@renderer/pages/conversation/acp/AcpChat';
import ChatLayout from '@renderer/pages/conversation/ChatLayout';
import ChatSider from '@renderer/pages/conversation/ChatSider';
import AcpModelSelector from '@renderer/components/AcpModelSelector';
import { unwrapTeamResult } from './utils';
import { useTeamSession } from './hooks/useTeamSession';
import TeamMemberListTab from './components/TeamMemberListTab';

function TeamDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teamId = '' } = useParams<{ teamId: string }>();
  const { team, statusMap, loading, removeMember } = useTeamSession(teamId);
  const [leaderConv, setLeaderConv] = useState<TChatConversation | undefined>(undefined);

  const leader = useMemo(() => team?.assistants.find((a) => a.role === 'leader') ?? null, [team]);

  useEffect(() => {
    if (!leader?.conversation_id) return;
    let cancelled = false;
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

  const handleRemoveMember = (slotId: string) => {
    void removeMember(slotId);
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Spin />
      </div>
    );
  }

  if (!team || !leader || !leader.conversation_id) {
    void navigate('/app/team');
    return null;
  }

  const memberTabNode = <TeamMemberListTab team={team} statusMap={statusMap} onRemoveMember={handleRemoveMember} />;

  return (
    <ChatLayout
      title={team.name}
      backend={leader.assistant_backend}
      agentName={leader.assistant_name}
      conversationId={leader.conversation_id}
      workspaceEnabled
      headerLeft={<AcpModelSelector conversationId={leader.conversation_id} backend={leader.assistant_backend} />}
      sider={<ChatSider conversation={leaderConv} extraTab={{ id: 'team', label: t('team.detail.memberTab'), node: memberTabNode }} />}
    >
      <AcpChat conversation_id={leader.conversation_id} backend={leader.assistant_backend as AcpBackend} agentName={leader.assistant_name} workspace={team.workspace ?? undefined} teamSendMessage={leaderTeamSendMessage} />
    </ChatLayout>
  );
}

export default TeamDetailPage;
