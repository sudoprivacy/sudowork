import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ create: vi.fn(), closePreparing: vi.fn(), showError: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({ Message: { loading: () => state.closePreparing, error: state.showError } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ conversation: { create: { invoke: state.create } } }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true }) }));
vi.mock('@renderer/hooks/useHasAvailableModel', () => ({ useHasAvailableModel: () => ({ hasModel: true, ready: true }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ isGuest: false }) }));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@renderer/utils/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@icon-park/react', () => ({ Robot: () => null }));
vi.mock('@renderer/utils/agentLogo', () => ({ getAgentLogo: () => '/agent.svg' }));
vi.mock('@renderer/utils/platform', () => ({ resolveExtensionAssetUrl: (url: string) => url }));

import AgentPillBar from '@renderer/pages/guid/components/AgentPillBar';
import { useGuidSend, type GuidSendDeps } from '@renderer/pages/guid/hooks/useGuidSend';

afterEach(cleanup);

describe('managed execution choices', () => {
  it('shows only cloud after Local authorization is revoked, even when the previous choice was local', () => {
    const { container } = render(<AgentPillBar availableAgents={[]} selectedAgentKey='scode' getAgentKey={(agent) => agent.backend} onSelectAgent={vi.fn()} isEnterprise localModeAvailable={false} sessionMode='local' />);
    expect(screen.getByText('conversation.welcome.execution.cloud')).toBeTruthy();
    expect(screen.queryByText('conversation.welcome.execution.local')).toBeNull();
    expect(container.querySelector('[data-session-mode="local"]')).toBeNull();
  });

  it('offers both choices again when Local authorization is restored', () => {
    const onSessionModeChange = vi.fn();
    render(<AgentPillBar availableAgents={[]} selectedAgentKey='scode' getAgentKey={(agent) => agent.backend} onSelectAgent={vi.fn()} isEnterprise localModeAvailable sessionMode='local' onSessionModeChange={onSessionModeChange} />);
    expect(screen.getByText('conversation.welcome.execution.local')).toBeTruthy();
    fireEvent.click(screen.getByText('conversation.welcome.execution.cloud'));
    expect(onSessionModeChange).toHaveBeenCalledWith('remote');
  });

  it('ends preparation and keeps the draft when the main process denies local creation', async () => {
    state.create.mockResolvedValue({ __error: 'Local execution is not allowed' });
    const setLoading = vi.fn();
    const setInput = vi.fn();
    const navigate = vi.fn();
    const deps = {
      input: 'keep my draft',
      files: [],
      dir: '',
      setLoading,
      setInput,
      navigate,
      selectedAgent: 'scode',
      selectedAgentKey: 'scode',
      sessionMode: 'local',
      findAgentByKey: () => ({ backend: 'scode', name: 'Sudo Code' }),
      getEffectiveAgentType: () => ({ agentType: 'scode' }),
      resolveEnabledSkills: () => [],
      isMainAgentAvailable: () => true,
      t: (key: string, values?: { reason: string }) => values?.reason || key,
    } as unknown as GuidSendDeps;
    const { result } = renderHook(() => useGuidSend(deps));
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    expect(state.closePreparing).toHaveBeenCalledOnce();
    expect(state.showError).toHaveBeenCalledWith('Local execution is not allowed');
    expect(setInput).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
