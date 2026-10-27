import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Script } from 'node:vm';
import { createDefaultOntologyWorkbenchSnapshot, createSemanticDocument, reconcileSemanticModel } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchSnapshot, IOntologyVersionSnapshot, IOntologyPackageCapability, IOntologyPackageManifest, IOntologyPackageResource, IOntologyConnectorConfig, IOntologyRuntimeBindings, IOntologyAgentDefinition, OntologyJsonValue } from '@sudowork/ontology-common';
import { exportStandardOntology } from '@sudowork/ontology-engine';
import { ontologyConnectionBinding } from './bindings.js';
import { ontologyDependencySchema, validateOntologyPackageModel } from './validation.js';

export type { IOntologyRuntimeBindings } from '@sudowork/ontology-common';

export interface IOntologyArtifactOptions {
  ontologyId?: string;
  root: string;
  cliFile: string;
  versionId?: string;
  prompt?: string;
}

export interface IOntologyArtifact {
  directory: string;
  manifest: IOntologyPackageManifest;
  capabilities: IOntologyPackageCapability[];
  bindings: IOntologyRuntimeBindings;
}

interface IRuntimeModel extends IOntologyVersionSnapshot {
  ontologyId: string;
  workspaceId: string;
  title: string;
  versionId: string;
  assets: IOntologyWorkbenchSnapshot['assets'];
  connectors: IOntologyWorkbenchSnapshot['connectors'];
}

interface IFileChecksum {
  sha256: string;
  bytes: number;
}

const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_PACKAGE_FILES = 4096;
const SECRET_KEY = /password|secret|token|authorization|api[_-]?key|private[_-]?key|credential/i;
const AGENT_RUNTIME_INSTRUCTIONS = '\n\nRun node scripts/ontology.cjs list --package . to discover capabilities; use describe to inspect arguments. Invoke capabilities with JSON on stdin. Do not fabricate data. Business writes require explicit user authorization and a host-authorized binding.\n';

export class OntologyPackageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recovery?: unknown
  ) {
    super(message);
  }
}

export function canonicalJson(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_key, entry: unknown) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.fromEntries(
              Object.entries(entry)
                .filter(([, item]) => item !== undefined)
                .sort(([left], [right]) => left.localeCompare(right))
            )
          : entry,
      2
    ) + '\n'
  );
}

export function contentHash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function bindPackageSecrets(value: OntologyJsonValue, namespace: string, bindings: IOntologyRuntimeBindings, resources: IOntologyPackageResource[]): OntologyJsonValue {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.$secret === 'string' && Object.keys(value).length === 1) {
    if (!resources.some((item) => item.id === value.$secret)) resources.push({ id: value.$secret, name: value.$secret, provider: 'secret', assetIds: [], requiredFields: ['value'] });
    bindings.secrets ??= {};
    bindings.secrets[value.$secret] ??= '';
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => bindPackageSecrets(item, namespace + '/' + index, bindings, resources));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const identifier = namespace + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
        if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.$secret === 'string') return [key, bindPackageSecrets(item, identifier, bindings, resources)];
        if (SECRET_KEY.test(key) && item !== null && !(typeof item === 'string' && /^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/.test(item))) {
          bindings.secrets ??= {};
          bindings.secrets[identifier] = item;
          resources.push({ id: identifier, name: identifier, provider: 'secret', assetIds: [], requiredFields: ['value'] });
          return [key, { $secret: identifier }];
        }
        return [key, bindPackageSecrets(item, identifier, bindings, resources)];
      })
    );
  return value;
}

export function packageFilePath(root: string, name: string): string {
  if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name) || /^[a-z]:/i.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..')) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid package path: ' + name);
  return path.join(root, ...name.split('/'));
}

export async function readPackageFile(root: string, name: string): Promise<Buffer> {
  const target = packageFilePath(root, name);
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  if (!realTarget.startsWith(realRoot + path.sep) || (await fs.lstat(target)).isSymbolicLink()) throw new OntologyPackageError('PACKAGE_INVALID', 'Package links are not allowed: ' + name);
  return fs.readFile(realTarget);
}

export async function writePackageFile(root: string, name: string, content: string | Uint8Array): Promise<void> {
  const target = packageFilePath(root, name);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, content, { mode: 0o600 });
}

async function fileChecksum(filePath: string): Promise<IFileChecksum> {
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_PACKAGE_BYTES) throw new OntologyPackageError('PACKAGE_INVALID', 'Package file exceeds size limit.');
    digest.update(chunk as Buffer);
  }
  return { sha256: digest.digest('hex'), bytes };
}

/** Reuse one immutable CLI blob without copying and rescanning it for every model edit. */
async function materializeRuntimeCli(root: string, content: string | Uint8Array, target: string): Promise<void> {
  const digest = contentHash(content);
  const directory = path.join(root, '.cli');
  const blob = path.join(directory, digest + '.cjs');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.access(blob);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const temporary = blob + '.tmp-' + randomUUID();
    try {
      await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o444 });
      await fs.rename(temporary, blob).catch((renameError: NodeJS.ErrnoException) => {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(renameError.code || '')) throw renameError;
      });
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  if (!(await fs.lstat(blob)).isFile() || (await fileChecksum(blob)).sha256 !== digest) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Runtime CLI blob changed.');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    await fs.link(blob, target);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    await fs.copyFile(blob, target, constants.COPYFILE_FICLONE);
  }
}

export async function listPackageFiles(root: string, prefix = ''): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new OntologyPackageError('PACKAGE_INVALID', 'Unsupported package entry: ' + name);
    if (entry.isDirectory()) output.push(...(await listPackageFiles(root, name + '/')));
    else output.push(name);
    if (output.length > MAX_PACKAGE_FILES) throw new OntologyPackageError('PACKAGE_INVALID', 'Too many package files.');
  }
  return output.sort();
}

export async function sealPackage(root: string): Promise<string> {
  const entries: Record<string, IFileChecksum> = {};
  let total = 0;
  for (const name of (await listPackageFiles(root)).filter((item) => item !== 'checksums.json')) {
    entries[name] = await fileChecksum(packageFilePath(root, name));
    total += entries[name].bytes;
    if (total > MAX_PACKAGE_BYTES) throw new OntologyPackageError('PACKAGE_INVALID', 'Package exceeds size limit.');
  }
  const index = canonicalJson(entries);
  await writePackageFile(root, 'checksums.json', index);
  return 'sha256:' + contentHash(index);
}

export async function verifyPackage(root: string): Promise<IOntologyPackageManifest> {
  const index = JSON.parse((await readPackageFile(root, 'checksums.json')).toString('utf8')) as Record<string, IFileChecksum>;
  if (!index || typeof index !== 'object' || Array.isArray(index) || Object.keys(index).length > MAX_PACKAGE_FILES) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid checksum index.');
  const actual = (await listPackageFiles(root)).filter((name) => name !== 'checksums.json');
  if (canonicalJson(actual) !== canonicalJson(Object.keys(index).sort())) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Package file list changed.');
  const folded = new Set<string>();
  let total = 0;
  for (const name of actual) {
    if (folded.has(name.toLowerCase())) throw new OntologyPackageError('PACKAGE_INVALID', 'Case-colliding package paths.');
    folded.add(name.toLowerCase());
    const expected = index[name];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid file checksum.');
    total += expected.bytes;
    if (total > MAX_PACKAGE_BYTES) throw new OntologyPackageError('PACKAGE_INVALID', 'Package exceeds size limit.');
    const observed = await fileChecksum(packageFilePath(root, name));
    if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Package file changed: ' + name);
  }
  const manifest = JSON.parse((await readPackageFile(root, 'manifest.json')).toString('utf8')) as IOntologyPackageManifest;
  if (manifest.kind !== 'sudowork-ontology-package' || manifest.formatVersion !== 1 || manifest.protocolVersion !== 1 || manifest.modelAuthority !== 'rdf' || !manifest.versionId || !manifest.entrypoints?.authoring || !Array.isArray(manifest.resources))
    throw new OntologyPackageError('PACKAGE_VERSION_UNSUPPORTED', 'Unsupported Sudowork ontology package format.');
  for (const name of Object.values(manifest.entrypoints)) if (typeof name !== 'string' || !index[name]) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing package entrypoint.');
  const resourceContracts = JSON.parse((await readPackageFile(root, 'environment/resources.json')).toString('utf8'));
  if (canonicalJson(manifest.resources.map(({ embeddedPath: _embeddedPath, ...resource }) => resource)) !== canonicalJson(resourceContracts)) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Resource contracts changed.');
  const runtimeEntries = Object.fromEntries(
    Object.entries(index)
      .filter(([name]) => name !== 'manifest.json' && !name.startsWith('assets/') && !name.startsWith('verification/'))
      .map(([name, entry]) => [name, entry.sha256])
  );
  if ('sha256:' + contentHash(canonicalJson(runtimeEntries)) !== manifest.runtimeDigest) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Runtime content does not match its published digest.');
  return manifest;
}

function connectorRequirements(provider: string): string[] {
  if (provider === 'sqlite' || provider === 'local_files' || provider === 'directory') return ['path'];
  if (['mysql', 'postgresql', 'oracle', 'sqlserver'].includes(provider)) return ['host', 'database', 'username'];
  if (['rest', 'openapi'].includes(provider)) return ['url'];
  if (['s3', 'oss'].includes(provider)) return ['bucket'];
  return ['host'];
}

function requiredConnectionValue(connector: IOntologyConnectorConfig, key: string): unknown {
  const value = (connector as unknown as Record<string, unknown>)[key] || connector.params?.[key] || connector.credential?.[key];
  if (value) return value;
  if (key === 'url') return connector.params?.base_url;
  if (key === 'host' && ['kafka', 'mq'].includes(connector.sourceType)) return connector.params?.brokers;
  return undefined;
}

export async function buildOntologyArtifact(snapshot: IOntologyWorkbenchSnapshot, options: IOntologyArtifactOptions): Promise<IOntologyArtifact> {
  const version = options.versionId ? snapshot.publishedVersions.find((item) => item.id === options.versionId) : undefined;
  if (options.versionId && !version) throw new OntologyPackageError('PACKAGE_INVALID', 'Ontology version not found.');
  const source = version?.snapshot || snapshot;
  const environment = version?.snapshot.runtimeEnvironment || snapshot;
  const assetIds = new Set([
    ...environment.assets.map((item) => item.id),
    ...source.objects.flatMap((item) => item.sourceAssetIds),
    ...source.mappings.map((item) => item.assetId),
    ...source.objects.flatMap((item) => item.attributes.flatMap((attribute) => (attribute.mappedField ? [attribute.mappedField.assetId] : []))),
    ...source.relations.flatMap((item) => (item.dataBinding?.junctionAssetId ? [item.dataBinding.junctionAssetId] : [])),
  ]);
  const selectedAssets = environment.assets.filter((item) => assetIds.has(item.id));
  if ([...assetIds].some((id) => !selectedAssets.some((item) => item.id === id))) throw new OntologyPackageError('DEPENDENCY_UNRESOLVED', 'A referenced data asset is missing.');
  const connectorIds = new Set([
    ...environment.connectors.map((item) => item.id),
    ...selectedAssets.flatMap((item) => (typeof item.metadata.connectorId === 'string' ? [item.metadata.connectorId] : [])),
    ...[...source.logicFunctions, ...source.actions].flatMap((item) => (typeof item.configuration.connectorId === 'string' ? [item.configuration.connectorId] : [])),
  ]);
  const connectors = environment.connectors.filter((item) => connectorIds.has(item.id));
  if ([...connectorIds].some((id) => !connectors.some((item) => item.id === id))) throw new OntologyPackageError('DEPENDENCY_UNRESOLVED', 'A referenced data connection is missing.');
  const bindings: IOntologyRuntimeBindings = { connections: {}, files: {}, actions: {}, allowedActions: [] };
  const resources: IOntologyPackageResource[] = connectors.map((item) => {
    const current = snapshot.connectors.find((entry) => entry.id === item.id);
    if (current) bindings.connections![item.id] = ontologyConnectionBinding(structuredClone(current));
    return { id: item.id, name: item.name, provider: item.sourceType, assetIds: selectedAssets.filter((asset) => asset.metadata.connectorId === item.id).map((asset) => asset.id), requiredFields: connectorRequirements(item.sourceType) };
  });
  for (const asset of selectedAssets) {
    if (!asset.metadata.connectorId && (asset.path || asset.metadata.runtimeResource === 'file')) {
      resources.push({ id: 'file:' + asset.id, name: asset.name, provider: 'file', assetIds: [asset.id], requiredFields: ['path'] });
      bindings.files![asset.id] = asset.path || '';
    }
  }
  const ontologyId = source.packageIdentity?.ontologyId || options.ontologyId || 'urn:sudowork:ontology:' + contentHash(options.root + '/' + snapshot.workspaceId);
  const draft = version?.snapshot.authoringDraft || snapshot.draft;
  const agent: IOntologyAgentDefinition = source.agentDefinition || { name: draft.title, description: draft.description, instructions: options.prompt?.trim() || 'Use the published ontology and its capabilities for grounded business answers.' };
  const model: IRuntimeModel = {
    ontologyId,
    workspaceId: ontologyId,
    title: draft.title,
    versionId: version?.id || 'draft',
    semanticDocument: source.semanticDocument || reconcileSemanticModel(createSemanticDocument(snapshot.workspaceId), { objects: [], relations: [] }, source, snapshot.workspaceId),
    objects: structuredClone(source.objects),
    relations: structuredClone(source.relations),
    mappings: structuredClone(source.mappings),
    qualityRules: structuredClone(source.qualityRules),
    logicFunctions: source.logicFunctions.map((item) => ({ ...structuredClone(item), executionCount: 0, lastExecutedAt: undefined, updatedAt: 0 })),
    actions: source.actions.map((item) => ({ ...structuredClone(item), executionCount: 0, lastExecutedAt: undefined, updatedAt: 0 })),
    serviceEndpoints: [],
    businessDocuments: structuredClone(source.businessDocuments),
    assets: selectedAssets.map((item) => ({
      ...structuredClone(item),
      path: undefined,
      fields: item.fields.map(({ sampleValues: _sampleValues, ...field }) => structuredClone(field)),
      metadata: { ...Object.fromEntries(Object.entries(item.metadata).filter(([key]) => !SECRET_KEY.test(key) && !/path|url|host|endpoint|connectionString|sample|preview|snippet/i.test(key))), ...(!item.metadata.connectorId && item.path ? { runtimeResource: 'file' } : {}) },
    })),
    connectors: connectors.map((item) => ({ id: item.id, name: item.name, sourceType: item.sourceType, kind: item.kind, writable: false, metadata: {}, probeStatus: 'not_tested', createdAt: 0, updatedAt: 0 })),
  };
  const capabilities: IOntologyPackageCapability[] = [];
  const files = new Map<string, string | Uint8Array>();
  for (const item of model.logicFunctions) {
    if (item.status === 'active' && item.runtime === 'typescript' && item.body) new Script('(async () => { "use strict";\n' + item.body + '\n})()');
    const file = 'capabilities/implementations/' + contentHash(item.id).slice(0, 24) + (item.runtime === 'sql' ? '.sql' : item.runtime === 'python' ? '.py' : '.js');
    if (item.body) files.set(file, item.body);
    capabilities.push({
      id: 'logic.' + item.code,
      artifactId: item.id,
      kind: 'logic',
      name: item.displayName || item.name,
      description: item.displayDescription || item.description,
      parameters: item.parameters,
      isReadOnly: true,
      isEnabled: item.status === 'active',
      output: { returnType: item.returnType },
      resourceRefs: [],
      ...(item.body ? { implementation: { runtime: item.runtime, file } } : {}),
    });
    item.body = '';
    item.configuration = bindPackageSecrets(item.configuration, 'logic:' + item.id, bindings, resources) as typeof item.configuration;
  }
  for (const item of model.actions) {
    if (!item.parameters.length) {
      const names = [...new Set([...JSON.stringify(item.configuration).matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map((match) => match[1]))];
      item.parameters = names.map((name) => ({ name, type: 'unknown', required: true }));
    }
    capabilities.push({
      id: 'action.' + item.code,
      artifactId: item.id,
      kind: 'action',
      name: item.displayName || item.name,
      description: item.displayDescription || item.description,
      parameters: item.parameters,
      isReadOnly: false,
      isEnabled: item.status === 'active',
      output: { schema: item.outputSchema as unknown as OntologyJsonValue },
      resourceRefs: [],
    });
    if (item.executor === 'sql' && typeof item.configuration.statement === 'string') {
      const file = 'capabilities/implementations/action-' + contentHash(item.id).slice(0, 24) + '.sql';
      files.set(file, item.configuration.statement);
      capabilities[capabilities.length - 1].implementation = { runtime: 'sql', file };
      item.configuration.statement = '';
    }
    if (item.executor === 'custom_script' && typeof item.configuration.command === 'string') {
      const executable = path.basename(item.configuration.command).toLowerCase();
      const interpreter = /^node(?:\.exe)?$/.test(executable) ? 'node' : /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/.test(executable) ? 'python' : executable === 'bash' ? 'bash' : executable === 'sh' ? 'shell' : undefined;
      if (interpreter) {
        const args = Array.isArray(item.configuration.args) ? item.configuration.args : [];
        const portableArgs: Array<string | { file: string }> = [];
        for (const argument of args) {
          if (typeof argument !== 'string') throw new OntologyPackageError('PACKAGE_INVALID', 'Script arguments must be strings.');
          if (/\.(?:m?js|cjs|py|sh)$/.test(argument) && !argument.includes('{{')) {
            const sourcePath = path.resolve(argument);
            if (!(await fs.stat(sourcePath)).isFile()) throw new OntologyPackageError('DEPENDENCY_UNRESOLVED', 'Script source is unavailable.');
            const sourceCode = await fs.readFile(sourcePath);
            if (sourceCode.length > 1024 * 1024) throw new OntologyPackageError('PACKAGE_INVALID', 'Script source exceeds size limit.');
            const sourceFile = 'capabilities/implementations/source-' + contentHash(sourceCode) + path.extname(argument);
            files.set(sourceFile, sourceCode);
            portableArgs.push({ file: sourceFile });
          } else portableArgs.push(argument);
        }
        const file = 'capabilities/implementations/command-' + contentHash(item.id).slice(0, 24) + '.json';
        files.set(file, canonicalJson({ args: portableArgs }));
        capabilities[capabilities.length - 1].implementation = { runtime: interpreter, file };
        delete item.configuration.command;
        delete item.configuration.args;
      }
    }
    bindings.allowedActions!.push(item.id);
    if (['api', 'notification', 'custom_script'].includes(item.executor) && !capabilities[capabilities.length - 1].implementation) {
      item.configuration.resourceRef = 'action:' + item.id;
      const overrides: Record<string, OntologyJsonValue> = {};
      for (const key of ['url', 'command', 'args']) {
        if (item.configuration[key] !== undefined) {
          overrides[key] = item.configuration[key];
          delete item.configuration[key];
        }
      }
      bindings.actions![item.id] = overrides;
      resources.push({ id: 'action:' + item.id, name: item.name, provider: item.executor === 'custom_script' ? 'script' : item.executor === 'notification' ? 'notification' : 'api', assetIds: [], requiredFields: item.executor === 'custom_script' ? ['command', 'args'] : ['url'] });
    }
    item.configuration = bindPackageSecrets(item.configuration, 'action:' + item.id, bindings, resources) as typeof item.configuration;
  }
  for (const relation of model.relations.filter((item) => item.dataBinding && item.dataBinding.mode !== 'semantic_only')) {
    capabilities.push({
      id: 'relation.' + relation.code,
      artifactId: relation.id,
      kind: 'relation',
      name: relation.name,
      description: relation.description || '',
      parameters: [
        { name: 'query', type: 'object', required: false },
        { name: 'direction', type: 'string', required: false },
        { name: 'limit', type: 'integer', required: false },
        { name: 'maxDepth', type: 'integer', required: false },
      ],
      isReadOnly: true,
      isEnabled: true,
      resourceRefs: [],
    });
  }
  const objectResources = (objectIds: string[]) => {
    const assetIds = new Set([
      ...model.mappings.filter((mapping) => objectIds.includes(mapping.objectId)).map((mapping) => mapping.assetId),
      ...model.objects.filter((object) => objectIds.includes(object.id)).flatMap((object) => object.attributes.flatMap((attribute) => (attribute.mappedField ? [attribute.mappedField.assetId] : []))),
    ]);
    return resources.filter((resource) => resource.assetIds.some((id) => assetIds.has(id))).map((resource) => resource.id);
  };
  for (const capability of capabilities) {
    const required = new Set(resources.filter((resource) => resource.provider === 'secret' && resource.id.startsWith(capability.kind + ':' + capability.artifactId + '/')).map((resource) => resource.id));
    if (capability.kind === 'logic') {
      const logic = model.logicFunctions.find((item) => item.id === capability.artifactId)!;
      if (logic.configuration.builtIn === 'lookup') {
        for (const id of objectResources(typeof logic.configuration.objectId === 'string' ? [logic.configuration.objectId] : logic.objectIds)) required.add(id);
      } else if (logic.runtime === 'sql') {
        for (const id of typeof logic.configuration.connectorId === 'string' ? [logic.configuration.connectorId] : objectResources(logic.objectIds)) required.add(id);
      }
    } else if (capability.kind === 'relation') {
      const relation = model.relations.find((item) => item.id === capability.artifactId)!;
      for (const id of objectResources([relation.fromObjectId, relation.toObjectId])) required.add(id);
      if (relation.dataBinding?.junctionAssetId) for (const resource of resources.filter((item) => item.assetIds.includes(relation.dataBinding!.junctionAssetId!))) required.add(resource.id);
    } else {
      const action = model.actions.find((item) => item.id === capability.artifactId)!;
      if (action.configuration.builtIn === 'update_attribute') {
        for (const id of objectResources(typeof action.configuration.objectId === 'string' ? [action.configuration.objectId] : action.objectIds)) required.add(id);
      } else if (action.executor === 'sql') {
        for (const id of typeof action.configuration.connectorId === 'string' ? [action.configuration.connectorId] : objectResources(action.objectIds)) required.add(id);
      }
      const external = resources.find((resource) => resource.id === 'action:' + action.id);
      if (external) required.add(external.id);
    }
    capability.resourceRefs = [...required];
  }
  for (const capability of capabilities.filter((item) => item.kind === 'action')) {
    const action = model.actions.find((item) => item.id === capability.artifactId)!;
    if (action.executor === 'function' && !action.configuration.builtIn) {
      const target = capabilities.find((item) => item.id === 'logic.' + action.configuration.functionCode);
      if (capability.isEnabled && (!target || !target.isEnabled)) throw new OntologyPackageError('DEPENDENCY_UNRESOLVED', 'Action references an unavailable function: ' + action.code);
      if (!target) continue;
      capability.resourceRefs = [...new Set([...capability.resourceRefs, ...target.resourceRefs])];
    }
  }
  files.set('ontology/model.rdf', exportStandardOntology(model.semanticDocument!, 'rdfxml'));
  files.set('ontology/runtime-model.json', canonicalJson(model));
  files.set('capabilities/catalog.json', canonicalJson(capabilities));
  files.set('scripts/ontology.cjs', await fs.readFile(options.cliFile));
  files.set('authoring/project.json', canonicalJson({ draft, agentDefinition: agent, packageIdentity: { ontologyId, ...(source.packageIdentity?.source ? { source: source.packageIdentity.source } : {}) } }));
  files.set('agent/AGENT.md', agent.instructions + AGENT_RUNTIME_INSTRUCTIONS);
  files.set(
    'agent/definition.json',
    canonicalJson({
      id: 'default',
      name: agent.name,
      description: agent.description,
      instructionsFile: 'agent/AGENT.md',
      capabilityRefs: capabilities.filter((item) => item.isEnabled).map((item) => item.id),
      requirements: { commandExecution: true, protocolVersion: 1 },
      authorization: { actionPolicy: 'host-granted', resourcePolicy: 'host-bound', credentials: 'host-only' },
    })
  );
  files.set('environment/resources.json', canonicalJson(resources));
  files.set(
    'environment/bindings.example.json',
    canonicalJson({
      connections: Object.fromEntries(connectors.map((item) => [item.id, { sourceType: item.sourceType, ...(['s3', 'oss'].includes(item.sourceType) ? { params: { bucket: '' } } : Object.fromEntries(connectorRequirements(item.sourceType).map((key) => [key, '']))), writable: false }])),
      files: Object.fromEntries(Object.keys(bindings.files!).map((id) => [id, ''])),
      actions: Object.fromEntries(Object.keys(bindings.actions!).map((id) => [id, {}])),
      secrets: Object.fromEntries(Object.keys(bindings.secrets || {}).map((id) => [id, ''])),
      allowedActions: [],
    })
  );
  files.set(
    'environment/runtime.lock.json',
    canonicalJson({
      profile: 'sudowork-ontology-script/v1',
      node: '>=22.22.2',
      protocolVersion: 1,
      sqlite: 'node:sqlite',
      cliSha256: contentHash(files.get('scripts/ontology.cjs')!),
      shells: [...new Set(capabilities.flatMap((item) => (item.implementation?.runtime === 'bash' ? ['bash'] : item.implementation?.runtime === 'shell' ? ['sh'] : [])))],
      python: model.logicFunctions.some((item) => item.status === 'active' && item.runtime === 'python') || capabilities.some((item) => item.implementation?.runtime === 'python') ? '>=3.9' : null,
      externalDrivers: [],
      externalDependencies: [...model.logicFunctions, ...model.actions].flatMap((item) => (item.configuration.dependencies === undefined ? [] : ontologyDependencySchema.parse(item.configuration.dependencies).map((dependency) => ({ ...dependency, artifactId: item.id })))),
      oracleMode: 'thin',
    })
  );
  files.set(
    'environment/bindings.schema.json',
    canonicalJson({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        connections: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            connectors.map((item) => [
              item.id,
              {
                type: 'object',
                properties: {
                  sourceType: { const: item.sourceType },
                  host: { type: 'string' },
                  port: { type: 'integer', minimum: 1, maximum: 65535 },
                  database: { type: 'string' },
                  path: { type: 'string' },
                  url: { type: 'string' },
                  username: { type: 'string' },
                  password: { type: 'string' },
                  credential: { type: 'object' },
                  params: { type: 'object' },
                  headers: { type: 'object', additionalProperties: { type: 'string' } },
                  writable: { type: 'boolean' },
                },
                additionalProperties: false,
              },
            ])
          ),
        },
        files: { type: 'object', additionalProperties: { type: 'string' } },
        actions: { type: 'object', additionalProperties: { type: 'object', properties: { url: { type: 'string' }, headers: { type: 'object' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
        secrets: { type: 'object' },
        python: { type: 'string' },
        allowedActions: { type: 'array', uniqueItems: true, items: { type: 'string', enum: capabilities.filter((item) => !item.isReadOnly).map((item) => item.artifactId) } },
      },
    })
  );
  const runtimeDigest = 'sha256:' + contentHash(canonicalJson(Object.fromEntries([...files].sort(([left], [right]) => left.localeCompare(right)).map(([name, content]) => [name, contentHash(content)]))));
  const manifest: IOntologyPackageManifest = {
    kind: 'sudowork-ontology-package',
    formatVersion: 1,
    protocolVersion: 1,
    ontologyId: model.ontologyId,
    name: draft.title,
    version: version?.version || 'draft',
    versionId: model.versionId,
    ...(source.packageIdentity?.source ? { derivedFrom: source.packageIdentity.source } : {}),
    modelAuthority: 'rdf',
    runtimeDigest,
    resources,
    entrypoints: { model: 'ontology/runtime-model.json', semantic: 'ontology/model.rdf', capabilities: 'capabilities/catalog.json', cli: 'scripts/ontology.cjs', agent: 'agent/definition.json', authoring: 'authoring/project.json' },
  };
  const directory = path.join(options.root, runtimeDigest.slice(7));
  try {
    await fs.access(directory);
    await verifyPackage(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const staging = directory + '.tmp-' + randomUUID();
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      for (const [name, content] of files) {
        if (name === 'scripts/ontology.cjs') {
          const target = packageFilePath(staging, name);
          await materializeRuntimeCli(options.root, content, target);
        } else await writePackageFile(staging, name, content);
      }
      await writePackageFile(staging, 'manifest.json', canonicalJson(manifest));
      await sealPackage(staging);
      await fs.rename(staging, directory).catch(async (renameError: NodeJS.ErrnoException) => {
        if (!['EEXIST', 'ENOTEMPTY'].includes(renameError.code || '')) throw renameError;
        await verifyPackage(directory);
      });
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  return { directory, manifest, capabilities, bindings };
}

export async function loadOntologyArtifact(directory: string, bindings: IOntologyRuntimeBindings = {}, isAuthoring = false) {
  const manifest = await verifyPackage(directory);
  const model = JSON.parse((await readPackageFile(directory, manifest.entrypoints.model)).toString('utf8')) as IRuntimeModel;
  if (model.ontologyId !== manifest.ontologyId || model.versionId !== manifest.versionId) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Ontology identity does not match its runtime model.');
  const authoring = JSON.parse((await readPackageFile(directory, manifest.entrypoints.authoring)).toString('utf8')) as { draft: IOntologyWorkbenchSnapshot['draft']; agentDefinition: IOntologyAgentDefinition; packageIdentity: IOntologyWorkbenchSnapshot['packageIdentity'] };
  if (authoring.packageIdentity?.ontologyId !== manifest.ontologyId || canonicalJson(authoring.packageIdentity.source || null) !== canonicalJson(manifest.derivedFrom || null) || typeof authoring.draft?.title !== 'string' || typeof authoring.agentDefinition?.instructions !== 'string')
    throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid authoring metadata.');
  if (!model.semanticDocument || (await readPackageFile(directory, manifest.entrypoints.semantic)).toString('utf8') !== exportStandardOntology(model.semanticDocument, 'rdfxml')) throw new OntologyPackageError('PACKAGE_INTEGRITY_FAILED', 'Semantic and runtime models do not match.');
  const capabilities = JSON.parse((await readPackageFile(directory, manifest.entrypoints.capabilities)).toString('utf8')) as IOntologyPackageCapability[];
  if (!Array.isArray(capabilities) || !Array.isArray(model.objects) || !Array.isArray(model.assets) || !Array.isArray(model.connectors)) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid runtime model.');
  try {
    validateOntologyPackageModel(model, capabilities, manifest.resources);
  } catch (error) {
    throw new OntologyPackageError('PACKAGE_INVALID', error instanceof Error ? error.message : 'Invalid runtime model.');
  }
  const agent = JSON.parse((await readPackageFile(directory, manifest.entrypoints.agent)).toString('utf8')) as { name: string; description: string; instructionsFile: string; capabilityRefs: string[] };
  if (
    agent.name !== authoring.agentDefinition.name ||
    agent.description !== authoring.agentDefinition.description ||
    typeof agent.instructionsFile !== 'string' ||
    canonicalJson(agent.capabilityRefs) !== canonicalJson(capabilities.filter((item) => item.isEnabled).map((item) => item.id)) ||
    (await readPackageFile(directory, agent.instructionsFile)).toString('utf8') !== authoring.agentDefinition.instructions + AGENT_RUNTIME_INSTRUCTIONS
  )
    throw new OntologyPackageError('PACKAGE_INVALID', 'Agent definition and editable instructions do not match.');
  for (const capability of capabilities) {
    if (capability.implementation) {
      const implementation = (await readPackageFile(directory, capability.implementation.file)).toString('utf8');
      if (capability.kind === 'action') {
        const action = model.actions.find((item) => item.id === capability.artifactId);
        if (!action) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing action implementation target.');
        if (action.executor === 'sql') action.configuration.statement = implementation;
        else if (action.executor === 'custom_script') {
          const descriptor = JSON.parse(implementation) as { args: Array<string | { file: string }> };
          if (!Array.isArray(descriptor.args)) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid script arguments.');
          const runtime = capability.implementation.runtime;
          if (!['node', 'python', 'shell', 'bash'].includes(runtime)) throw new OntologyPackageError('RUNTIME_INCOMPATIBLE', 'Unsupported script interpreter.');
          action.configuration.command = runtime === 'node' ? (isAuthoring ? 'node' : process.execPath) : runtime === 'python' ? bindings.python || 'python3' : runtime === 'bash' ? '/bin/bash' : '/bin/sh';
          const argumentsList: string[] = [];
          for (const argument of descriptor.args) {
            if (typeof argument === 'string') argumentsList.push(argument);
            else {
              if (!argument || typeof argument.file !== 'string') throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid script source reference.');
              await readPackageFile(directory, argument.file);
              argumentsList.push(packageFilePath(directory, argument.file));
            }
          }
          action.configuration.args = argumentsList;
        } else throw new OntologyPackageError('PACKAGE_INVALID', 'Unsupported action implementation.');
      } else {
        const logic = model.logicFunctions.find((item) => item.id === capability.artifactId);
        if (!logic) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing capability implementation target.');
        logic.body = implementation;
      }
    }
  }
  const missing: string[] = [];
  for (const resource of manifest.resources) {
    if (resource.provider === 'secret') {
      if (bindings.secrets?.[resource.id] === undefined || bindings.secrets[resource.id] === '') missing.push(resource.id);
    } else if (resource.provider === 'file') {
      const asset = model.assets.find((item) => item.id === resource.assetIds[0]);
      if (!asset) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing file asset.');
      asset.path = bindings.files?.[asset.id] || (resource.embeddedPath ? packageFilePath(directory, resource.embeddedPath) : undefined);
      if (!asset.path) missing.push(resource.id);
    } else if (resource.id.startsWith('action:')) {
      const action = model.actions.find((item) => item.id === resource.id.slice(7));
      if (!action) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing action binding target.');
      const override = bindings.actions?.[action.id] || {};
      for (const key of ['url', 'command', 'args']) if (override[key] !== undefined) action.configuration[key] = override[key];
      if (override.headers && typeof override.headers === 'object' && !Array.isArray(override.headers))
        action.configuration.headers = { ...(action.configuration.headers && typeof action.configuration.headers === 'object' && !Array.isArray(action.configuration.headers) ? action.configuration.headers : {}), ...override.headers };
      if (resource.requiredFields.some((key) => action.configuration[key] === undefined || action.configuration[key] === '')) missing.push(resource.id);
    } else {
      const connector = model.connectors.find((item) => item.id === resource.id);
      if (!connector) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing connection.');
      const binding = bindings.connections?.[resource.id];
      if (binding?.sourceType && binding.sourceType !== connector.sourceType) throw new OntologyPackageError('SOURCE_SCHEMA_MISMATCH', 'Connection provider changed: ' + resource.id);
      if (binding) {
        for (const key of ['host', 'port', 'database', 'path', 'url', 'username', 'password', 'credential', 'params', 'headers', 'writable'] as const) {
          if (binding[key] !== undefined) Object.assign(connector, { [key]: binding[key] });
        }
      }
      if (resource.embeddedPath && !binding?.path) {
        connector.path = packageFilePath(directory, resource.embeddedPath);
        connector.writable = false;
      }
      if (connector.writable && connector.path && path.resolve(connector.path).startsWith(path.resolve(directory) + path.sep)) throw new OntologyPackageError('WRITE_NOT_AUTHORIZED', 'Package files are immutable. Bind a separate writable data copy.');
      if (resource.requiredFields.some((key) => !requiredConnectionValue(connector, key))) missing.push(resource.id);
    }
  }
  const resolveSecrets = (value: OntologyJsonValue): OntologyJsonValue => {
    if (Array.isArray(value)) return value.map(resolveSecrets);
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 1 && typeof value.$secret === 'string') return bindings.secrets?.[value.$secret] ?? (isAuthoring ? value : null);
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveSecrets(entry)]));
    }
    return value;
  };
  for (const item of [...model.logicFunctions, ...model.actions]) item.configuration = resolveSecrets(item.configuration) as typeof item.configuration;
  const snapshot: IOntologyWorkbenchSnapshot = { ...createDefaultOntologyWorkbenchSnapshot(0, { workspaceId: model.workspaceId, title: model.title }), ...model, draft: authoring.draft, agentDefinition: authoring.agentDefinition, packageIdentity: authoring.packageIdentity };
  return { manifest, capabilities, snapshot, missingBindings: missing };
}
