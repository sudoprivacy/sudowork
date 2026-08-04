import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configStorageGet } = vi.hoisted(() => ({ configStorageGet: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { startConsumerServices: { invoke: vi.fn() } },
    eeclaw: { verifyServer: { invoke: vi.fn() } },
  },
}));

vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => configStorageGet(...args),
    set: vi.fn(),
  },
}));

vi.mock('@/common/eeclawMode', () => ({
  getAppMode: vi.fn().mockResolvedValue('c'),
  setAppMode: vi.fn(),
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false, isMacOS: () => false }));
vi.mock('@/renderer/hooks/useTenantLogo', () => ({ useTenantLogo: () => '/logo.svg' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      ({
        'setup.mode.title': `欢迎使用 ${options?.name ?? ''}`,
        'setup.mode.consumer.title': '个人模式',
        'setup.mode.consumer.connectionTitle': '使用默认服务连接',
        'setup.mode.consumer.action': '进入个人模式',
        'setup.mode.enterprise.title': '企业模式',
        'setup.mode.enterprise.serverLabel': '企业服务器地址',
        'setup.mode.enterprise.serverPlaceholder': 'https://your-company-server.com',
        'setup.mode.enterprise.action': '验证并进入企业模式',
      })[key] ?? key,
  }),
}));

import ModeSetup from '@/renderer/pages/setup';

describe('ModeSetup', () => {
  beforeEach(() => {
    configStorageGet.mockReset();
    configStorageGet.mockResolvedValue(undefined);
  });

  it('默认选中个人模式并显示对应配置和主操作', () => {
    render(<ModeSetup />);

    expect(screen.getByRole('button', { name: /^个人模式/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^企业模式/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('使用默认服务连接')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '进入个人模式' })).toBeEnabled();
  });

  it('存在已保存的个人服务器时自动展示该配置', async () => {
    configStorageGet.mockResolvedValue('https://custom.example.com');
    render(<ModeSetup />);

    expect(await screen.findByDisplayValue('https://custom.example.com')).toBeInTheDocument();
  });

  it('在企业模式下校验服务器地址后才允许继续', () => {
    render(<ModeSetup />);

    fireEvent.click(screen.getByRole('button', { name: /^企业模式/ }));

    const action = screen.getByRole('button', { name: '验证并进入企业模式' });
    const input = screen.getByPlaceholderText('https://your-company-server.com');
    expect(screen.getByText('企业服务器地址')).toBeInTheDocument();
    expect(action).toBeDisabled();

    fireEvent.change(input, { target: { value: 'not-a-url' } });
    expect(action).toBeDisabled();

    fireEvent.change(input, { target: { value: 'https://company.example.com' } });
    expect(action).toBeEnabled();
  });
});
