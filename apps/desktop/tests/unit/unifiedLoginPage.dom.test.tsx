import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnterGuest, mockSetAppMode } = vi.hoisted(() => ({
  mockEnterGuest: vi.fn(),
  mockSetAppMode: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/hooks/useSystemLoginMethod', () => ({
  useSystemLoginMethod: () => ({
    loginMethod: 0,
    authMethods: ['phone', 'password', 'api_key', 'sso'],
    systemConfig: {
      login_method: 0,
      registration: { phone_enabled: true, invitation_required: true, auto_create_org: false },
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  isMacOS: () => false,
}));

vi.mock('@renderer/components/WindowControls', () => ({
  default: () => null,
}));

vi.mock('@renderer/context/AuthContext', () => ({
  useAuth: () => ({
    status: 'unauthenticated',
    enterGuest: mockEnterGuest,
    login: vi.fn(),
    register: vi.fn(),
    enterpriseLogin: vi.fn(),
    enterpriseLoginWithOAuth2: vi.fn(),
  }),
}));

vi.mock('@sudowork/common/sudoworkServer', () => ({
  getMossServerPolicy: vi.fn(async () => ({
    serverUrl: 'https://agent.sudoprivacy.com',
    isLocked: false,
    source: 'build',
  })),
  normalizeHttpOrigin: (value: string) => value,
}));

vi.mock('@sudowork/host-bridge/eeclawMode', () => ({
  setAppMode: mockSetAppMode,
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  application: { startConsumerServices: { invoke: vi.fn(async () => undefined) } },
  deepLink: { received: { on: vi.fn(() => () => undefined) } },
  eeclaw: {
    oauth2Config: {
      invoke: vi.fn(async () => ({ success: true, data: { enabled: true } })),
    },
    verifyServer: { invoke: vi.fn() },
  },
}));

import LoginPage from '@renderer/pages/login';

describe('unified login page', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    mockEnterGuest.mockReset();
    mockEnterGuest.mockResolvedValue(undefined);
    mockSetAppMode.mockClear();
  });

  it('shows all Moss login capabilities and a separate offline entry', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByText('login.phoneTab')).toBeInTheDocument();
    expect(screen.getByText('login.passwordTab')).toBeInTheDocument();
    expect(screen.getByText('login.apiKeyTab')).toBeInTheDocument();
    expect(screen.getByText('login.pwdRegisterTab')).toBeInTheDocument();
    expect(screen.getByText('login.ssoTab')).toBeInTheDocument();
    expect(screen.getByText('login.offlineUse')).toBeInTheDocument();
    expect(screen.queryByText('普通用户')).not.toBeInTheDocument();
    expect(screen.queryByText('企业用户')).not.toBeInTheDocument();
  });

  it('shows invitation registration separately from phone login', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('login.pwdRegisterTab'));
    expect(screen.getByPlaceholderText('login.phonePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('login.codePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('login.pwdNicknamePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('login.pwdInvitationCodePlaceholder')).toBeInTheDocument();
  });

  it('enters offline guest mode before switching the local runtime', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('login.offlineUse'));
    await waitFor(() => expect(mockEnterGuest).toHaveBeenCalledOnce());
    expect(mockSetAppMode).toHaveBeenCalledWith('c');
  });
});
