import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from '@renderer/utils/platform';

const shell = vi.hoisted(() => ({ openFile: { invoke: vi.fn() }, openExternal: { invoke: vi.fn() } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ shell }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('desktop deliverable links', () => {
  it.each([
    ['C:/output/video.mp4', 'C:/output/video.mp4'],
    ['/C:/output/video.mp4', 'C:/output/video.mp4'],
    ['C:\\output\\captions.srt', 'C:\\output\\captions.srt'],
    ['file:///C:/output/%E5%AD%97%E5%B9%95%20%231.srt', 'C:/output/字幕 #1.srt'],
    ['file:///tmp/video.mp4', '/tmp/video.mp4'],
    ['/tmp/100%.srt', '/tmp/100%.srt'],
  ])('opens %s with the desktop file handler', async (url, expectedPath) => {
    vi.stubGlobal('window', { electronAPI: {} });
    await openExternalUrl(url);
    expect(shell.openFile.invoke).toHaveBeenCalledWith(expectedPath);
    expect(shell.openExternal.invoke).not.toHaveBeenCalled();
  });

  it('keeps website links in the external browser', async () => {
    vi.stubGlobal('window', { electronAPI: {} });
    await openExternalUrl('https://example.com/video.mp4');
    expect(shell.openExternal.invoke).toHaveBeenCalledWith('https://example.com/video.mp4');
    expect(shell.openFile.invoke).not.toHaveBeenCalled();
  });

  it('uses the browser on WebUI', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    await openExternalUrl('https://example.com/video.mp4');
    expect(open).toHaveBeenCalledWith('https://example.com/video.mp4', '_blank', 'noopener,noreferrer');
    expect(shell.openFile.invoke).not.toHaveBeenCalled();
  });
});
