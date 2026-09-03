import type { TMessage } from '@sudowork/common/chatLib';
import { ipcBridge } from '@/common';
import { getDatabase } from '@process/database';
import { uuid } from '@/common/utils';
import { mainWarn } from '@process/utils/mainLogger';
import type { TeamMail, TeamMember } from './TeamStore';

function dedupeKey(teamId: string, mailboxMsgId: string, conversationId: string): string {
  return `team:${teamId}:mailbox:${mailboxMsgId}:conversation:${conversationId}`;
}

function stripSystemNotes(text: string): string {
  // Stage 2: pass-through (system-note stripping is a later refinement).
  return text;
}

interface TeammateMessageContent {
  content: string;
  teammateMessage: true;
  senderName: string | null;
  senderBackend: string | null;
  senderConversationId: string | null;
}

/**
 * Project a mailbox message into a conversation as a chat bubble (附录 I.7).
 * - user message -> right bubble (content stripped of system notes)
 * - teammate message -> left bubble (carries sender metadata for TeammateMessageAvatar)
 * - idle_notification / shutdown_request -> not projected
 * Teammate bubbles dedupe by msg_id to avoid double-mirroring.
 */
export function projectMessage(teamId: string, mail: TeamMail, targetConversationId: string, sender?: TeamMember | null): void {
  if (mail.type !== 'message') return;
  const isFromUser = mail.from_member_id === 'user';
  const key = dedupeKey(teamId, mail.id, targetConversationId);

  const position = isFromUser ? 'right' : 'left';
  const content: { content: string } | TeammateMessageContent = isFromUser
    ? { content: stripSystemNotes(mail.content) }
    : {
        content: mail.content,
        teammateMessage: true,
        senderName: sender?.name ?? null,
        senderBackend: sender?.backend ?? null,
        senderConversationId: sender?.conversation_id ?? null,
      };

  const message = {
    id: uuid(36),
    msg_id: key,
    conversation_id: targetConversationId,
    type: 'text' as const,
    content,
    position,
    status: 'finish' as const,
    createdAt: mail.created_at,
  };
  const result = getDatabase().insertMessageIfNotExists(message as TMessage);
  if (!result.success) {
    mainWarn('MessageProjection', `projectMessage insert failed for ${key}: ${result.error}`);
    return;
  }
  if (!result.inserted) return;

  if (isFromUser) {
    ipcBridge.acpConversation.responseStream.emit({
      type: 'user_content',
      conversation_id: targetConversationId,
      msg_id: key,
      data: stripSystemNotes(mail.content),
    });
  } else {
    ipcBridge.team.onTeammateMessage.emit({
      conversation_id: targetConversationId,
      content: mail.content,
      from_slot_id: mail.from_member_id,
      from_name: sender?.name,
    });
  }
}

/**
 * Mirror a member's unread non-user mailbox into its own conversation as left bubbles
 * (附录 I.7 mirrorUnreadToConversation, used inside EventLoop.executeTurn).
 */
export function mirrorUnreadToConversation(teamId: string, member: TeamMember, messages: TeamMail[], senderLookup: (slotId: string) => TeamMember | null): void {
  for (const mail of messages) {
    if (mail.type === 'idle_notification') continue;
    if (!member.conversation_id) continue;
    projectMessage(teamId, mail, member.conversation_id, senderLookup(mail.from_member_id));
  }
}
