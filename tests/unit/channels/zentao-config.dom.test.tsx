/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Arco Design mock ─────────────────────────────────────────────────────────
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  };
});

// ── IPC Bridge mock ──────────────────────────────────────────────────────────

const mockTestPlugin = vi.fn().mockResolvedValue({ success: true, data: { success: false, error: 'Not configured' } });
const mockEnablePlugin = vi.fn().mockResolvedValue({ success: true, msg: '' });
const mockGetPluginCredentials = vi.fn().mockResolvedValue({ success: true, data: null });
const mockGetPluginStatus = vi.fn().mockResolvedValue({ success: true, data: [] });

vi.mock('@/common/ipcBridge', () => ({
  channel: {
    testPlugin: { invoke: (...args: unknown[]) => mockTestPlugin(...args) },
    enablePlugin: { invoke: (...args: unknown[]) => mockEnablePlugin(...args) },
    disablePlugin: { invoke: vi.fn().mockResolvedValue({ success: true }) },
    getPluginCredentials: { invoke: (...args: unknown[]) => mockGetPluginCredentials(...args) },
    getPluginStatus: { invoke: (...args: unknown[]) => mockGetPluginStatus(...args) },
    pluginStatusChanged: { on: () => () => {} },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue || key,
  }),
}));

// Import after mocks
import ZentaoConfigForm from '@/renderer/components/SettingsModal/contents/ZentaoConfigForm';

describe('ZentaoConfigForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestPlugin.mockResolvedValue({ success: true, data: { success: false, error: 'Not configured' } });
    mockEnablePlugin.mockResolvedValue({ success: true, msg: '' });
    mockGetPluginCredentials.mockResolvedValue({ success: true, data: null });
    mockGetPluginStatus.mockResolvedValue({ success: true, data: [] });
  });

  it('should render three input fields and a test button', () => {
    render(<ZentaoConfigForm pluginStatus={null} onStatusChange={vi.fn()} />);

    expect(screen.getByPlaceholderText('https://zentao.company.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('admin')).toBeInTheDocument();
    expect(screen.getByText('Test & Connect')).toBeInTheDocument();
  });

  it('should not call testPlugin when submitting empty credentials', async () => {
    render(<ZentaoConfigForm pluginStatus={null} onStatusChange={vi.fn()} />);

    const testButton = screen.getByText('Test & Connect');
    await act(async () => {
      fireEvent.click(testButton);
    });

    expect(mockTestPlugin).not.toHaveBeenCalled();
  });

  it('should call testPlugin with correct IPC parameters on successful test', async () => {
    mockTestPlugin.mockResolvedValue({ success: true, data: { success: true, botInfo: { name: 'Zentao' } } });
    mockEnablePlugin.mockResolvedValue({ success: true, msg: '' });
    mockGetPluginStatus.mockResolvedValue({
      success: true,
      data: [{ type: 'zentao', enabled: true, connected: true, hasToken: true }],
    });

    render(<ZentaoConfigForm pluginStatus={null} onStatusChange={vi.fn()} />);

    // Fill in credentials
    const urlInput = screen.getByPlaceholderText('https://zentao.company.com');
    const usernameInput = screen.getByPlaceholderText('admin');

    await act(async () => {
      fireEvent.change(urlInput, { target: { value: 'https://zentao.example.com' } });
      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    });

    // Find password field
    const inputs = screen.getAllByPlaceholderText('••••••••••');
    const passwordInput = inputs[0];
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: 'testpass' } });
    });

    // Click test button
    const testButton = screen.getByText('Test & Connect');
    await act(async () => {
      fireEvent.click(testButton);
    });

    await waitFor(() => {
      expect(mockTestPlugin).toHaveBeenCalledWith({
        pluginId: 'zentao_default',
        token: 'testuser',
        extraConfig: {
          appId: 'https://zentao.example.com',
          appSecret: 'testpass',
        },
      });
    });
  });

  it('should show connection status when plugin is enabled and connected', () => {
    render(
      <ZentaoConfigForm
        pluginStatus={{
          type: 'zentao',
          enabled: true,
          connected: true,
          hasToken: true,
        } as any}
        onStatusChange={vi.fn()}
      />
    );

    expect(screen.getByText('Connection Status')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});
