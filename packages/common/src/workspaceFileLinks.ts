/** Resolve a file link against a session workspace, without browser URL resolution. */
export function resolveWorkspaceFileLink(href: string, workspace?: string): { path: string; relativePath?: string } | null {
  if (!href || href.startsWith('#') || href.startsWith('?') || href.startsWith('//')) return null;
  let value = href;
  if (/^file:\/\//i.test(value)) value = value.replace(/^file:\/\//i, '');
  else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[/\\]/i.test(value)) return null;
  value = value.split(/[?#]/, 1)[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  value = value.replace(/\\/g, '/');
  if (!value || value.includes('\0')) return null;
  const root = workspace?.replace(/\\/g, '/').replace(/\/+$/, '');
  const isAbsolute = value.startsWith('/') || /^[a-z]:\//i.test(value);
  if (isAbsolute && root && (value === root || value.startsWith(`${root}/`))) value = value.slice(root.length + 1);
  else if (isAbsolute) return { path: value };
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  const relativePath = parts.join('/');
  return relativePath ? { path: root ? `${root}/${relativePath}` : relativePath, relativePath } : null;
}

/** Extract explicit file links from assistant prose for legacy deliverables. */
export function extractWorkspaceFileLinks(text: string, workspace?: string): string[] {
  const links: string[] = [];
  const prose = text.replace(/```[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    const resolved = resolveWorkspaceFileLink(match[1] || match[2], workspace);
    if (resolved?.relativePath) links.push(resolved.relativePath);
  }
  return [...new Set(links)];
}
