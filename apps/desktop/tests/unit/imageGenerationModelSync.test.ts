import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSudoclawImageGenerationModel } from '@/process/bridge/imageGenerationModelSync';

let tempDir: string | null = null;

function configPath(initial?: unknown): string {
  tempDir = mkdtempSync(path.join(tmpdir(), 'sudowork-imggen-sync-'));
  const p = path.join(tempDir, 'sudoclaw.json');
  if (initial !== undefined) {
    writeFileSync(p, JSON.stringify(initial, null, 2), 'utf-8');
  }
  return p;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('writeSudoclawImageGenerationModel', () => {
  it('writes agents.defaults.imageGenerationModel into an existing config', () => {
    const p = configPath({ agents: { defaults: { model: { primary: 'sudorouter/gemini-3-flash' } } } });

    writeSudoclawImageGenerationModel('gpt-image-1.5', p);

    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed.agents.defaults.imageGenerationModel).toBe('gpt-image-1.5');
    // Existing fields are preserved.
    expect(parsed.agents.defaults.model.primary).toBe('sudorouter/gemini-3-flash');
  });

  it('clears the model with an empty string when the feature is off', () => {
    const p = configPath({ agents: { defaults: { imageGenerationModel: 'gpt-image-1.5' } } });

    writeSudoclawImageGenerationModel('', p);

    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed.agents.defaults.imageGenerationModel).toBe('');
  });

  it('creates the agents.defaults path when missing', () => {
    const p = configPath({ models: { providers: {} } });

    writeSudoclawImageGenerationModel('gemini-3-pro-image', p);

    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(parsed.agents.defaults.imageGenerationModel).toBe('gemini-3-pro-image');
    expect(parsed.models.providers).toEqual({});
  });

  it('is a no-op when the config file does not exist', () => {
    const p = configPath(); // no file written

    expect(() => writeSudoclawImageGenerationModel('gpt-image-1.5', p)).not.toThrow();
    expect(existsSync(p)).toBe(false);
  });
});
