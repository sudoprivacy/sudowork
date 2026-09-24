import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnterGuest, mockSetAppMode, mockPolicy, mockLogin, mockRegister, mockEnterpriseLogin, mockIsDesktop } = vi.hoisted(() => ({
  mockEnterGuest: vi.fn(),
  mockPolicy: vi.fn(),
  mockLogin: vi.fn(),
  mockRegister: vi.fn(),
  mockEnterpriseLogin: vi.fn(),
  mockIsDesktop: vi.fn(),
  mockSetAppMode: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/hooks/useSystemLoginMethod', () => ({
  useSystemLoginMethod: mockPolicy,
}));

vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: mockIsDesktop,
  isMacOS: () => false,
}));

vi.mock('@renderer/components/WindowControls', () => ({
  default: () => null,
}));

vi.mock('@renderer/context/AuthContext', () => ({
  useAuth: () => ({
    status: 'unauthenticated',
    enterGuest: mockEnterGuest,
    login: mockLogin,
    register: mockRegister,
    enterpriseLogin: mockEnterpriseLogin,
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

import { Message } from '@arco-design/web-react';
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
    mockPolicy.mockReset();
    mockPolicy.mockReturnValue({
      loginMethod: 0,
      authMethods: ['phone', 'password', 'api_key', 'sso'],
      systemConfig: { login_method: 0, registration: { phone_enabled: true } },
      isLoading: false,
      error: null,
    });
    mockIsDesktop.mockReturnValue(true);
    mockLogin.mockReset();
    mockRegister.mockReset();
    mockEnterpriseLogin.mockReset();
    mockEnterGuest.mockReset();
    mockEnterGuest.mockResolvedValue(undefined);
    mockSetAppMode.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { name: 'password-only policy', loginMethod: 1, authMethods: ['password'], systemConfig: { registration: { phone_enabled: false } }, isLoading: false, error: null },
    { name: 'SMS-only policy', loginMethod: 0, authMethods: ['phone'], systemConfig: { registration: { phone_enabled: true } }, isLoading: false, error: null },
    { name: 'pending discovery', loginMethod: null, authMethods: [], systemConfig: null, isLoading: true, error: null },
    { name: 'failed discovery', loginMethod: null, authMethods: [], systemConfig: null, isLoading: false, error: new Error('discovery failed') },
  ])('keeps all standard entries usable with $name', (policy) => {
    mockPolicy.mockReturnValue(policy);
    localStorage.setItem('login.organizationCode', 'OLD-ORG');
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(mockPolicy).toHaveBeenCalledWith();
    expect(screen.queryByPlaceholderText('输入企业码')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('login.phonePlaceholder')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'login.sendCode' })).toBeEnabled();
    for (const tab of ['login.phoneTab', 'login.passwordTab', 'login.apiKeyTab', 'login.pwdRegisterTab']) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
    }
    expect(screen.getByPlaceholderText('login.pwdInvitationCodePlaceholder')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'login.pwdRegisterBtn' })).toBeEnabled();
    expect(screen.queryByText('discovery failed')).not.toBeInTheDocument();
  });

  it('keeps the selected registration form when discovery finishes', () => {
    mockPolicy.mockReturnValue({ authMethods: [], systemConfig: null, isLoading: true });
    const { rerender } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'login.pwdRegisterTab' }));
    fireEvent.change(screen.getByPlaceholderText('login.phonePlaceholder'), { target: { value: '13800138000' } });
    mockPolicy.mockReturnValue({ authMethods: ['password'], loginMethod: 1, systemConfig: { registration: { phone_enabled: false } }, isLoading: false });
    rerender(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('login.pwdInvitationCodePlaceholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('login.phonePlaceholder')).toHaveValue('13800138000');
  });

  it('shows all standard entries on Web without desktop SSO or offline controls', () => {
    mockIsDesktop.mockReturnValue(false);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    for (const tab of ['login.phoneTab', 'login.passwordTab', 'login.apiKeyTab', 'login.pwdRegisterTab']) {
      expect(screen.getByRole('button', { name: tab })).toBeEnabled();
    }
    expect(screen.queryByText('login.ssoTab')).not.toBeInTheDocument();
    expect(screen.queryByText('login.offlineUse')).not.toBeInTheDocument();
  });

  it.each(['phone', 'password', 'api_key', 'register'])('displays the server rejection for %s without changing tabs', async (tab) => {
    const message = 'Current organization does not allow this login method';
    mockLogin.mockResolvedValue({ success: false, message });
    mockRegister.mockResolvedValue({ success: false, message });
    mockEnterpriseLogin.mockResolvedValue({ success: false, message });
    const onError = vi.spyOn(Message, 'error').mockImplementation(() => undefined);
    mockIsDesktop.mockReturnValue(false);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    const fill = (placeholder: string, value: string) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    let submit = 'login.submit';
    if (tab === 'password') {
      fireEvent.click(screen.getByText('login.passwordTab'));
      fill('login.pwdAccountPlaceholder', 'user');
      fill('login.pwdPasswordPlaceholder', 'password');
      submit = 'login.pwdLoginBtn';
    } else if (tab === 'api_key') {
      fireEvent.click(screen.getByText('login.apiKeyTab'));
      fill('login.apiKeyPlaceholder', 'test-key');
    } else {
      if (tab === 'register') {
        fireEvent.click(screen.getByText('login.pwdRegisterTab'));
        fill('login.pwdNicknamePlaceholder', 'User');
        fill('login.pwdInvitationCodePlaceholder', 'INVITE');
        submit = 'login.pwdRegisterBtn';
      }
      fill('login.phonePlaceholder', '13800138000');
      fill('login.codePlaceholder', '123456');
    }
    fireEvent.click(screen.getByRole('button', { name: submit }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(message));
    expect(screen.getByRole('button', { name: submit })).toBeEnabled();
  });

  it.each(['error', 'message'])('shows the %s response when sending a code is rejected', async (field) => {
    mockIsDesktop.mockReturnValue(false);
    const message = 'Phone login is not enabled on this server';
    const onError = vi.spyOn(Message, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ [field]: message }) }));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByPlaceholderText('login.phonePlaceholder'), { target: { value: '13800138000' } });
    fireEvent.click(screen.getByRole('button', { name: 'login.sendCode' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(message));
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
