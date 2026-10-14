import fs from 'node:fs';
import path from 'node:path';

/** Keep native startup evidence without exporting identities or service tokens. */
export function recordRuntimeEvidence(root: string | undefined, label: string): void {
  const destination = process.env.SUDOWORK_RUNTIME_EVIDENCE_DIR;
  if (!root || !destination) return;
  const directory = path.join(destination, label);
  fs.mkdirSync(directory, { recursive: true });
  for (const filename of ['runtime.log', 'runtime.previous.log']) {
    const source = path.join(root, 'run', filename);
    if (!fs.existsSync(source)) continue;
    const log = fs
      .readFileSync(source, 'utf8')
      .replace(/synthetic-value-[\w-]+/g, '[fixture-secret]')
      .replace(/(authorization|api[_-]?key|token)(["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1$2[redacted]');
    fs.writeFileSync(path.join(directory, filename), log);
  }
  fs.writeFileSync(path.join(directory, 'placement.json'), JSON.stringify({ platform: process.platform, recordedAt: new Date().toISOString(), hasDiscovery: fs.existsSync(path.join(root, 'run', 'service.json')), hasRuntimeLog: fs.existsSync(path.join(root, 'run', 'runtime.log')) }, null, 2));
}
