import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Only account configuration and Electron directory locations are substituted.
// A local HTTP fixture serves the archive; the client, ZIP validation, installer,
// registry, directory collisions, and recovery use real network/filesystem I/O.
const state = vi.hoisted(() => ({ root: '', server: '', token: '' }));
vi.mock('@process/initStorage', () => ({
  ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.serverUrl': state.server, 'eeclaw.accountScope': 'test-account' })[key] },
  getHubSkillsDir: () => path.join(state.root, 'skills', 'hub'),
  getHubAssistantsDir: () => path.join(state.root, 'agents', 'hub'),
  clearSkillsCache: vi.fn(),
}));
vi.mock('@process/constants/enterpriseStorage', () => ({
  getEnterpriseTenantSkillsDir: () => path.join(state.root, 'skills', 'tenant'),
  getEnterpriseTenantAssistantsDir: () => path.join(state.root, 'agents', 'tenant'),
}));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: async () => state.token }));
import { changeCatalogInstallation, detailLocalMossCatalog, getMossCatalogInstallations, installMossCatalog, isCatalogPathVisible } from '@process/services/mossCatalogInstall';

let server: Server | undefined;
let content: string;
let archiveDigest: string;
let downloadCount: number;
const skill = { kind: 'skills' as const, source: 'tenant' as const, id: 'filesystem-skill' };

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-filesystem-'));
  state.token = randomUUID();
  content = `Skill instructions ${randomUUID()}`;
  downloadCount = 0;
  const bytes = await new JSZip()
    .file('SKILL.md', content)
    .file('_moss_meta.json', JSON.stringify({ id: skill.id, name: 'filesystem-skill' }))
    .generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
  archiveDigest = createHash('sha256').update(bytes).digest('hex');
  const preparationId = archiveDigest;
  const downloadRef = `/api/v1/client/catalog/preparations/${preparationId}/skills/${skill.id}/download`;
  server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${state.token}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v1/client/catalog/install') {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        if (body !== JSON.stringify(skill)) {
          response.writeHead(400).end();
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ protocolVersion: 1, preparationId, resources: [{ ...skill, name: 'filesystem-skill', version: '1', digest: archiveDigest, downloadRef, runtimeRef: `moss-prepared:${preparationId}:skills:${skill.id}`, dependencies: [], isLocalAllowed: true }] }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === downloadRef) {
      downloadCount++;
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length, 'X-Content-SHA256': archiveDigest }).end(bytes);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  state.server = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await fs.rm(state.root, { recursive: true, force: true });
  }
});

it('downloads a skill, reuses its directory, repairs missing files, and reinstalls retained history', async () => {
  const installed = await installMossCatalog(skill);
  const skillFile = path.join(installed.path, 'SKILL.md');
  expect(downloadCount).toBe(1);
  expect(await fs.readFile(skillFile, 'utf8')).toBe(content);
  expect(await fs.readFile(path.join(installed.path, '.moss-ready'), 'utf8')).toBe(archiveDigest);

  // Explicitly update to identical bytes to exercise a complete directory
  // collision without relying on an archive generator's timestamp granularity.
  const reused = await installMossCatalog({ ...skill, isUpdate: true });
  expect(downloadCount).toBe(2);
  expect(reused.path).toBe(installed.path);
  expect(await fs.readFile(skillFile, 'utf8')).toBe(content);

  await fs.unlink(skillFile);
  expect(await getMossCatalogInstallations()).toEqual([]);
  const repaired = await installMossCatalog(skill);
  expect(downloadCount).toBe(3);
  expect(repaired.path).toBe(installed.path);
  expect(await fs.readFile(skillFile, 'utf8')).toBe(content);
  expect(await getMossCatalogInstallations()).toEqual([repaired]);

  await changeCatalogInstallation(skill);
  expect(await getMossCatalogInstallations()).toEqual([]);
  expect(await isCatalogPathVisible(installed.path)).toBe(false);
  expect(await fs.readFile(skillFile, 'utf8')).toBe(content);
  const restored = await installMossCatalog(skill);
  expect(downloadCount).toBe(4);
  expect(restored.path).toBe(installed.path);
  expect(await isCatalogPathVisible(restored.path)).toBe(true);
  expect(await getMossCatalogInstallations()).toEqual([restored]);
  expect((await detailLocalMossCatalog(skill)).content).toBe(content);
  expect(await fs.readdir(path.dirname(installed.path))).toEqual([path.basename(installed.path)]);
});
