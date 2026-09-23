import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { z } from 'zod';
import { ProcessConfig, getHubSkillsDir, getHubAssistantsDir, clearSkillsCache } from '@process/initStorage';
import { getValidToken } from '@process/bridge/eeclawBridge';
import { AcpSkillManager } from '@process/task/AcpSkillManager';

const resourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().optional(),
    enabled: z.boolean().optional(),
    enabledSkills: z.array(z.string()).optional(),
  })
  .passthrough();
type Resource = z.infer<typeof resourceSchema>;

export interface IMossPreparedResources {
  presetContext: string;
  enabledSkills: string[];
  resources: Array<{ id: string; kind: 'agents' | 'skills'; digest: string; path: string }>;
}

/** Resolve ZIP paths before writing anything, including Windows archive paths. */
export function safeResourcePath(root: string, relative: string): string {
  const normalized = relative.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error('Unsafe resource archive path');
  const result = path.resolve(root, normalized);
  if (result !== path.resolve(root) && !result.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Unsafe resource archive path');
  return result;
}

/** Prepare only selected resources and their dependencies, using immutable content versions. */
export async function prepareMossResources(assistantId?: string, skillIds: string[] = []): Promise<IMossPreparedResources> {
  const result: IMossPreparedResources = { presetContext: '', enabledSkills: [], resources: [] };
  if (!assistantId && !skillIds.length) return result;
  const server = ProcessConfig.getSync('eeclaw.serverUrl');
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  const token = await getValidToken();
  if (!server || !scope) throw new Error('Moss identity is unavailable');
  const headers = { Authorization: `Bearer ${token}` };
  const assertIdentity = () => {
    if (ProcessConfig.getSync('eeclaw.accountScope') !== scope || ProcessConfig.getSync('eeclaw.authStorage')?.access_token !== token) throw new Error('Moss identity changed during resource preparation');
  };
  const fetchResource = async (route: string) => {
    const response = await fetch(`${server.replace(/\/+$/, '')}${route}`, { headers, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Resource request failed: HTTP ${response.status}`);
    assertIdentity();
    return response;
  };
  const catalog = async (kind: 'agents' | 'skills') => z.array(resourceSchema).parse(await (await fetchResource(`/api/v1/${kind}/installed`)).json());
  const resolve = (items: Resource[], reference: string) => {
    const originalName = reference.replace(/--[a-f0-9]{16}$/, '');
    const matches = items.filter((item) => item.id === reference || item.name === reference || item.name === originalName);
    if (matches.length !== 1 || matches[0].enabled === false) throw new Error(`Resource unavailable: ${reference}`);
    return matches[0];
  };
  const install = async (kind: 'agents' | 'skills', resource: Resource) => {
    const response = await fetchResource(`/api/v1/${kind}/installed/${encodeURIComponent(resource.id)}/download`);
    if (Number(response.headers.get('content-length') || 0) > 50 * 1024 * 1024) throw new Error('Resource archive exceeds size limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Resource archive exceeds size limit');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const expected = response.headers.get('x-content-sha256');
    if (!expected || expected !== digest) throw new Error('Resource checksum mismatch');
    const runtimeName = `${resource.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'resource'}--${digest.slice(0, 16)}`;
    const root = kind === 'skills' ? getHubSkillsDir() : getHubAssistantsDir();
    const target = path.join(root, runtimeName);
    try {
      await fs.access(path.join(target, '.moss-ready'));
    } catch {
      await fs.mkdir(root, { recursive: true });
      const staging = path.join(root, `.preparing-${randomUUID()}`);
      await fs.mkdir(staging);
      try {
        const archive = await JSZip.loadAsync(bytes);
        const entries = Object.values(archive.files).filter((entry) => !entry.dir);
        if (entries.length > 5000) throw new Error('Resource has too many files');
        const roots = new Set(entries.map((entry) => entry.name.split('/')[0]));
        const prefix = roots.size === 1 && entries.every((entry) => entry.name.includes('/')) ? `${entries[0].name.split('/')[0]}/` : '';
        let extractedBytes = 0;
        for (const entry of entries) {
          safeResourcePath(staging, entry.unsafeOriginalName || entry.name);
          const permissions = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
          if ((permissions & 0o170000) === 0o120000) throw new Error('Resource symlinks are not supported');
          const file = safeResourcePath(staging, entry.name.slice(prefix.length));
          const content = await entry.async('nodebuffer');
          extractedBytes += content.length;
          if (extractedBytes > 200 * 1024 * 1024) throw new Error('Expanded resource exceeds size limit');
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, content, { mode: permissions & 0o100 ? 0o700 : 0o600 });
        }
        const metaFile = path.join(staging, '_moss_meta.json');
        const meta = await fs
          .readFile(metaFile, 'utf8')
          .then((text) => JSON.parse(text) as Record<string, unknown>)
          .catch(() => ({}) as Record<string, unknown>);
        if (meta.agent_type === 'workflow' || meta.agentType === 'workflow' || (Array.isArray(meta.enabledMcpServers) && meta.enabledMcpServers.length) || (Array.isArray(meta.enabledWikis) && meta.enabledWikis.length) || (Array.isArray(meta.enabledCorpApps) && meta.enabledCorpApps.length))
          throw new Error('This assistant requires cloud services');
        if (kind === 'skills') await fs.access(path.join(staging, 'SKILL.md'));
        await fs.writeFile(metaFile, JSON.stringify({ ...meta, id: resource.id, name: runtimeName, source_type: 'hub', installed_version: resource.version, enabled: resource.enabled !== false, presetAgentType: 'scode', mossDigest: digest }));
        await fs.writeFile(path.join(staging, '.moss-ready'), digest);
        assertIdentity();
        await fs.rename(staging, target).catch(async (error) => {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
          await fs.access(path.join(target, '.moss-ready'));
        });
      } finally {
        await fs.rm(staging, { recursive: true, force: true });
      }
    }
    result.resources.push({ id: resource.id, kind, digest, path: target });
    return { target, runtimeName };
  };

  const requestedSkills = new Set(skillIds);
  if (assistantId) {
    const assistant = resolve(await catalog('agents'), assistantId);
    const installed = await install('agents', assistant);
    const meta = JSON.parse(await fs.readFile(path.join(installed.target, '_moss_meta.json'), 'utf8')) as Record<string, unknown>;
    const files = await fs.readdir(installed.target);
    const ruleFile = typeof meta.ruleFile === 'string' ? meta.ruleFile : files.find((file) => file === `${assistant.name}.md`) || files.find((file) => file.endsWith('.md'));
    if (!ruleFile) throw new Error('Assistant rules are missing');
    result.presetContext = `${await fs.readFile(safeResourcePath(installed.target, ruleFile), 'utf8')}\n\nAssistant resources: ${installed.target}`;
    for (const id of assistant.enabledSkills || []) requestedSkills.add(id);
    for (const id of Array.isArray(meta.skills) ? meta.skills : []) if (typeof id === 'string') requestedSkills.add(id);
    for (const id of Array.isArray(meta.enabledSkills) ? meta.enabledSkills : []) if (typeof id === 'string') requestedSkills.add(id);
  }
  if (requestedSkills.size) {
    const skills = await catalog('skills');
    for (const id of requestedSkills) {
      const skill = resolve(skills, id);
      const installed = await install('skills', skill);
      result.enabledSkills.push(installed.runtimeName);
      result.presetContext += `\nSkill ${skill.name}: ${path.join(installed.target, 'SKILL.md')}`;
    }
  }
  assertIdentity();
  clearSkillsCache();
  AcpSkillManager.resetInstance();
  return result;
}

/** Verify the immutable snapshot and current visibility before resuming local work. */
export async function validateMossResourceSnapshot(resources: IMossPreparedResources['resources']): Promise<void> {
  if (!resources.length) return;
  const server = ProcessConfig.getSync('eeclaw.serverUrl');
  const scope = ProcessConfig.getSync('eeclaw.accountScope');
  const token = await getValidToken();
  for (const kind of new Set(resources.map((resource) => resource.kind))) {
    const response = await fetch(`${server.replace(/\/+$/, '')}/api/v1/${kind}/installed`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Resource authorization is unavailable');
    const available = z.array(resourceSchema).parse(await response.json());
    for (const resource of resources.filter((item) => item.kind === kind)) {
      if (!available.some((item) => item.id === resource.id && item.enabled !== false)) throw new Error('Resource access has been revoked');
      const root = kind === 'skills' ? getHubSkillsDir() : getHubAssistantsDir();
      safeResourcePath(root, path.relative(root, resource.path));
      if ((await fs.readFile(path.join(resource.path, '.moss-ready'), 'utf8')) !== resource.digest) throw new Error('Local resource snapshot is incomplete');
    }
  }
  if (ProcessConfig.getSync('eeclaw.accountScope') !== scope) throw new Error('Moss identity changed during resource validation');
}
