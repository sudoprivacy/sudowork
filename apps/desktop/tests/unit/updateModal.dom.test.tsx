import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Outlet } from 'react-router-dom';
import type { AutoUpdateStatus, UpdateCheckResult } from '@sudowork/common/updateTypes';

const state = vi.hoisted(() => ({
  isNightly: false,
  authStatus: 'unauthenticated',
  t: (key: string) => key,
  autoCheck: vi.fn(),
  autoDownload: vi.fn(),
  getStatus: vi.fn(),
  manualCheck: vi.fn(),
  manualDownload: vi.fn(),
  openExternal: vi.fn(),
  statusListeners: new Set<(event: AutoUpdateStatus) => void>(),
  openListeners: new Set<() => void>(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@sudowork/common/buildInfo', () => ({
  get isNightlyBuild() {
    return state.isNightly;
  },
  buildVersion: '0.2.26',
}));
vi.mock('@renderer/components/Markdown', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  update: {
    check: { invoke: state.manualCheck },
    download: { invoke: state.manualDownload },
    open: {
      on: (listener: () => void) => {
        state.openListeners.add(listener);
        return () => state.openListeners.delete(listener);
      },
    },
    downloadProgress: { on: () => () => undefined },
  },
  autoUpdate: {
    check: { invoke: state.autoCheck },
    download: { invoke: state.autoDownload },
    getStatus: { invoke: state.getStatus },
    quitAndInstall: { invoke: vi.fn() },
    status: {
      on: (listener: (event: AutoUpdateStatus) => void) => {
        state.statusListeners.add(listener);
        return () => state.statusListeners.delete(listener);
      },
    },
  },
  shell: { openExternal: { invoke: state.openExternal }, openFile: { invoke: vi.fn() }, showItemInFolder: { invoke: vi.fn() } },
}));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ status: state.authStatus, isGuest: false }) }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ mode: 'c', isEnterprise: false }), isModeResolved: () => true }));
vi.mock('@renderer/hooks/useCronAccess', () => ({ useCronAccess: () => ({ isCronVisible: true }) }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@renderer/pages/login', () => ({ default: () => <div>Login page</div> }));
vi.mock('@renderer/pages/guid', () => ({ default: () => <div>Home page</div> }));

import UpdateModal from '@renderer/layouts/components/UpdateModal';
import PanelRoute from '@renderer/router';

function release(version = '0.2.27', isCompatible = true): UpdateCheckResult {
  const asset = { name: `Sudowork-${version}-mac-x64.dmg`, url: `https://downloads.example/${version}.dmg`, size: 42 };
  return { currentVersion: '0.2.26', updateAvailable: true, latest: { version, tagName: `v${version}`, htmlUrl: `https://releases.example/${version}`, prerelease: false, draft: false, assets: isCompatible ? [asset] : [], recommendedAsset: isCompatible ? asset : undefined } };
}

async function onStatus(event: AutoUpdateStatus) {
  await act(async () => {
    state.statusListeners.forEach((listener) => listener(event));
  });
}

async function onOpen() {
  await act(async () => {
    state.openListeners.forEach((listener) => listener());
  });
}

beforeEach(() => {
  state.isNightly = false;
  state.authStatus = 'unauthenticated';
  localStorage.clear();
  state.autoCheck.mockReset().mockResolvedValue({ success: true, data: { updateInfo: { version: '0.2.27' } } });
  state.autoDownload.mockReset().mockResolvedValue({ success: true });
  state.getStatus.mockReset().mockResolvedValue({ success: true, data: null });
  state.manualCheck.mockReset().mockResolvedValue({ success: true, data: release() });
  state.manualDownload.mockReset().mockResolvedValue({ success: true, data: { downloadId: 'test-download', filePath: '/test/update.dmg' } });
  state.openExternal.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('update availability', () => {
  it('downloads a startup-discovered native update while manual metadata is unavailable', async () => {
    state.manualCheck.mockReturnValue(new Promise(() => undefined));
    render(<UpdateModal />);
    await onStatus({ status: 'available', version: '0.2.27' });
    expect(screen.queryByText('update.noCompatibleAssetManual')).toBeNull();
    expect(screen.queryByRole('button', { name: 'update.downloadButton' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'update.downloadAndInstall' }));
    await waitFor(() => expect(state.autoDownload).toHaveBeenCalledOnce());
    expect(state.manualDownload).not.toHaveBeenCalled();
  });

  it.each(['reject', 'no asset', 'different version'])('keeps a valid native update when optional details return %s', async (mode) => {
    if (mode === 'reject') state.manualCheck.mockRejectedValue(new Error('metadata offline'));
    else state.manualCheck.mockResolvedValue({ success: true, data: release(mode === 'different version' ? '0.2.28' : '0.2.27', false) });
    render(<UpdateModal />);
    await onOpen();
    await waitFor(() => expect(state.manualCheck).toHaveBeenCalledOnce());
    expect(screen.queryByText('update.noCompatibleAssetManual')).toBeNull();
    expect(screen.queryByRole('button', { name: 'update.goToRelease' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'update.downloadAndInstall' }));
    await waitFor(() => expect(state.autoDownload).toHaveBeenCalledOnce());
  });

  it('falls back to an in-app manual download if the native updater is unavailable', async () => {
    state.autoCheck.mockRejectedValue(new Error('updater unavailable'));
    render(<UpdateModal />);
    await onOpen();
    expect(screen.queryByRole('button', { name: 'update.downloadAndInstall' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'update.downloadButton' }));
    await waitFor(() => expect(state.manualDownload).toHaveBeenCalledWith({ url: 'https://downloads.example/0.2.27.dmg', fileName: 'Sudowork-0.2.27-mac-x64.dmg', sha512: undefined }));
    expect(state.autoDownload).not.toHaveBeenCalled();
  });

  it('only reports an unsupported platform after both download routes are unavailable', async () => {
    state.autoCheck.mockResolvedValue({ success: false, msg: 'no native feed' });
    state.manualCheck.mockResolvedValue({ success: true, data: release('0.2.27', false) });
    render(<UpdateModal />);
    await onOpen();
    expect(await screen.findByText('update.noCompatibleAssetManual')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'update.goToRelease' }));
    await waitFor(() => expect(state.openExternal).toHaveBeenCalledWith('https://releases.example/0.2.27'));
  });

  it('ignores details from a superseded update', async () => {
    let onResolveOld!: (result: unknown) => void;
    state.manualCheck
      .mockReturnValueOnce(
        new Promise((resolve) => {
          onResolveOld = resolve;
        })
      )
      .mockResolvedValueOnce({ success: true, data: release('0.2.28') });
    render(<UpdateModal />);
    await onStatus({ status: 'available', version: '0.2.27' });
    await onStatus({ status: 'available', version: '0.2.28' });
    await act(async () => onResolveOld({ success: true, data: release('0.2.27') }));
    fireEvent.click(screen.getByRole('button', { name: 'update.downloadButton' }));
    await waitFor(() => expect(state.manualDownload.mock.calls[0][0].url).toBe('https://downloads.example/0.2.28.dmg'));
  });

  it('restores a startup update on the login page and keeps one listener across login', async () => {
    location.hash = '#/login';
    state.getStatus.mockResolvedValue({ success: true, data: { status: 'available', version: '0.2.27' } });
    const { rerender } = render(<PanelRoute layout={<Outlet />} />);
    expect(await screen.findByText('Login page')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'update.downloadAndInstall' })).toBeTruthy();
    expect(state.statusListeners.size).toBe(1);
    state.authStatus = 'authenticated';
    rerender(<PanelRoute layout={<Outlet />} />);
    expect(await screen.findByText('Home page')).toBeTruthy();
    expect(state.statusListeners.size).toBe(1);
    expect(screen.getByRole('button', { name: 'update.downloadAndInstall' })).toBeTruthy();
  });

  it('does not let a late snapshot overwrite a newer live event', async () => {
    let onResolveSnapshot!: (result: unknown) => void;
    state.getStatus.mockReturnValue(
      new Promise((resolve) => {
        onResolveSnapshot = resolve;
      })
    );
    render(<UpdateModal />);
    await onStatus({ status: 'available', version: '0.2.28' });
    await act(async () => onResolveSnapshot({ success: true, data: { status: 'available', version: '0.2.27' } }));
    expect(screen.getByText('0.2.28')).toBeTruthy();
    expect(screen.queryByText('0.2.27')).toBeNull();
  });

  it('keeps nightly releases on the manual installation route', async () => {
    state.isNightly = true;
    render(<UpdateModal />);
    await onOpen();
    expect(state.autoCheck).not.toHaveBeenCalled();
    expect(state.manualCheck).toHaveBeenCalledWith({ includePrerelease: true });
    expect(await screen.findByRole('button', { name: 'update.downloadButton' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'update.downloadAndInstall' })).toBeNull();
  });

  it('does not replace an authoritative up-to-date result with another release channel', async () => {
    state.autoCheck.mockResolvedValue({ success: true, data: {} });
    render(<UpdateModal />);
    await onOpen();
    expect(await screen.findByText('update.upToDateTitle')).toBeTruthy();
    expect(state.manualCheck).not.toHaveBeenCalled();
  });
});
