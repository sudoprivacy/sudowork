import { describe, expect, it, vi } from 'vitest';
import { setAcpModelWithScodePersistence } from '@/process/bridge/acpModelSwitch';

describe('setAcpModelWithScodePersistence', () => {
  it('persists scode default model only after live model switch succeeds', async () => {
    const onSetModel = vi.fn(async () => ({
      source: 'models' as const,
      currentModelId: 'deepseek-v4-flash',
      currentModelLabel: 'deepseek-v4-flash',
      canSwitch: true,
      availableModels: [{ id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' }],
    }));
    const onPersistScodeDefaultModel = vi.fn();

    const modelInfo = await setAcpModelWithScodePersistence({
      backend: 'scode',
      modelId: 'deepseek-v4-flash',
      onSetModel,
      onPersistScodeDefaultModel,
    });

    expect(modelInfo?.currentModelId).toBe('deepseek-v4-flash');
    expect(onSetModel).toHaveBeenCalledWith('deepseek-v4-flash');
    expect(onPersistScodeDefaultModel).toHaveBeenCalledWith('deepseek-v4-flash');
    expect(onSetModel.mock.invocationCallOrder[0]).toBeLessThan(onPersistScodeDefaultModel.mock.invocationCallOrder[0]);
  });

  it('does not persist scode default model when live model switch fails', async () => {
    const onSetModel = vi.fn(async () => {
      throw new Error('api returned 400 Bad Request');
    });
    const onPersistScodeDefaultModel = vi.fn();

    await expect(
      setAcpModelWithScodePersistence({
        backend: 'scode',
        modelId: 'deepseek-anthropic/deepseek-v4-flash',
        onSetModel,
        onPersistScodeDefaultModel,
      })
    ).rejects.toThrow('api returned 400 Bad Request');

    expect(onPersistScodeDefaultModel).not.toHaveBeenCalled();
  });

  it('does not persist defaults for non-scode backends', async () => {
    const onSetModel = vi.fn(async () => null);
    const onPersistScodeDefaultModel = vi.fn();

    await setAcpModelWithScodePersistence({
      backend: 'codex',
      modelId: 'gpt-5.4',
      onSetModel,
      onPersistScodeDefaultModel,
    });

    expect(onPersistScodeDefaultModel).not.toHaveBeenCalled();
  });
});
