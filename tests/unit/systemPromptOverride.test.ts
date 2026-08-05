import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configGet, readFile, access } = vi.hoisted(() => ({
  configGet: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(async () => undefined),
}));

vi.mock('fs/promises', () => ({
  default: {
    access,
    readFile,
  },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
  },
}));

vi.mock('@/process/initStorage', () => ({
  getAssistantsDir: () => '/assistants',
  ProcessConfig: {
    get: (...args: unknown[]) => configGet(...args),
  },
}));

vi.mock('@/common/enterpriseDebugConfig', () => ({
  isEnterpriseMode: () => false,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainWarn: vi.fn(),
}));

import { readAssistantResource, ruleFilePattern, skillFilePattern } from '@/process/utils/assistantResources';

describe('default assistant system prompt override', () => {
  beforeEach(() => {
    configGet.mockReset();
    readFile.mockReset();
    access.mockClear();
  });

  it('returns the configured override for the brand-default assistant rules', async () => {
    configGet.mockResolvedValue({ assistantId: 'gewu', content: '# Custom Gewu' });

    await expect(readAssistantResource('rules', 'builtin-gewu', 'zh-CN', ruleFilePattern)).resolves.toBe('# Custom Gewu');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('ignores an override saved for a different assistant', async () => {
    configGet.mockResolvedValue({ assistantId: 'cowork', content: '# Wrong assistant' });
    readFile.mockResolvedValue('# Default Gewu');

    await expect(readAssistantResource('rules', 'builtin-gewu', 'zh-CN', ruleFilePattern)).resolves.toBe('# Default Gewu');
  });

  it('does not apply the prompt override to skills', async () => {
    configGet.mockResolvedValue({ assistantId: 'gewu', content: '# Custom Gewu' });
    readFile.mockResolvedValue('# Skills');

    await expect(readAssistantResource('skills', 'builtin-gewu', 'zh-CN', skillFilePattern)).resolves.toBe('# Skills');
    expect(configGet).not.toHaveBeenCalled();
  });

  it('falls back to assistant resources for a blank override', async () => {
    configGet.mockResolvedValue({ assistantId: 'gewu', content: '   ' });
    readFile.mockResolvedValue('# Default Gewu');

    await expect(readAssistantResource('rules', 'builtin-gewu', 'zh-CN', ruleFilePattern)).resolves.toBe('# Default Gewu');
  });
});
