import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { nickname: 'User' }, isGuest: false, logout: vi.fn() }) }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true, mode: 'enterprise' }) }));
vi.mock('@renderer/hooks/useCronAccess', () => ({ useCronAccess: () => ({ isCronVisible: true }) }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@renderer/utils', () => ({ maskPhone: (value: string) => value }));
vi.mock('@renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));
vi.mock('@renderer/utils/siderTooltip', () => ({ cleanupSiderTooltips: vi.fn() }));
vi.mock('@renderer/pages/conversation/WorkspaceGroupedHistory', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/components/NewConversationButton', () => ({ default: () => null }));
vi.mock('@renderer/layouts/components/SettingsSider', () => ({ default: () => null }));
vi.mock('@renderer/layouts/components/TeamSiderSection', () => ({ default: () => null }));

import Sider from '@renderer/layouts/components/Sider';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function NavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <Sider />
      <button onClick={() => void navigate('/app/ontology/northwind/model?sessionId=chat-1')}>Open ontology</button>
      <button onClick={() => void navigate('/app/agent')}>Leave ontology</button>
      <button onClick={() => void navigate(-1)}>Go back</button>
    </>
  );
}

describe('sidebar menu route selection', () => {
  it.each(['/app/ontology', '/app/ontology/', '/app/ontology/northwind', '/app/ontology/northwind/model?sessionId=chat-1', '/app/ontology/northwind/data', '/app/ontology/northwind/capabilities', '/app/ontology/northwind/checks', '/app/ontology/northwind/release'])(
    'keeps the ontology menu selected at %s',
    (route) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <Sider />
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: 'common.siderMenu.ontology' })).toHaveClass('!bg-active');
      expect(screen.getByRole('button', { name: 'common.siderMenu.agent' })).not.toHaveClass('!bg-active');
    }
  );

  it('tracks ontology navigation, leaving the module, and browser back navigation', () => {
    render(
      <MemoryRouter initialEntries={['/app/ontology']}>
        <NavigationHarness />
      </MemoryRouter>
    );
    const ontologyMenu = screen.getByRole('button', { name: 'common.siderMenu.ontology' });
    fireEvent.click(screen.getByRole('button', { name: 'Open ontology' }));
    expect(ontologyMenu).toHaveClass('!bg-active');
    fireEvent.click(screen.getByRole('button', { name: 'Leave ontology' }));
    expect(ontologyMenu).not.toHaveClass('!bg-active');
    expect(screen.getByRole('button', { name: 'common.siderMenu.agent' })).toHaveClass('!bg-active');
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(ontologyMenu).toHaveClass('!bg-active');
  });

  it.each(['/app/ontology-other', '/app/agents/mine'])('does not select a menu from a partial path segment: %s', (route) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <Sider />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'common.siderMenu.ontology' })).not.toHaveClass('!bg-active');
    expect(screen.getByRole('button', { name: 'common.siderMenu.agent' })).not.toHaveClass('!bg-active');
    if (route === '/app/agents/mine') expect(screen.getByRole('button', { name: 'agent.mine.menuTitle' })).toHaveClass('!bg-active');
  });

  it('preserves the legacy guide menu selection', () => {
    render(
      <MemoryRouter initialEntries={['/guid?menu=ontology']}>
        <Sider />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'common.siderMenu.ontology' })).toHaveClass('!bg-active');
  });
});
