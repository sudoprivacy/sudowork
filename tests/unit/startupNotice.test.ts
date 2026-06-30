/**
 * Guards that a fatal DB-open failure is SURFACED to the user (not silently swallowed
 * into an empty file-backed store). Verifies the dialog is shown with the localized
 * keys, attaches to a live window when present, and never throws on its own failures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { showMessageBox, getAllWindows } = vi.hoisted(() => ({
  showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  getAllWindows: vi.fn(() => [] as unknown[]),
}));

vi.mock('electron', () => ({
  dialog: { showMessageBox },
  BrowserWindow: { getAllWindows },
}));
vi.mock('@process/i18n', () => ({ default: { t: (key: string) => key }, i18nReady: Promise.resolve() }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));

import { notifyDatabaseUnavailable } from '@process/startupNotice';

beforeEach(() => {
  showMessageBox.mockClear();
  getAllWindows.mockReset();
  getAllWindows.mockReturnValue([]);
});

describe('notifyDatabaseUnavailable', () => {
  it('shows a dialog with the localized title + body keys', async () => {
    await notifyDatabaseUnavailable();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const options = showMessageBox.mock.calls[0][0] as { type: string; detail: string; message: string };
    expect(options.type).toBe('error');
    expect(options.message).toBe('runtimeError.database_open_failed.title');
    expect(options.detail).toBe('runtimeError.database_open_failed.body');
  });

  it('uses the parentless overload when no window exists', async () => {
    await notifyDatabaseUnavailable();
    expect(showMessageBox.mock.calls[0]).toHaveLength(1);
  });

  it('attaches to a live (non-destroyed) window when one exists', async () => {
    const win = { isDestroyed: () => false };
    getAllWindows.mockReturnValue([win]);
    await notifyDatabaseUnavailable();
    expect(showMessageBox.mock.calls[0][0]).toBe(win);
    expect(showMessageBox.mock.calls[0]).toHaveLength(2);
  });

  it('falls back to parentless when the only window is destroyed', async () => {
    getAllWindows.mockReturnValue([{ isDestroyed: () => true }]);
    await notifyDatabaseUnavailable();
    expect(showMessageBox.mock.calls[0]).toHaveLength(1);
  });

  it('never throws when the dialog itself fails', async () => {
    showMessageBox.mockRejectedValueOnce(new Error('no display'));
    await expect(notifyDatabaseUnavailable()).resolves.toBeUndefined();
  });
});
