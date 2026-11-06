import type { TChatConversation } from '@sudowork/common/storage';

interface IConversationTask {
  type: string;
  stop(): void | Promise<void>;
}

interface IStopConversationOptions {
  getConversation(id: string): TChatConversation | undefined;
  assertAccount(conversation: TChatConversation): void;
  getTask(id: string): IConversationTask | undefined;
  interruptLocalBrowser(id: string): Promise<unknown>;
  interruptRemoteBrowser(id: string): Promise<unknown>;
}

/** Browser sessions outlive cached tasks; idle takeover uses the same barriers. */
export async function stopConversation(conversationId: string, options: IStopConversationOptions): Promise<{ success: boolean; msg?: string }> {
  const conversation = options.getConversation(conversationId);
  if (!conversation) return { success: true, msg: 'conversation not found' };
  options.assertAccount(conversation);
  if (conversation.type !== 'acp' && conversation.type !== 'remote-agent') return { success: false, msg: 'not support' };
  const task = options.getTask(conversationId);
  if (task && task.type !== conversation.type) return { success: false, msg: 'conversation task type mismatch' };
  if (conversation.type === 'acp') {
    await options.interruptLocalBrowser(conversationId);
    await task?.stop();
  } else {
    await task?.stop();
    await options.interruptRemoteBrowser(conversationId);
  }
  return { success: true };
}
