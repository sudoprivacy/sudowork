import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const helperPath = path.resolve('skills/image-generation/scripts/generate_image.py');

// Python's command name is not portable (`python3` on POSIX, `python`/`py` on
// Windows). Resolve it so this real-Python integration test runs wherever an
// interpreter exists and skips cleanly (rather than failing) where none does.
function resolvePythonCmd(): string | null {
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const PYTHON = resolvePythonCmd();
const suite = PYTHON ? describe : describe.skip;

suite('image generation Python helper config resolution', () => {
  it('prefers the latest readable config over stale injected env vars', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sudowork-image-helper-'));
    const configPath = path.join(tempDir, 'sudocode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        tools: { imageGenerationModel: 'gpt-image-1' },
        auth_modes: {
          proxy: {
            sudorouter: {
              baseUrl: 'https://new.example/v1',
              apiKey: 'new-key',
            },
          },
        },
      })
    );

    const output = execFileSync(
      PYTHON!,
      [
        '-c',
        `
import importlib.util
import os

spec = importlib.util.spec_from_file_location("generate_image", ${JSON.stringify(helperPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

os.environ["SUDOCODE_CONFIG_PATH"] = ${JSON.stringify(configPath)}
os.environ["IMAGE_MODEL"] = "gpt-image-2"
os.environ["PROVIDER_BASE_URL"] = "https://old.example/v1"
os.environ["PROVIDER_API_KEY"] = "old-key"

config = module.resolve_runtime_config()
print(config["image_model"])
print(config["base_url"])
print(config["api_key"])
`,
      ],
      { encoding: 'utf-8' }
    );

    expect(output.trim().split(/\r?\n/)).toEqual(['gpt-image-1', 'https://new.example/v1', 'new-key']);
  });

  it('falls back to injected env vars when config is unreadable', () => {
    const output = execFileSync(
      PYTHON!,
      [
        '-c',
        `
import importlib.util
import os

spec = importlib.util.spec_from_file_location("generate_image", ${JSON.stringify(helperPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

os.environ["SUDOCODE_CONFIG_PATH"] = "/path/that/does/not/exist/sudocode.json"
os.environ["IMAGE_MODEL"] = "gpt-image-2"
os.environ["PROVIDER_BASE_URL"] = "https://old.example/v1"
os.environ["PROVIDER_API_KEY"] = "old-key"

config = module.resolve_runtime_config()
print(config["image_model"])
print(config["base_url"])
print(config["api_key"])
`,
      ],
      { encoding: 'utf-8' }
    );

    expect(output.trim().split(/\r?\n/)).toEqual(['gpt-image-2', 'https://old.example/v1', 'old-key']);
  });
});
