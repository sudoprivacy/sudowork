import path from 'node:path';

export function safeResourcePath(root: string, relative: string): string {
  const normalized = relative.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error('Unsafe resource archive path');
  const result = path.resolve(root, normalized);
  if (result !== path.resolve(root) && !result.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Unsafe resource archive path');
  return result;
}
