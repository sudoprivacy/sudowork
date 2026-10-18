import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ installed: [], request: vi.fn(), list: vi.fn(), detail: vi.fn(), install: vi.fn(), validate: vi.fn(), personal: vi.fn() }));
vi.mock('../../src/process/services/mossCatalogApi', () => ({ requestMossCatalog: state.request, listMossCatalog: state.list, detailMossCatalog: state.detail }));
vi.mock('../../src/process/services/mossCatalogInstall', () => ({ getMossCatalogInstallations: async () => state.installed, installMossCatalog: state.install, validateCatalogInstallation: state.validate, catalogResourceRoot: vi.fn(), catalogRuntimeName: vi.fn() }));
vi.mock('../../src/process/services/mossPersonalAgents', () => ({ requireMossPersonalAgent: state.personal }));
import { resolveMossCatalogSelection } from '../../src/process/services/mossCatalogSelection';

const templateId = '2965314e-3f20-4847-ae17-71de9cb84687';
beforeEach(() => {
  vi.resetAllMocks();
  state.installed = [];
  state.request.mockResolvedValue(Response.json([{ id: templateId, name: 'Private task template', enabled: true }]));
  state.list.mockRejectedValue(new Error('Moss resource request failed: HTTP 500'));
});

describe('installed template references in managed conversations', () => {
  it('preserves an installed private template without fetching unrelated catalogs', async () => {
    expect(await resolveMossCatalogSelection(templateId)).toEqual({ assistantReference: templateId, skillReferences: [], selected: [], unresolved: [templateId] });
    expect(state.request).toHaveBeenCalledWith('/api/v1/agent-templates/installed');
    expect(state.list).not.toHaveBeenCalled();
    expect(state.detail).not.toHaveBeenCalled();
    expect(state.install).not.toHaveBeenCalled();
  });

  it('rejects disabled templates before looking in another catalog', async () => {
    state.request.mockResolvedValue(Response.json([{ id: templateId, name: 'Disabled', enabled: false }]));
    await expect(resolveMossCatalogSelection(templateId)).rejects.toThrow('disabled');
    expect(state.list).not.toHaveBeenCalled();
  });

  it('retains catalog preparation for a template not in the installed list', async () => {
    state.request.mockResolvedValue(Response.json([]));
    state.list.mockResolvedValue({ items: [] });
    const item = { id: templateId, name: 'Public catalog template', kind: 'agents', source: 'hub' };
    state.detail.mockResolvedValue(item);
    const prepared = { ...item, runtimeRef: 'moss-prepared:pinned:agents:template' };
    state.install.mockResolvedValue(prepared);

    expect(await resolveMossCatalogSelection(templateId)).toEqual({ assistantReference: prepared.runtimeRef, skillReferences: [], selected: [prepared], unresolved: [] });
    expect(state.detail).toHaveBeenCalledWith({ kind: 'agents', source: 'hub', id: templateId });
    expect(state.validate).toHaveBeenCalledWith(prepared);
  });

  it('does not hide an invalid installed-template response with a catalog lookup', async () => {
    state.request.mockResolvedValue(Response.json({ error: 'not a template list' }));
    await expect(resolveMossCatalogSelection(templateId)).rejects.toThrow();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('keeps personal Agent authorization independent of task templates', async () => {
    const reference = 'moss-agent:own:22222222-2222-4222-8222-222222222222';
    expect((await resolveMossCatalogSelection(reference)).assistantReference).toBe(reference);
    expect(state.personal).toHaveBeenCalledWith(reference);
    expect(state.request).not.toHaveBeenCalled();
    state.personal.mockRejectedValue(new Error('Personal Agent unavailable'));
    await expect(resolveMossCatalogSelection(reference)).rejects.toThrow('Personal Agent unavailable');
  });

  it('preserves an existing prepared reference without a second installation', async () => {
    const reference = 'moss-prepared:pinned:agents:template';
    expect((await resolveMossCatalogSelection(reference)).assistantReference).toBe(reference);
    expect(state.request).not.toHaveBeenCalled();
    expect(state.install).not.toHaveBeenCalled();
  });
});
