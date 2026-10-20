import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge';
import type { IMessageAcpQuestion } from '@sudowork/common/chatLib';
import { composeMessage } from '@sudowork/common/chatLib';
import AcpAgent from '@process/task/AcpAgent';
import { addOrUpdateMessage } from '@process/message';
import { ipcBridge } from '@/common';

vi.mock('@/utils/configureChromium', () => ({ cdpPort: 9230 }));
vi.mock('@process/i18n', () => ({ default: { t: (key: string) => key }, i18nReady: Promise.resolve() }));
vi.mock('@process/message', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@process/message')>()),
  addOrUpdateMessage: vi.fn(),
}));

interface ICancelledAgent {
  cancelPendingUserRequests: () => void;
  handleStreamEvent: (message: IResponseMessage) => void;
}

function cancelledAgent() {
  const agent = Object.create(AcpAgent.prototype) as ICancelledAgent;
  Object.assign(agent, {
    conversation_id: 'browser-takeover',
    userCancelled: true,
    pendingPermissions: new Map(),
    pendingQuestions: new Map([['native-question', { msgId: 'native-question-user-msg', reject: vi.fn() }]]),
    permissionRequestMeta: new Map(),
    confirmations: [],
    options: { backend: 'scode' },
    flushThinkFilters: vi.fn(),
    streamTextBuffer: { flushAll: vi.fn() },
  });
  return agent;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('native question cancellation during browser takeover', () => {
  it('persists and publishes host cancellation after the turn stops without erasing the question', () => {
    const emit = vi.spyOn(ipcBridge.acpConversation.responseStream, 'emit');
    cancelledAgent().cancelPendingUserRequests();
    expect(addOrUpdateMessage).toHaveBeenCalledTimes(1);
    const update = vi.mocked(addOrUpdateMessage).mock.calls[0][1];
    const original: IMessageAcpQuestion = {
      id: 'question',
      msg_id: 'native-question-user-msg',
      conversation_id: 'browser-takeover',
      type: 'acp_question',
      position: 'left',
      createdAt: 1,
      content: { question: 'Ready to sign in?', options: ['Take control'], conversationId: 'browser-takeover', answered: false },
    };
    const restored = composeMessage(update, [original])[0] as IMessageAcpQuestion;
    expect(restored.content).toMatchObject({ question: 'Ready to sign in?', options: ['Take control'], answered: true, cancelled: true });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'acp_question', data: expect.objectContaining({ cancelled: true }) }));
  });

  it('continues discarding late agent events including an untrusted cancellation', () => {
    const emit = vi.spyOn(ipcBridge.acpConversation.responseStream, 'emit');
    const agent = cancelledAgent();
    agent.handleStreamEvent({ type: 'content', conversation_id: 'browser-takeover', msg_id: 'late', data: 'late response' });
    agent.handleStreamEvent({ type: 'acp_question', conversation_id: 'browser-takeover', msg_id: 'late', data: { cancelled: true } });
    expect(addOrUpdateMessage).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
