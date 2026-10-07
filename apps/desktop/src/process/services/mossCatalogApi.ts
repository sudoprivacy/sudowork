import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { IMossCatalogItem, IMossCatalogPage, MossCatalogKind, MossCatalogSource } from '@sudowork/common/mossCatalog';
import { ProcessConfig, getHubSkillsDir } from '@process/initStorage';
import { safeResourcePath } from './mossResourcePath';

export function mossCatalogIdentity() {
  const server = ProcessConfig.getSync('eeclaw.serverUrl');
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  if (!server || !scope) throw new Error('Moss account is unavailable');
  return { server: server.replace(/\/+$/, ''), scope };
}

export function assertMossCatalogIdentity(identity: ReturnType<typeof mossCatalogIdentity>) {
  const current = mossCatalogIdentity();
  if (identity.server !== current.server || identity.scope !== current.scope) throw new Error('Moss account changed');
}

export async function requestMossCatalog(route: string, body?: unknown): Promise<Response> {
  const identity = mossCatalogIdentity();
  if (!route.startsWith('/api/v1/') || route.includes('://')) throw new Error('Invalid Moss resource URL');
  const { getValidToken } = await import('@process/bridge/eeclawBridge');
  const token = await getValidToken();
  assertMossCatalogIdentity(identity);
  const response = await fetch(`${identity.server}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
    redirect: 'error',
  });
  assertMossCatalogIdentity(identity);
  if (!response.ok) throw new Error(`Moss resource request failed: HTTP ${response.status}`);
  return response;
}

const rawItem = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough();
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const string = (value: unknown) => (typeof value === 'string' ? value : '');

/** Resolve authenticated and packaged images without exposing access tokens to the renderer. */
export async function catalogAppearance(meta: Record<string, unknown>, directory?: string): Promise<{ icon?: string; emoji?: string }> {
  const raw = string(meta.avatar) || string(meta.icon);
  const emoji = string(meta.emoji) || (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(raw) ? raw : '');
  if (!raw || raw === emoji) return { emoji: emoji || undefined };
  let icon = raw;
  try {
    if (raw.startsWith('/api/v1/')) {
      const response = await requestMossCatalog(raw);
      const mime = response.headers.get('content-type') || '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!mime.startsWith('image/') || bytes.length > 2 * 1024 * 1024) return { emoji };
      icon = `data:${mime};base64,${bytes.toString('base64')}`;
    } else if (directory && !/^(https?:|data:)/.test(raw)) {
      const file = safeResourcePath(directory, raw);
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' } as Record<string, string>)[path.extname(file).toLowerCase()];
      if (mime && (await fs.stat(file)).size <= 2 * 1024 * 1024) icon = `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
    }
  } catch {
    /* A missing image must not hide an otherwise accessible resource. */
  }
  return { icon, emoji: emoji || undefined };
}

async function normalize(value: unknown, kind: MossCatalogKind, source: MossCatalogSource): Promise<IMossCatalogItem> {
  const item = rawItem.parse(value);
  if (typeof item.isAvailable !== 'boolean') throw new Error('Moss catalog protocol is unavailable; update the Moss server');
  const latest = item.latestVersion && typeof item.latestVersion === 'object' ? (item.latestVersion as Record<string, unknown>) : {};
  return {
    id: item.id,
    kind,
    source,
    name: item.name,
    displayName: string(item.display_name) || string(item.displayName) || item.name,
    description: string(item.description),
    ...catalogDescriptions(item),
    ...(await catalogAppearance(item)),
    categories: strings(parseJson(item.categories)).length ? strings(parseJson(item.categories)) : [string(item.category)].filter(Boolean),
    version: string(item.catalogVersion) || string(item.version) || string(latest.version),
    status: string(item.status) || undefined,
    isAvailable: item.isAvailable === true,
    isLocalAllowed: item.agent_type !== 'workflow' && !['enabledMcpServers', 'enabled_wikis', 'enabledWikis', 'enabled_corp_apps', 'enabledCorpApps'].some((key) => strings(item[key]).length),
  };
}

export function catalogDescriptions(item: Record<string, unknown>) {
  const rawFeatures = parseJson(item.core_features);
  return {
    scenarios: strings(parseJson(item.applicable_scenarios)),
    features: (Array.isArray(rawFeatures) ? rawFeatures : []).flatMap((feature) => {
      if (typeof feature === 'string') return [{ title: feature, description: '' }];
      if (!feature || typeof feature !== 'object') return [];
      const title = string(feature.title) || string(feature.name);
      return title ? [{ title, description: string(feature.desc) || string(feature.description) }] : [];
    }),
  };
}

async function fetchMossCatalog(input: { kind: MossCatalogKind; source: MossCatalogSource; query?: string; category?: string; cursor?: string }): Promise<IMossCatalogPage> {
  const { kind, source, query = '', category = '', cursor } = input;
  if (source === 'tenant') {
    const data: unknown = await (await requestMossCatalog(`/api/v1/${kind}/tenant`)).json();
    const items = await Promise.all(
      z
        .array(rawItem)
        .parse(data)
        .map((item) => normalize(item, kind, source))
    );
    return { items: items.filter((item) => (!category || item.categories.includes(category)) && `${item.displayName} ${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())), nextCursor: null, categories: [...new Set(items.flatMap((item) => item.categories))].sort() };
  }
  const base = kind === 'agents' ? 'agent-hub' : 'skill-hub';
  const resource = kind === 'agents' ? 'assistants' : 'skills';
  const params = new URLSearchParams({ limit: '40', query, category });
  if (cursor) params.set('cursor', cursor);
  const [data, categories] = await Promise.all([requestMossCatalog(`/api/v1/${base}/${resource}/cursor?${params}`).then((res) => res.json() as Promise<Record<string, unknown>>), requestMossCatalog(`/api/v1/${base}/categories`).then((res) => res.json() as Promise<unknown>)]);
  return {
    items: await Promise.all(
      z
        .array(rawItem)
        .parse(data[resource])
        .map((item) => normalize(item, kind, source))
    ),
    nextCursor: string(data.next_cursor) || null,
    categories: strings(categories),
  };
}

export async function detailMossCatalog(input: { kind: MossCatalogKind; source: MossCatalogSource; id: string }): Promise<IMossCatalogItem> {
  const identity = mossCatalogIdentity();
  if (input.source === 'tenant') {
    const item = (await listMossCatalog(input)).items.find((item) => item.id === input.id);
    if (!item) throw new Error('Resource is unavailable');
    if (input.kind === 'agents') {
      const data = (await (await requestMossCatalog(`/api/v1/agent-templates/tenant/${encodeURIComponent(input.id)}/rules`)).json()) as { rules?: string };
      assertMossCatalogIdentity(identity);
      return { ...item, content: data.rules };
    }
    const data = (await (await requestMossCatalog(`/api/v1/skills/tenant/${encodeURIComponent(input.id)}/content`)).json()) as { content?: string };
    assertMossCatalogIdentity(identity);
    return { ...item, content: data.content };
  }
  const base = input.kind === 'agents' ? 'agent-hub/assistants' : 'skill-hub/skills';
  const data = (await (await requestMossCatalog(`/api/v1/${base}/${encodeURIComponent(input.id)}`)).json()) as Record<string, unknown>;
  const item = await normalize(data, input.kind, input.source);
  assertMossCatalogIdentity(identity);
  return { ...item, content: string(data.systemPrompt) || string(data.content) || string(data.readme) || string(data.rules) || undefined };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Cache catalog metadata within the current account; browsing never downloads resource packages. */
export async function listMossCatalog(input: { kind: MossCatalogKind; source: MossCatalogSource; query?: string; category?: string; cursor?: string }): Promise<IMossCatalogPage> {
  const identity = mossCatalogIdentity();
  const key = createHash('sha256')
    .update(JSON.stringify([identity, input]))
    .digest('hex');
  const directory = path.join(path.dirname(getHubSkillsDir()), '_catalog-cache');
  const file = path.join(directory, `${key}.json`);
  let result: IMossCatalogPage;
  try {
    result = await fetchMossCatalog(input);
  } catch (error) {
    assertMossCatalogIdentity(identity);
    // Authentication/authorization failures must never be concealed by cached visibility.
    if (error instanceof Error && /HTTP (401|403)/.test(error.message)) throw error;
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8')) as IMossCatalogPage;
      assertMossCatalogIdentity(identity);
      return { ...cached, isCached: true };
    } catch {
      throw error;
    }
  }
  assertMossCatalogIdentity(identity);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(file, JSON.stringify(result), { mode: 0o600 });
  assertMossCatalogIdentity(identity);
  return result;
}
