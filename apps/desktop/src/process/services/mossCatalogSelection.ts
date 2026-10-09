import fs from 'node:fs/promises';
import path from 'node:path';
import type { IMossCatalogInstallation, MossCatalogKind } from '@sudowork/common/mossCatalog';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';
import { listMossCatalog, detailMossCatalog } from './mossCatalogApi';
import { getMossCatalogInstallations, installMossCatalog, validateCatalogInstallation, catalogResourceRoot, catalogRuntimeName } from './mossCatalogInstall';
import { requireMossPersonalAgent } from './mossPersonalAgents';

/** Resolve selected local downloads to stable remote references without confusing them with directory names. */
export async function resolveMossCatalogSelection(assistantId?: string, skillIds: string[] = []) {
  const installed = await getMossCatalogInstallations();
  const selected: IMossCatalogInstallation[] = [];
  const unresolved: string[] = [];
  const resolve = async (kind: MossCatalogKind, reference: string) => {
    if (kind === 'agents' && isPersonalAgentRef(reference)) {
      await requireMossPersonalAgent(reference);
      return reference;
    }
    if (reference.startsWith('moss-prepared:')) return reference;
    const exact = installed.filter((item) => item.kind === kind && (item.id === reference || item.runtimeName === reference));
    let matches = exact.length ? exact : installed.filter((item) => item.kind === kind && item.name === reference);
    if (!matches.length && !['Moss Server', 'Remote Agent'].includes(reference)) {
      const tenant = await listMossCatalog({ kind, source: 'tenant' });
      const candidates = tenant.items.filter((item) => item.id === reference || item.name === reference);
      if (candidates.length > 1) throw new Error('Ambiguous resource name; select the resource by ID');
      if (candidates.length === 1) matches = [await installMossCatalog(candidates[0])];
      else if (/^[a-f0-9-]{36}$/i.test(reference)) {
        try {
          matches = [await installMossCatalog(await detailMossCatalog({ kind, source: 'hub', id: reference }))];
        } catch (error) {
          if (!(error instanceof Error && /HTTP 404/.test(error.message))) throw error;
        }
      }
    }
    if (!matches.length) {
      unresolved.push(reference);
      return reference;
    }
    if (matches.length !== 1) throw new Error('Ambiguous resource name; select the resource by ID');
    const item = await installMossCatalog(matches[0]);
    await validateCatalogInstallation(item);
    selected.push(item);
    return item.runtimeRef;
  };
  const assistantReference = assistantId ? await resolve('agents', assistantId) : undefined;
  const skillReferences: string[] = [];
  for (const skillId of skillIds) skillReferences.push(await resolve('skills', skillId));
  return { assistantReference, skillReferences, selected, unresolved };
}

/** Build a local execution context from the exact committed catalog downloads. */
export async function prepareLocalCatalogSelection(assistantId?: string, skillIds: string[] = []) {
  const selection = await resolveMossCatalogSelection(assistantId, skillIds);
  if (!selection.selected.length) return undefined;
  const installed = await getMossCatalogInstallations();
  const selected = new Map<string, IMossCatalogInstallation>();
  const add = (item: IMossCatalogInstallation) => {
    const key = `${item.kind}:${item.id}`;
    const prior = selected.get(key);
    if (prior && prior.digest !== item.digest) throw new Error('Selected resources require different versions of the same skill');
    selected.set(key, item);
  };
  for (const item of selection.selected) {
    add(item);
    for (const resource of item.preparationResources || []) {
      if (resource.kind !== 'skills') continue;
      const current = installed.find((candidate) => candidate.kind === resource.kind && candidate.source === resource.source && candidate.id === resource.id);
      if (!current?.isEnabled) throw new Error('Required skill is not downloaded or is disabled');
      const runtimeName = catalogRuntimeName(resource);
      add({ ...current, ...resource, runtimeName, path: path.join(catalogResourceRoot(resource.kind, resource.source), runtimeName), preparationId: item.preparationId });
    }
  }
  let presetContext = '';
  const enabledSkills: string[] = [];
  for (const item of selected.values()) {
    await validateCatalogInstallation(item);
    if (!item.isLocalAllowed) throw new Error('This resource requires cloud execution');
    if (item.kind === 'skills') {
      enabledSkills.push(item.runtimeName);
      presetContext += `\nSkill ${item.name}: ${path.join(item.path, 'SKILL.md')}`;
    } else {
      const meta = JSON.parse(await fs.readFile(path.join(item.path, '_moss_meta.json'), 'utf8')) as { ruleFile: string };
      const { safeResourcePath } = await import('./mossResourcePath');
      presetContext = `${await fs.readFile(safeResourcePath(item.path, meta.ruleFile), 'utf8')}\n\nAssistant resources: ${item.path}${presetContext}`;
    }
  }
  return { unresolved: selection.unresolved, presetContext, enabledSkills, resources: [...selected.values()].map((item) => ({ id: item.id, kind: item.kind, source: item.source, digest: item.digest, path: item.path })) };
}
