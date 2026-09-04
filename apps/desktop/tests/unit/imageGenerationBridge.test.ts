import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageGenerationModelConfig } from '@sudowork/common/imageGenerationModelConfig';

let tempRoot = '';

async function loadImageGenerationBridge(processImageModel?: ImageGenerationModelConfig) {
  vi.resetModules();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-imggen-bridge-'));
  const scodeDir = path.join(tempRoot, 'scode');
  const sudoclawDir = path.join(tempRoot, 'sudoclaw');
  fs.mkdirSync(scodeDir, { recursive: true });
  fs.mkdirSync(sudoclawDir, { recursive: true });

  vi.doMock('electron', () => ({
    app: {
      getPath: () => tempRoot,
    },
  }));
  vi.doMock('@/common', () => ({
    ipcBridge: {
      conversation: { responseStream: { emit: vi.fn() } },
      tools: {
        generateImage: { provider: vi.fn() },
        generateUserAvatar: { provider: vi.fn() },
      },
    },
  }));
  vi.doMock('@process/initStorage', () => ({
    ProcessConfig: {
      get: vi.fn(async (key: string) => {
        if (key === 'tools.imageGenerationModel') return processImageModel;
        if (key === 'model.config') return [];
        return undefined;
      }),
    },
  }));
  vi.doMock('@process/services/scode/ScodeInstallService', () => ({
    SCODE_DIR: scodeDir,
  }));
  vi.doMock('@process/services/sudoclaw/SudoclawInstallService', () => ({
    SUDOCLAW_DIR: sudoclawDir,
  }));

  const bridge = await import('@/process/bridge/imageGenerationBridge');
  return { ...bridge, scodeDir, sudoclawDir };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  }
});

describe('imageGenerationBridge config resolution', () => {
  it('resolves external api-key provider credentials and preserves namespaced model ids', async () => {
    const { resolveImageConfig, scodeDir, sudoclawDir } = await loadImageGenerationBridge();
    fs.writeFileSync(
      path.join(scodeDir, 'sudocode.json'),
      JSON.stringify({
        auth_modes: {
          'api-key': {
            custom: { baseUrl: 'https://images.example.com/v1/', apiKey: 'external-key' },
          },
        },
      })
    );
    fs.writeFileSync(
      path.join(sudoclawDir, 'sudoclaw.json'),
      JSON.stringify({
        agents: {
          defaults: {
            imageGenerationModel: 'custom/black-forest-labs/FLUX.1-schnell',
          },
        },
      })
    );

    await expect(resolveImageConfig()).resolves.toEqual({
      baseUrl: 'https://images.example.com/v1',
      apiKey: 'external-key',
      model: 'black-forest-labs/FLUX.1-schnell',
    });
  });

  it('falls back to sudorouter credentials for bare image model ids', async () => {
    const { resolveImageConfig, scodeDir, sudoclawDir } = await loadImageGenerationBridge();
    fs.writeFileSync(
      path.join(scodeDir, 'sudocode.json'),
      JSON.stringify({
        auth_modes: {
          proxy: {
            sudorouter: { baseUrl: 'https://router.example.com/v1/', apiKey: 'router-key' },
          },
        },
      })
    );
    fs.writeFileSync(
      path.join(sudoclawDir, 'sudoclaw.json'),
      JSON.stringify({
        agents: {
          defaults: {
            imageGenerationModel: 'gemini-3-pro-image',
          },
        },
      })
    );

    await expect(resolveImageConfig()).resolves.toEqual({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'router-key',
      model: 'gemini-3-pro-image',
    });
  });
});
