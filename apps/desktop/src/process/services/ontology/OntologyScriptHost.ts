import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { IOntologyExecuteRuntimeInput, IOntologyRuntimeExecution, IOntologyWorkbenchSnapshot, IOntologyScriptResponse } from '@sudowork/ontology-common';
import { bindPackageSecrets, buildOntologyArtifact, canonicalJson, loadOntologyArtifact, OntologyPackageError, verifyPackage } from '@sudowork/ontology-runtime/artifact';
import type { IOntologyArtifact, IOntologyRuntimeBindings } from '@sudowork/ontology-runtime/artifact';
import { mergeOntologyBindings, ontologyConnectionBinding } from '@sudowork/ontology-runtime/bindings';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { pythonRuntimeService } from '@process/services/python/PythonRuntimeService';

export function getOntologyCliPath(): string {
  const target = app.isPackaged ? path.join(process.resourcesPath, 'ontology-cli', 'ontology.cjs') : path.join(app.getAppPath?.() || process.cwd(), 'resources', 'ontology-cli', 'ontology.cjs');
  if (existsSync(target)) return target;
  const development = [path.resolve('resources/ontology-cli/ontology.cjs'), path.resolve('apps/desktop/resources/ontology-cli/ontology.cjs')].find((candidate) => existsSync(candidate));
  if (!app.isPackaged && development) return development;
  throw new Error('Ontology CLI is unavailable. Build ontology-cli before starting Sudowork.');
}

function getOntologyNodePath(): string {
  const bundled = getNodeBinaryPath();
  if (existsSync(bundled)) return bundled;
  if (!app.isPackaged && !process.versions.electron) return process.execPath;
  if (!app.isPackaged) {
    const executable = process.platform === 'win32' ? 'node.exe' : 'node';
    const candidate = (process.env.PATH || '')
      .split(path.delimiter)
      .map((directory) => path.join(directory, executable))
      .find((file) => existsSync(file));
    if (candidate) return candidate;
  }
  throw new Error('The bundled Node runtime is unavailable.');
}

export function quoteOntologyArgument(value: string): string {
  return process.platform === 'win32' ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\\''") + "'";
}

export function ontologyCommand(args: string[]): string {
  return (process.platform === 'win32' ? '& ' : '') + [getOntologyNodePath(), ...args].map(quoteOntologyArgument).join(' ');
}

export async function runOntologyScript(cliFile: string, args: string[], input: unknown, timeoutMs = 30_000, signal?: AbortSignal): Promise<IOntologyScriptResponse> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(getOntologyNodePath(), [cliFile, ...args], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    let output = '';
    let errors = '';
    let isSettled = false;
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const fail = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      stop();
      reject(error);
    };
    const onAbort = () => fail(new OntologyPackageError('EXECUTION_CANCELLED', 'Ontology command cancelled.'));
    const timer = setTimeout(() => fail(new OntologyPackageError(args[0] === 'invoke' && args[1]?.startsWith('action.') ? 'EFFECT_OUTCOME_UNKNOWN' : 'EXECUTION_TIMEOUT', 'Ontology command timed out. Do not automatically retry business writes.')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 16 * 1024 * 1024) fail(new Error('Ontology command output exceeds the limit.'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length < 32_768) errors += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        const result = JSON.parse(output) as IOntologyScriptResponse;
        if (result.protocolVersion !== 1 || typeof result.isSuccess !== 'boolean') throw new Error('Invalid ontology CLI response.');
        if (!result.isSuccess) throw new OntologyPackageError(result.error?.code || 'EXECUTION_FAILED', result.error?.message || 'Ontology execution failed.');
        if (code !== 0) throw new Error('Ontology CLI exited: ' + code);
        resolve(result);
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error('Ontology CLI did not return a result: ' + errors.slice(-2000)) : error);
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export class OntologyScriptHost {
  private producerIdentity?: Promise<string>;
  constructor(readonly directory = path.join(os.tmpdir(), 'sudowork-ontology-runtime')) {}

  async assertWritableBindings(bindings: IOntologyRuntimeBindings): Promise<void> {
    const root = await fs.realpath(this.directory).catch(() => path.resolve(this.directory));
    for (const connection of Object.values(bindings.connections || {})) {
      if (!connection.writable || !connection.path) continue;
      const target = await fs.realpath(connection.path);
      if (target === root || target.startsWith(root + path.sep)) throw new OntologyPackageError('WRITE_NOT_AUTHORIZED', 'Copy package data outside the managed runtime before enabling database writes.');
    }
  }

  private producerId(): Promise<string> {
    this.producerIdentity ??= (async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = path.join(this.directory, 'producer-id');
      if (!existsSync(target)) {
        const temporary = target + '.tmp-' + randomUUID();
        await fs.writeFile(temporary, randomUUID(), { mode: 0o600 });
        try {
          await fs.link(temporary, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      const identity = (await fs.readFile(target, 'utf8')).trim();
      if (!/^[a-f0-9-]{36}$/.test(identity)) throw new Error('Invalid ontology producer identity.');
      return identity;
    })();
    return this.producerIdentity;
  }

  async build(snapshot: IOntologyWorkbenchSnapshot, versionId?: string, prompt?: string): Promise<IOntologyArtifact> {
    const ontologyId =
      'urn:sudowork:ontology:' +
      createHash('sha256')
        .update(await this.producerId())
        .update('/' + snapshot.workspaceId)
        .digest('hex');
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(this.directory, 'artifacts'), cliFile: getOntologyCliPath(), versionId, prompt, ontologyId });
    artifact.bindings = mergeOntologyBindings(artifact.bindings, snapshot.runtimeBindings || {});
    await this.assertWritableBindings(artifact.bindings);
    for (const resource of artifact.manifest.resources.filter((item) => item.provider === 'notification')) {
      const actionId = resource.id.slice(7);
      if (!artifact.bindings.actions?.[actionId]?.url) {
        const { ontologyDesktopNotificationBinding } = await import('./OntologyWriteBridge');
        artifact.bindings.actions![actionId] = await ontologyDesktopNotificationBinding(snapshot.workspaceId);
      }
    }
    await this.bindPythonRuntime(artifact);
    return artifact;
  }

  private async bindPythonRuntime(artifact: IOntologyArtifact): Promise<void> {
    if (artifact.bindings.python) return;
    const requirements = JSON.parse(await fs.readFile(path.join(artifact.directory, 'environment/runtime.lock.json'), 'utf8')) as { python: string | null };
    if (!requirements.python) return;
    const python = await Promise.resolve(pythonRuntimeService.checkInstalled()).catch((): undefined => undefined);
    if (python?.installed && python.path) artifact.bindings.python = python.path;
  }

  async writeBindings(bindings: IOntologyRuntimeBindings, name: string = randomUUID()): Promise<string> {
    const directory = path.join(this.directory, 'bindings');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, name + '.json');
    const temporary = target + '.tmp-' + randomUUID();
    await fs.writeFile(temporary, canonicalJson(bindings), { mode: 0o600 });
    await fs.rename(temporary, target);
    return target;
  }

  async run(snapshot: IOntologyWorkbenchSnapshot, kind: IOntologyRuntimeExecution['kind'], input: IOntologyExecuteRuntimeInput): Promise<IOntologyRuntimeExecution> {
    const artifact = input.versionId ? await this.published(snapshot, input.versionId) : await this.build(snapshot);
    const capability = artifact.capabilities.find((item) => item.kind === kind && (input.id ? item.artifactId === input.id : item.id === kind + '.' + input.code));
    if (!capability) throw new Error('Ontology capability not found.');
    artifact.bindings.allowedActions = kind === 'action' ? [capability.artifactId] : [];
    const bindingsPath = await this.writeBindings(artifact.bindings);
    const startedAt = Date.now();
    try {
      const response = await runOntologyScript(path.join(artifact.directory, artifact.manifest.entrypoints.cli), ['invoke', capability.id, '--package', artifact.directory, '--bindings', bindingsPath], { protocolVersion: 1, requestId: randomUUID(), arguments: input.arguments || {} });
      return { kind, artifactId: capability.artifactId, code: capability.id.slice(kind.length + 1), output: response.data ?? null, durationMs: Date.now() - startedAt, executedAt: Date.now(), executedFunctionIds: response.meta?.executedFunctionIds };
    } finally {
      await fs.rm(bindingsPath, { force: true });
    }
  }

  async published(snapshot: IOntologyWorkbenchSnapshot, versionId: string, isPublishedRequired = true): Promise<IOntologyArtifact> {
    const version = snapshot.publishedVersions.find((item) => item.id === versionId && (isPublishedRequired ? item.status === 'published' : ['submitted', 'approved', 'published'].includes(item.status)));
    if (!version?.runtimeDigest) throw new Error('Publish this ontology version with the script runtime before using or exporting it.');
    const directory = version.runtimeLocation ? path.resolve(this.directory, version.runtimeLocation) : path.join(this.directory, 'artifacts', version.runtimeDigest.replace(/^sha256:/, ''));
    if (!directory.startsWith(path.resolve(this.directory) + path.sep)) throw new Error('Invalid ontology artifact location.');
    const manifest = await verifyPackage(directory);
    if (manifest.runtimeDigest !== version.runtimeDigest) throw new Error('Published ontology artifact mismatch.');
    const loaded = await loadOntologyArtifact(directory);
    let bindings: IOntologyRuntimeBindings = { connections: {}, files: {}, actions: {}, allowedActions: [] };
    for (const item of version.snapshot.logicFunctions) bindPackageSecrets(item.configuration, 'logic:' + item.id, bindings, []);
    for (const item of version.snapshot.actions) bindPackageSecrets(item.configuration, 'action:' + item.id, bindings, []);
    for (const resource of manifest.resources) {
      if (resource.provider === 'secret') continue;
      if (resource.provider === 'file') {
        const asset = snapshot.assets.find((item) => item.id === resource.assetIds[0]);
        if (asset?.path) bindings.files![asset.id] = asset.path;
      } else if (resource.id.startsWith('action:')) {
        const action = version.snapshot.actions.find((item) => item.id === resource.id.slice(7));
        if (action) bindings.actions![action.id] = Object.fromEntries(Object.entries(action.configuration).filter(([key]) => ['url', 'headers', 'command', 'args'].includes(key)));
      } else {
        const connection = snapshot.connectors.find((item) => item.id === resource.id);
        if (connection) bindings.connections![resource.id] = ontologyConnectionBinding(connection);
      }
    }
    bindings.allowedActions = loaded.capabilities.filter((item) => !item.isReadOnly).map((item) => item.artifactId);
    bindings = mergeOntologyBindings(bindings, snapshot.runtimeBindings || {});
    await this.assertWritableBindings(bindings);
    for (const resource of manifest.resources.filter((item) => item.provider === 'notification')) {
      const actionId = resource.id.slice(7);
      if (!bindings.actions![actionId]?.url) {
        const { ontologyDesktopNotificationBinding } = await import('./OntologyWriteBridge');
        bindings.actions![actionId] = await ontologyDesktopNotificationBinding(snapshot.workspaceId);
      }
    }
    const artifact = { directory, manifest, capabilities: loaded.capabilities, bindings };
    await this.bindPythonRuntime(artifact);
    return artifact;
  }
}
