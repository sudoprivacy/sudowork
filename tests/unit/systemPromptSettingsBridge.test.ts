import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configSet, readAssistantResource } = vi.hoisted(() => ({
  configSet: vi.fn(),
  readAssistantResource: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
}));

vi.mock('@/common', () => ({
  ipcBridge: { systemSettings: {} },
}));

vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
    set: (...args: unknown[]) => configSet(...args),
  },
}));

vi.mock('@process/utils/assistantResources', () => ({
  readAssistantResource: (...args: unknown[]) => readAssistantResource(...args),
  ruleFilePattern: (id: string, locale: string) => `${id}.${locale}.md`,
}));

vi.mock('@process/i18n', () => ({ changeLanguage: vi.fn() }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));
vi.mock('@process/telemetry/BreadcrumbTracker', () => ({
  userBreadcrumbs: { settingsChange: vi.fn() },
}));

describe('system prompt settings bridge', () => {
  beforeEach(() => {
    configSet.mockReset();
    readAssistantResource.mockReset();
  });

  it('loads the effective prompt for the brand-default assistant', async () => {
    readAssistantResource.mockResolvedValue('# Gewu');
    const { getDefaultAssistantSystemPrompt } = await import('@/process/bridge/systemSettingsBridge');

    await expect(getDefaultAssistantSystemPrompt()).resolves.toEqual({ agentId: 'gewu', content: '# Gewu' });
    expect(readAssistantResource).toHaveBeenCalledWith('rules', 'builtin-gewu', 'zh-CN', expect.any(Function));
  });

  it('persists non-empty content for the brand-default assistant', async () => {
    configSet.mockResolvedValue(undefined);
    const { setDefaultAssistantSystemPrompt } = await import('@/process/bridge/systemSettingsBridge');

    await setDefaultAssistantSystemPrompt('# Updated Gewu');

    expect(configSet).toHaveBeenCalledWith('assistant.systemPromptOverride', {
      assistantId: 'gewu',
      content: '# Updated Gewu',
    });
  });

  it('rejects blank content at the main-process boundary', async () => {
    const { setDefaultAssistantSystemPrompt } = await import('@/process/bridge/systemSettingsBridge');

    await expect(setDefaultAssistantSystemPrompt('   ')).rejects.toThrow('System prompt cannot be empty');
    expect(configSet).not.toHaveBeenCalled();
  });
});
