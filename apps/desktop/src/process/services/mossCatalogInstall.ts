import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { z } from 'zod';
import type { IMossCatalogItem, IMossCatalogInstallation, IMossCatalogResource, MossCatalogKind, MossCatalogSource } from '@sudowork/common/mossCatalog';
import { getHubSkillsDir, getHubAssistantsDir, clearSkillsCache, ProcessConfig } from '@process/initStorage';
import { getEnterpriseTenantSkillsDir, getEnterpriseTenantAssistantsDir } from '@process/constants/enterpriseStorage';
import { assertMossCatalogIdentity, mossCatalogIdentity, requestMossCatalog, catalogAppearance, catalogDescriptions } from './mossCatalogApi';
import { safeResourcePath } from './mossResourcePath';

const preparedResource = z.object({
  id: z.string().min(1),
  kind: z.enum(['agents', 'skills']),
  source: z.enum(['hub', 'tenant']),
  name: z.string().min(1),
  version: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  downloadRef: z.string(),
  runtimeRef: z.string().startsWith('moss-prepared:'),
  dependencies: z.array(z.string()),
  isLocalAllowed: z.boolean(),
});
const preparationSchema = z.object({ protocolVersion: z.literal(1), preparationId: z.string().regex(/^[a-f0-9]{64}$/), resources: z.array(preparedResource).min(1) });
interface Registry {
  entries: IMossCatalogInstallation[];
  hiddenPaths: string[];
  removedKeys?: string[];
}
const tasks = new Map<string, Promise<unknown>>();
const installationKey = (item: { kind: MossCatalogKind; source: MossCatalogSource; id: string }) => `${item.kind}:${item.source}:${item.id}`;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function catalogResourceRoot(kind: MossCatalogKind, source: MossCatalogSource) {
  if (source === 'tenant') return kind === 'agents' ? getEnterpriseTenantAssistantsDir() : getEnterpriseTenantSkillsDir();
  return kind === 'agents' ? getHubAssistantsDir() : getHubSkillsDir();
}
function registryFile() {
  return path.join(path.dirname(getHubSkillsDir()), '_catalog-installations.json');
}
async function readRegistry(): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(registryFile(), 'utf8')) as Registry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { entries: [], hiddenPaths: [] };
  }
}
async function writeRegistry(registry: Registry, identity: ReturnType<typeof mossCatalogIdentity>) {
  assertMossCatalogIdentity(identity);
  const file = registryFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const staging = `${file}.${randomUUID()}`;
  try {
    await fs.writeFile(staging, JSON.stringify(registry), { mode: 0o600 });
    assertMossCatalogIdentity(identity);
    await fs.rename(staging, file);
  } finally {
    await fs.rm(staging, { force: true });
  }
  clearSkillsCache();
}

/** Managers ignore uncommitted versions and removed snapshots, while old conversations retain their files. */
export async function isCatalogPathVisible(directory: string): Promise<boolean> {
  if (!ProcessConfig.getSync('eeclaw.accountScope')) return true;
  const registry = await readRegistry();
  if (registry.hiddenPaths.includes(directory)) return false;
  const meta = await fs
    .readFile(path.join(directory, '_moss_meta.json'), 'utf8')
    .then((text) => JSON.parse(text) as Record<string, unknown>)
    .catch((): null => null);
  if (typeof meta?.id === 'string') {
    for (const kind of ['agents', 'skills'] as const) {
      for (const source of ['hub', 'tenant'] as const) {
        if (path.dirname(directory) !== catalogResourceRoot(kind, source)) continue;
        const key = installationKey({ kind, source, id: meta.id });
        if (registry.removedKeys?.includes(key)) return false;
        const active = registry.entries.find((entry) => installationKey(entry) === key);
        if (active && active.path !== directory) return false;
      }
    }
  }
  return meta?.catalogManaged !== true || registry.entries.some((entry) => entry.path === directory);
}

/** Adopt complete legacy downloads in this account, never the global personal directories. */
export async function getMossCatalogInstallations(): Promise<IMossCatalogInstallation[]> {
  const identity = mossCatalogIdentity();
  const registry = await readRegistry();
  const entries: IMossCatalogInstallation[] = [];
  for (const entry of registry.entries) {
    if (await isInstallationComplete(entry)) {
      const meta = JSON.parse(await fs.readFile(path.join(entry.path, '_moss_meta.json'), 'utf8')) as Record<string, unknown>;
      entries.push({ ...entry, ...(await catalogAppearance({ ...meta, ...(entry.icon ? { avatar: entry.icon } : {}) }, entry.path)) });
    }
  }
  for (const kind of ['agents', 'skills'] as const)
    for (const source of ['hub', 'tenant'] as const) {
      const root = catalogResourceRoot(kind, source);
      const directories = await fs.readdir(root, { withFileTypes: true }).catch((): never[] => []);
      for (const directory of directories) {
        if (!directory.isDirectory() || directory.name.startsWith('_') || directory.name.startsWith('.')) continue;
        const directoryPath = path.join(root, directory.name);
        if (registry.hiddenPaths.includes(directoryPath)) continue;
        const meta = await fs
          .readFile(path.join(directoryPath, '_moss_meta.json'), 'utf8')
          .then((text) => JSON.parse(text) as Record<string, unknown>)
          .catch((): null => null);
        if (!meta || typeof meta.id !== 'string' || registry.removedKeys?.includes(installationKey({ kind, source, id: meta.id })) || meta.catalogManaged === true || entries.some((entry) => entry.kind === kind && entry.source === source && entry.id === meta.id)) continue;
        const files = await fs.readdir(directoryPath);
        if (kind === 'skills' ? !files.includes('SKILL.md') : !files.some((file) => file.endsWith('.md'))) continue;
        const names = meta.nameI18n as Record<string, string> | undefined;
        entries.push({
          id: meta.id,
          kind,
          source,
          name: String(meta.name || directory.name),
          path: directoryPath,
          runtimeName: directory.name,
          version: String(meta.installed_version || ''),
          digest: String(meta.mossDigest || ''),
          downloadRef: '',
          runtimeRef: meta.id,
          dependencies: Array.isArray(meta.enabledSkills) ? (meta.enabledSkills as string[]) : [],
          isLocalAllowed: true,
          preparationId: '',
          displayName: String(meta.display_name || names?.['zh-CN'] || meta.name || directory.name),
          description: String(meta.description || ''),
          ...(await catalogAppearance(meta, directoryPath)),
          isEnabled: meta.enabled !== false,
        });
      }
    }
  assertMossCatalogIdentity(identity);
  return entries;
}

async function serialized<T>(work: () => Promise<T>): Promise<T> {
  const identity = mossCatalogIdentity();
  const previous = tasks.get(identity.scope);
  const pending = (async () => {
    await previous?.catch(() => {});
    assertMossCatalogIdentity(identity);
    return work();
  })();
  tasks.set(identity.scope, pending);
  try {
    return await pending;
  } finally {
    if (tasks.get(identity.scope) === pending) tasks.delete(identity.scope);
  }
}

export async function installMossCatalog(input: { kind: MossCatalogKind; source: MossCatalogSource; id: string; isUpdate?: boolean }): Promise<IMossCatalogInstallation> {
  return serialized(async () => {
    const identity = mossCatalogIdentity();
    const existing = await getMossCatalogInstallations();
    const current = existing.find((item) => item.kind === input.kind && item.source === input.source && item.id === input.id);
    if (current?.preparationId && !input.isUpdate) {
      await validateCatalogInstallation(current);
      return current;
    }
    if (current && !current.preparationId && input.source === 'hub') {
      const tenantItems = (await (await requestMossCatalog(`/api/v1/${input.kind}/tenant`)).json()) as { id: string }[];
      if (tenantItems.some((item) => item.id === input.id)) input = { ...input, source: 'tenant' };
    }
    const raw: unknown = await (await requestMossCatalog('/api/v1/client/catalog/install', { kind: input.kind, source: input.source, id: input.id })).json();
    const parsed = preparationSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Moss catalog protocol is unavailable; update the Moss server');
    assertMossCatalogIdentity(identity);
    const preparation = parsed.data as { preparationId: string; resources: IMossCatalogResource[] };
    const installed: IMossCatalogInstallation[] = [];
    for (const resource of preparation.resources) {
      if (!resource.downloadRef.startsWith(`/api/v1/client/catalog/preparations/${preparation.preparationId}/`)) throw new Error('Invalid prepared resource URL');
      const response = await requestMossCatalog(resource.downloadRef);
      if (Number(response.headers.get('content-length') || 0) > 50 * 1024 * 1024) throw new Error('Resource archive exceeds size limit');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 50 * 1024 * 1024 || digest(bytes) !== resource.digest || response.headers.get('x-content-sha256') !== resource.digest) throw new Error('Resource checksum mismatch');
      const runtimeName = catalogRuntimeName(resource);
      assertMossCatalogIdentity(identity);
      const root = catalogResourceRoot(resource.kind, resource.source);
      const target = path.join(root, runtimeName);
      await fs.mkdir(root, { recursive: true });
      const staging = path.join(root, `_preparing-${randomUUID()}`);
      await fs.mkdir(staging);
      try {
        const archive = await JSZip.loadAsync(bytes);
        const files = Object.values(archive.files).filter((entry) => !entry.dir);
        if (files.length > 5000) throw new Error('Resource has too many files');
        let expanded = 0;
        for (const entry of files) {
          safeResourcePath(staging, entry.unsafeOriginalName || entry.name);
          const mode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
          if ((mode & 0o170000) === 0o120000) throw new Error('Resource symlinks are not supported');
          const file = safeResourcePath(staging, entry.name);
          const content = await entry.async('nodebuffer');
          expanded += content.length;
          if (expanded > 200 * 1024 * 1024) throw new Error('Expanded resource exceeds size limit');
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, content, { mode: mode & 0o100 ? 0o700 : 0o600 });
        }
        const metaFile = path.join(staging, '_moss_meta.json');
        const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as Record<string, unknown>;
        const ruleFile = typeof meta.ruleFile === 'string' ? meta.ruleFile : files.find((entry) => entry.name.endsWith('.md') && !/^(?:README|SKILLS?)\.md$/i.test(entry.name))?.name;
        if (resource.kind === 'skills') await fs.access(path.join(staging, 'SKILL.md'));
        else {
          if (!ruleFile) throw new Error('Assistant rules are missing');
          await fs.access(safeResourcePath(staging, ruleFile));
        }
        const prior = existing.find((item) => item.kind === resource.kind && item.source === resource.source && item.id === resource.id);
        const names = meta.nameI18n as Record<string, string> | undefined;
        const displayName = String(meta.display_name || names?.['zh-CN'] || resource.name);
        await fs.writeFile(
          metaFile,
          JSON.stringify({
            ...meta,
            id: resource.id,
            name: runtimeName,
            display_name: displayName,
            nameI18n: names || { 'zh-CN': displayName, 'en-US': displayName },
            source_type: resource.source,
            catalogManaged: true,
            mossDigest: resource.digest,
            installed_version: resource.version,
            enabled: prior?.isEnabled ?? true,
            presetAgentType: 'scode',
            ...(ruleFile ? { ruleFile } : {}),
          })
        );
        await fs.writeFile(path.join(staging, '.moss-ready'), resource.digest);
        assertMossCatalogIdentity(identity);
        try {
          await fs.rename(staging, target);
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
          if (!(await isInstallationComplete({ ...resource, path: target, runtimeName, preparationId: preparation.preparationId, displayName, description: '', isEnabled: true }))) {
            const invalid = path.join(root, `_incomplete-${randomUUID()}`);
            await fs.rename(target, invalid);
            await fs.rename(staging, target);
            await fs.rm(invalid, { recursive: true, force: true });
          }
        }
        installed.push({ ...resource, path: target, runtimeName, preparationId: preparation.preparationId, preparationResources: preparation.resources, displayName, description: String(meta.description || ''), ...(await catalogAppearance(meta, target)), isEnabled: prior?.isEnabled ?? true });
      } finally {
        await fs.rm(staging, { recursive: true, force: true });
      }
    }
    const selected = installed.find((item) => item.kind === input.kind && item.source === input.source && item.id === input.id);
    if (!selected) throw new Error('Prepared resource does not match the request');
    const registry = await readRegistry();
    const replaced = existing.filter((item) => installed.some((next) => next.kind === item.kind && (next.source === item.source || !item.preparationId) && next.id === item.id));
    registry.removedKeys = [...new Set([...(registry.removedKeys || []), ...replaced.map(installationKey)])].filter((key) => !installed.some((item) => installationKey(item) === key));
    registry.entries = [...existing.filter((item) => !replaced.includes(item)), ...installed];
    registry.hiddenPaths = [...new Set([...registry.hiddenPaths, ...replaced.filter((item) => !installed.some((next) => next.path === item.path)).map((item) => item.path)])].filter((file) => !installed.some((item) => item.path === file));
    assertMossCatalogIdentity(identity);
    await writeRegistry(registry, identity);
    return selected;
  });
}

export async function validateCatalogInstallation(item: IMossCatalogInstallation): Promise<void> {
  if (!item.isEnabled) throw new Error('Resource is disabled on this device');
  const root = catalogResourceRoot(item.kind, item.source);
  safeResourcePath(root, path.relative(root, item.path));
  if (!(await isInstallationComplete(item))) throw new Error('Local resource snapshot is incomplete');
  await requestMossCatalog(`/api/v1/client/catalog/preparations/${item.preparationId}`);
}

/** My resources display the exact downloaded instructions, including while offline. */
export async function detailLocalMossCatalog(input: { kind: MossCatalogKind; source: MossCatalogSource; id: string }): Promise<IMossCatalogItem> {
  const identity = mossCatalogIdentity();
  const item = (await getMossCatalogInstallations()).find((entry) => installationKey(entry) === installationKey(input));
  if (!item) throw new Error('Local resource is unavailable');
  const meta = JSON.parse(await fs.readFile(path.join(item.path, '_moss_meta.json'), 'utf8')) as Record<string, unknown>;
  const content = await fs.readFile(safeResourcePath(item.path, item.kind === 'skills' ? 'SKILL.md' : String(meta.ruleFile || 'system.md')), 'utf8');
  assertMossCatalogIdentity(identity);
  return { ...item, ...catalogDescriptions(meta), categories: Array.isArray(meta.categories) ? meta.categories.filter((value): value is string => typeof value === 'string') : [], content, isAvailable: item.isEnabled };
}

export async function changeCatalogInstallation(input: { kind: MossCatalogKind; source: MossCatalogSource; id: string; isEnabled?: boolean }): Promise<void> {
  await serialized(async () => {
    const identity = mossCatalogIdentity();
    const entries = await getMossCatalogInstallations();
    const item = entries.find((item) => item.kind === input.kind && item.source === input.source && item.id === input.id);
    if (!item) throw new Error('Local resource is unavailable');
    const registry = await readRegistry();
    if (input.isEnabled === undefined) {
      if (input.kind === 'skills' && entries.some((parent) => parent.kind === 'agents' && parent.dependencies.some((dependency) => dependency === item.id || dependency === item.name || dependency === item.runtimeName))) throw new Error('This skill is required by an installed assistant');
      registry.removedKeys = [...new Set([...(registry.removedKeys || []), installationKey(item)])];
      registry.entries = entries.filter((entry) => entry !== item);
      registry.hiddenPaths = [...new Set([...registry.hiddenPaths, item.path])];
    } else {
      const metaFile = path.join(item.path, '_moss_meta.json');
      const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as Record<string, unknown>;
      assertMossCatalogIdentity(identity);
      await fs.writeFile(metaFile, JSON.stringify({ ...meta, enabled: input.isEnabled }));
      registry.entries = entries.map((entry) => (entry === item ? { ...item, isEnabled: input.isEnabled! } : entry));
    }
    assertMossCatalogIdentity(identity);
    await writeRegistry(registry, identity);
  });
}

export function catalogRuntimeName(resource: IMossCatalogResource): string {
  return `${resource.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'resource'}-${digest(resource.id).slice(0, 8)}--${resource.digest.slice(0, 16)}`;
}

async function isInstallationComplete(item: IMossCatalogInstallation): Promise<boolean> {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(item.path, '_moss_meta.json'), 'utf8')) as { ruleFile?: string };
    if (item.preparationId && (await fs.readFile(path.join(item.path, '.moss-ready'), 'utf8')) !== item.digest) return false;
    await fs.access(safeResourcePath(item.path, item.kind === 'skills' ? 'SKILL.md' : meta.ruleFile || 'system.md'));
    return true;
  } catch {
    return false;
  }
}
