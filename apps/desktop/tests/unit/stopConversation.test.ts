import { describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';
import { stopConversation } from '@process/services/stopConversation';

function fixture(type: TChatConversation['type'] = 'acp') {
  const conversation = { id: 'owned', type } as TChatConversation;
  return {
    getConversation: vi.fn(() => conversation as TChatConversation | undefined),
    assertAccount: vi.fn(),
    getTask: vi.fn(() => undefined as { type: string; stop(): Promise<void> } | undefined),
    interruptLocalBrowser: vi.fn(async () => {}),
    interruptRemoteBrowser: vi.fn(async () => {}),
  };
}

describe('conversation stop and browser takeover', () => {
  it('waits for an idle local browser barrier even after the task was evicted', async () => {
    const options = fixture();
    let acknowledge!: () => void;
    options.interruptLocalBrowser.mockImplementation(() => new Promise<void>((resolve) => (acknowledge = resolve)));
    let isComplete = false;
    const pending = stopConversation('owned', options).then((result) => {
      isComplete = true;
      return result;
    });
    expect(options.interruptLocalBrowser).toHaveBeenCalledWith('owned');
    await Promise.resolve();
    expect(isComplete).toBe(false);
    acknowledge();
    await expect(pending).resolves.toEqual({ success: true });
    expect(options.getTask).toHaveReturnedWith(undefined);
  });

  it('interrupts the persisted cloud browser without allocating a new task', async () => {
    const options = fixture('remote-agent');
    await expect(stopConversation('owned', options)).resolves.toEqual({ success: true });
    expect(options.interruptRemoteBrowser).toHaveBeenCalledWith('owned');
    expect(options.interruptLocalBrowser).not.toHaveBeenCalled();
  });

  it.each(['acp', 'remote-agent'] as const)('retains the active %s stop order', async (type) => {
    const options = fixture(type);
    const order: string[] = [];
    options.getTask.mockReturnValue({ type, stop: async () => void order.push('task') });
    options.interruptLocalBrowser.mockImplementation(async () => void order.push('browser'));
    options.interruptRemoteBrowser.mockImplementation(async () => void order.push('browser'));
    await expect(stopConversation('owned', options)).resolves.toEqual({ success: true });
    expect(order).toEqual(type === 'acp' ? ['browser', 'task'] : ['task', 'browser']);
  });

  it('leaves the browser fenced when takeover is refused', async () => {
    const options = fixture();
    options.interruptLocalBrowser.mockRejectedValue(new Error('Pause was not acknowledged'));
    await expect(stopConversation('owned', options)).rejects.toThrow('Pause was not acknowledged');
  });

  it('does not touch tasks or browsers for a missing or foreign-account conversation', async () => {
    const options = fixture();
    options.getConversation.mockReturnValue(undefined);
    await expect(stopConversation('missing', options)).resolves.toEqual({ success: true, msg: 'conversation not found' });
    options.getConversation.mockReturnValue({ id: 'foreign', type: 'acp' } as TChatConversation);
    options.assertAccount.mockImplementation(() => {
      throw new Error('Conversation belongs to a different Moss account');
    });
    await expect(stopConversation('foreign', options)).rejects.toThrow('different Moss account');
    expect(options.getTask).not.toHaveBeenCalled();
    expect(options.interruptLocalBrowser).not.toHaveBeenCalled();
    expect(options.interruptRemoteBrowser).not.toHaveBeenCalled();
  });
});
