/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitStatus } from '../../src/common/ipcBridge';
import Main from '../../src/renderer/main';

const mockUseAuth = vi.fn();
const mockUseInit = vi.fn();
const mockUseAppMode = vi.fn();
const mockIsModeResolved = vi.fn();

vi.mock('../../src/renderer/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/renderer/context/InitContext', () => ({
  useInit: () => mockUseInit(),
}));

// Main now gates on useAppMode() + isModeResolved() (async app-mode init) before
// the init screen — mock both so tests drive the gate deterministically.
vi.mock('@renderer/hooks/useAppMode', () => ({
  useAppMode: () => mockUseAppMode(),
  isModeResolved: () => mockIsModeResolved(),
}));

vi.mock('@renderer/components/AppLoader', () => ({
  default: ({ text }: { text?: string }) => <div data-testid='app-loader'>{text ?? ''}</div>,
}));

vi.mock('@renderer/pages/setup/ModeSetup', () => ({
  default: () => <div data-testid='mode-setup'>mode-setup</div>,
}));

vi.mock('../../src/renderer/components/InitLoading', () => ({
  default: ({ variant }: { variant?: string }) => <div data-testid='init-loading'>{variant ?? 'full'}</div>,
}));

vi.mock('@renderer/layouts/layout', () => ({
  default: ({ children }: React.PropsWithChildren) => <div data-testid='layout'>{children}</div>,
}));

vi.mock('../../src/renderer/router', () => ({
  default: () => <div data-testid='router'>router</div>,
}));

vi.mock('../../src/renderer/sider', () => ({
  default: () => <div data-testid='sider'>sider</div>,
}));

function createInitStatus(overrides: Partial<InitStatus> = {}): InitStatus {
  return {
    phase: 'installing',
    message: '正在并行准备运行环境...',
    progress: 5,
    displayMode: 'full',
    ...overrides,
  };
}

describe('Main init gate', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseInit.mockReset();
    mockUseAppMode.mockReset();
    mockIsModeResolved.mockReset();
    mockUseAuth.mockReturnValue({ ready: true });
    // Default: app-mode resolved, existing user (no first-time setup).
    mockUseAppMode.mockReturnValue({ needsSetup: false, isEnterprise: false });
    mockIsModeResolved.mockReturnValue(true);
  });

  it('shows the init screen while initialization is blocking', () => {
    mockUseInit.mockReturnValue({
      status: createInitStatus(),
      isReady: false,
      hasResolvedInitialStatus: true,
      isInitScreenSkipped: false,
      skipInitScreen: vi.fn(),
      refetch: vi.fn(),
    });

    render(<Main />);

    expect(screen.getByTestId('init-loading')).toHaveTextContent('full');
    expect(screen.queryByTestId('router')).not.toBeInTheDocument();
  });

  it('waits for app mode to resolve before rendering the init screen', () => {
    // Before useAppMode finishes async init, Main shows a lightweight loader —
    // never the init screen or the router — to avoid a first-frame flash.
    mockIsModeResolved.mockReturnValue(false);
    mockUseInit.mockReturnValue({
      status: createInitStatus({ phase: 'pending', displayMode: undefined }),
      isReady: false,
      hasResolvedInitialStatus: true,
      isInitScreenSkipped: false,
      skipInitScreen: vi.fn(),
      refetch: vi.fn(),
    });

    render(<Main />);

    expect(screen.getByTestId('app-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('init-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('router')).not.toBeInTheDocument();
  });

  it('renders the app when the init screen was skipped', () => {
    mockUseInit.mockReturnValue({
      status: createInitStatus(),
      isReady: false,
      hasResolvedInitialStatus: true,
      isInitScreenSkipped: true,
      skipInitScreen: vi.fn(),
      refetch: vi.fn(),
    });

    render(<Main />);

    expect(screen.getByTestId('router')).toBeInTheDocument();
    expect(screen.queryByTestId('init-loading')).not.toBeInTheDocument();
  });
});
