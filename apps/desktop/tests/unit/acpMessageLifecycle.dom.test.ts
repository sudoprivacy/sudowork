import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge';

const state = vi.hoisted(() => ({
  listener: undefined as ((message: IResponseMessage) => void) | undefined,
  addMessage: vi.fn(),
  updateMessages: vi.fn(),
  getConversation: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  acpConversation: {
    responseStream: {
      on: (listener: (message: IResponseMessage) => void) => {
        state.listener = listener;
        return () => {
          state.listener = undefined;
        };
      },
    },
  },
  conversation: { get: { invoke: (...args: unknown[]) => state.getConversation(...args) } },
}));
vi.mock('@renderer/messages/hooks', () => ({
  useAddOrUpdateMessage: () => state.addMessage,
  useUpdateMessageList: () => state.updateMessages,
}));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { emit: (...args: unknown[]) => state.emit(...args) } }));

import { useAcpMessage } from '@renderer/pages/conversation/acp/useAcpMessage';

function deliver(type: IResponseMessage['type'], data: unknown = null): void {
  act(() => state.listener?.({ type, conversation_id: 'session', msg_id: 'message', data } as IResponseMessage));
}

async function mount() {
  const view = renderHook(() => useAcpMessage('session'));
  await act(async () => {});
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.getConversation.mockResolvedValue({ status: 'finished', type: 'remote-agent' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ACP turn and transport lifecycle', () => {
  it('keeps an ended request idle when a late error tip arrives', async () => {
    const { result } = await mount();
    deliver('start', { processingStartTime: 123 });
    deliver('finish');
    act(() => vi.advanceTimersByTime(1000));
    deliver('tips', { type: 'error', content: 'api returned 500 Internal Server Error' });
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(result.current.processingStartTime).toBeUndefined();
  });

  it('clears the request timer and thought after an error', async () => {
    const { result } = await mount();
    deliver('start', { processingStartTime: 123 });
    deliver('thought', { subject: 'Reviewing', description: 'Reading the document' });
    deliver('error', { error: 'Request failed' });
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(result.current.processingStartTime).toBeUndefined();
    expect(result.current.thought).toEqual({ subject: '', description: '' });
  });

  it('keeps an idle conversation idle through connection and reconnection', async () => {
    const { result } = await mount();
    for (const status of ['connecting', 'connected', 'authenticated', 'session_active', 'connecting', 'connected']) {
      deliver('agent_status', { status });
      expect(result.current.acpStatus).toBe(status);
      expect(result.current.running).toBe(false);
      expect(result.current.aiProcessing).toBe(false);
    }
    expect(state.emit).toHaveBeenLastCalledWith('agent.connection.status', 'session', 'connected');
  });

  it('preserves an active turn through transport readiness updates', async () => {
    const { result } = await mount();
    deliver('start', { processingStartTime: 123 });
    for (const status of ['connecting', 'connected', 'authenticated', 'session_active']) {
      deliver('agent_status', { status });
      expect(result.current.running).toBe(true);
      expect(result.current.aiProcessing).toBe(true);
      expect(result.current.processingStartTime).toBe(123);
    }
    deliver('finish');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('finishes after late connection metadata and stays idle on further reconnects', async () => {
    const { result } = await mount();
    deliver('start');
    deliver('finish');
    deliver('agent_status', { status: 'connected' });
    act(() => vi.advanceTimersByTime(1000));
    deliver('agent_status', { status: 'connecting' });
    deliver('agent_status', { status: 'connected' });
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(result.current.processingStartTime).toBeUndefined();
  });

  it('ends a turn on disconnect and accepts subsequent real turn activity', async () => {
    const { result } = await mount();
    deliver('start');
    deliver('agent_status', { status: 'disconnected' });
    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    deliver('agent_status', { status: 'connected' });
    expect(result.current.running).toBe(false);
    deliver('start', { processingStartTime: 456 });
    expect(result.current.running).toBe(true);
    expect(result.current.processingStartTime).toBe(456);
  });
});
