import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Versioned ShareOne frontend, built from its own components rather than copied UI. */
export class ShareoneReviewAssets {
  private readonly files = new Map<string, { body: Buffer; contentType: string }>();
  private entry = '';
  private styles: string[] = [];

  async load(directory: string): Promise<void> {
    const root = await realpath(directory);
    const manifest = JSON.parse(await readFile(path.join(root, 'review-assets.json'), 'utf8')) as {
      format: string;
      entry: string;
      styles: string[];
      files: Record<string, { sha256: string; bytes: number }>;
    };
    if (manifest.format !== 'shareone-review-shell/v1' || !Array.isArray(manifest.styles) || !manifest.files || Object.keys(manifest.files).length > 500) throw new Error('Invalid ShareOne review asset manifest.');
    const files = new Map<string, { body: Buffer; contentType: string }>();
    let total = 0;
    for (const [name, receipt] of Object.entries(manifest.files)) {
      if (!/^[A-Za-z0-9_./-]+\.(js|css|woff2?)$/.test(name) || name.includes('..')) throw new Error('Invalid ShareOne review asset path.');
      const filename = await realpath(path.join(root, name));
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('ShareOne review asset escapes its installation.');
      const body = await readFile(filename);
      total += body.length;
      if (total > 64 * 1024 * 1024 || body.length !== receipt.bytes || createHash('sha256').update(body).digest('hex') !== receipt.sha256) throw new Error('ShareOne review asset differs from its receipt.');
      files.set(name, { body, contentType: name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'font/woff2' });
    }
    if (!files.has(manifest.entry) || !manifest.styles.length || manifest.styles.some((style) => !files.has(style))) throw new Error('ShareOne review asset entry is missing.');
    this.entry = manifest.entry;
    this.styles = manifest.styles;
    this.files.clear();
    for (const [name, file] of files) this.files.set(name, file);
  }

  get(name: string): { body: Uint8Array; contentType: string } | undefined {
    return this.files.get(name);
  }

  shell(prefix: string, config: Record<string, unknown>): string {
    if (!this.entry) throw new Error('Install the pinned ShareOne review shell before opening review.');
    const json = JSON.stringify(config).replace(/</g, '\\u003c');
    return (
      '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      this.styles.map((name) => `<link rel="stylesheet" href="${prefix}/assets/${name}">`).join('') +
      '</head><body><div id="root"></div><script>window.__SHARE_CONFIG__=' +
      json +
      `;</script><script type="module" src="${prefix}/assets/${this.entry}"></script></body></html>`
    );
  }
}
