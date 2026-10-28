import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IOntologyScriptResponse, OntologyJsonValue } from '@sudowork/ontology-common';
import { loadOntologyArtifact, OntologyPackageError } from './artifact.js';
import type { IOntologyRuntimeBindings } from './artifact.js';
import { ontologyBindingsSchema } from './bindings.js';
import { executeActionDefinition, executeLogicFunctionDefinition, executeRelationDefinition, inspectRuntimeBindings, runProcess, toOntologyJsonValue, validateRuntimeArguments } from './execution.js';

interface IScriptRequest {
  protocolVersion?: number;
  requestId?: string;
  arguments?: Record<string, OntologyJsonValue>;
}

function parseOptions(args: string[]) {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('--')) positional.push(value);
    else {
      if (!['--package', '--bindings', '--context', '--input-file'].includes(value) || !args[index + 1] || args[index + 1].startsWith('--') || options.has(value)) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Invalid command option: ' + value);
      options.set(value, args[++index]);
    }
  }
  return { positional, options };
}

export async function runOntologyCommand(args: string[], request: IScriptRequest, trace: { executedFunctionIds: string[] } = { executedFunctionIds: [] }): Promise<unknown> {
  if (request.protocolVersion !== undefined && request.protocolVersion !== 1) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Unsupported command protocol.');
  const { positional, options } = parseOptions(args);
  const [command, capabilityId] = positional;
  const parameters = request.arguments || {};
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Arguments must be a JSON object.');
  if (command === 'project') {
    const contextPath = options.get('--context');
    if (!contextPath) throw new OntologyPackageError('BINDING_REQUIRED', 'A host-provided project context is required.');
    const context = JSON.parse(await fs.readFile(contextPath, 'utf8')) as { baseUrl: string; token: string; workspaceId: string };
    const base = new URL(context.baseUrl);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new OntologyPackageError('PERMISSION_DENIED', 'Invalid project host.');
    if (!capabilityId || !/^[a-z_]+$/.test(capabilityId)) throw new OntologyPackageError('INVALID_ARGUMENTS', 'A project command is required.');
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + context.token };
    const discovery = await fetch(new URL('/commands', base), { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30_000) });
    const catalog = (await discovery.json()) as { ok: boolean; data?: { commands?: Array<{ name: string }> }; message?: string };
    if (!discovery.ok || !catalog.ok || !Array.isArray(catalog.data?.commands)) throw new OntologyPackageError('PROJECT_COMMAND_FAILED', catalog.message || 'Project discovery failed.');
    if (capabilityId === 'list') return catalog.data;
    if (!catalog.data.commands.some((item) => item.name === capabilityId)) throw new OntologyPackageError('CAPABILITY_NOT_FOUND', 'Project command not available for this model.');
    const response = await fetch(new URL('/tool/' + capabilityId, base), { method: 'POST', headers, body: JSON.stringify({ workspaceId: context.workspaceId, input: parameters }), signal: AbortSignal.timeout(120_000) });
    const payload = (await response.json()) as { ok: boolean; data?: unknown; message?: string; code?: string; recovery?: unknown };
    if (!response.ok || !payload.ok) throw new OntologyPackageError(payload.code || 'PROJECT_COMMAND_FAILED', payload.message || 'Project command failed.', payload.recovery);
    return payload.data;
  }
  const root = path.resolve(options.get('--package') || process.cwd());
  const bindings: IOntologyRuntimeBindings = options.has('--bindings') ? (ontologyBindingsSchema.parse(JSON.parse(await fs.readFile(path.resolve(options.get('--bindings')!), 'utf8'))) as IOntologyRuntimeBindings) : {};
  if (bindings.python) process.env.ONTOLOGY_PYTHON = bindings.python;
  const loaded = await loadOntologyArtifact(root, bindings);
  const { manifest, snapshot } = loaded;
  const capabilities = loaded.capabilities.filter((item) => item.isEnabled !== false);
  if (command === 'inspect') return { manifest, missingBindings: loaded.missingBindings, model: { objects: snapshot.objects, relations: snapshot.relations, mappings: snapshot.mappings, qualityRules: snapshot.qualityRules, businessDocuments: snapshot.businessDocuments } };
  if (command === 'list') return { runtimeDigest: manifest.runtimeDigest, capabilities };
  if (command === 'describe') {
    const capability = capabilities.find((item) => item.id === capabilityId);
    if (!capability) throw new OntologyPackageError('CAPABILITY_NOT_FOUND', 'Unknown capability.');
    return capability;
  }
  if (command === 'validate' || command === 'verify') {
    if (loaded.missingBindings.length) throw new OntologyPackageError('BINDING_REQUIRED', loaded.missingBindings.join(', '));
    const requirements = JSON.parse(await fs.readFile(path.join(root, 'environment/runtime.lock.json'), 'utf8')) as { python?: string | null; shells?: string[]; externalDependencies?: unknown[] };
    let python: number[] | undefined;
    try {
      if (requirements.python) {
        python = JSON.parse(await runProcess(bindings.python || 'python3', ['-I', '-c', 'import json,sys; print(json.dumps(list(sys.version_info[:3])))'], '', 5000)) as number[];
        if (python[0] < 3 || (python[0] === 3 && python[1] < 9)) throw new Error('Python 3.9 or newer is required.');
      }
      for (const shell of requirements.shells || []) {
        if (!['sh', 'bash'].includes(shell)) throw new Error('Unsupported shell requirement.');
        await fs.access('/bin/' + shell, constants.X_OK);
      }
    } catch {
      throw new OntologyPackageError('RUNTIME_INCOMPATIBLE', 'The required Python or shell interpreter is unavailable. Check environment/runtime.lock.json.');
    }
    const results = await inspectRuntimeBindings(snapshot);
    return { runtimeDigest: manifest.runtimeDigest, isValid: true, resources: results, runtime: { node: process.versions.node, python, shells: requirements.shells || [], externalDependencies: { verification: 'declaration-only', requirements: requirements.externalDependencies || [] } } };
  }
  if (command !== 'invoke' || positional.length !== 2) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Use inspect, list, describe, validate, verify or invoke.');
  const capability = capabilities.find((item) => item.id === capabilityId);
  if (!capability) throw new OntologyPackageError('CAPABILITY_NOT_FOUND', 'Unknown capability.');
  const missing = loaded.missingBindings.filter((id) => capability.resourceRefs.includes(id));
  if (missing.length) throw new OntologyPackageError('BINDING_REQUIRED', missing.join(', '));
  validateRuntimeArguments(capability.parameters, parameters);
  if (Object.keys(parameters).some((name) => !capability.parameters.some((parameter) => parameter.name === name))) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Unknown capability argument.');
  if (!capability.isReadOnly && !bindings.allowedActions?.includes(capability.artifactId)) throw new OntologyPackageError('WRITE_NOT_AUTHORIZED', 'The host must authorize this action in the runtime bindings.');
  const invokeLogic = async (code: string, values: Record<string, OntologyJsonValue>) => {
    const logic = snapshot.logicFunctions.find((item) => item.code === code && item.status === 'active');
    if (!logic) throw new OntologyPackageError('DEPENDENCY_UNRESOLVED', 'Function dependency not found: ' + code);
    validateRuntimeArguments(logic.parameters, values);
    const result = toOntologyJsonValue(await executeLogicFunctionDefinition(logic, snapshot, snapshot, values));
    trace.executedFunctionIds.push(logic.id);
    return result;
  };
  if (capability.kind === 'logic') {
    const logic = snapshot.logicFunctions.find((item) => item.id === capability.artifactId && item.status === 'active');
    if (!logic) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing function.');
    return invokeLogic(logic.code, parameters);
  }
  if (capability.kind === 'relation') {
    const relation = snapshot.relations.find((item) => item.id === capability.artifactId);
    if (!relation) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing relation.');
    return executeRelationDefinition(relation, snapshot, snapshot, parameters);
  }
  const action = snapshot.actions.find((item) => item.id === capability.artifactId && item.status === 'active');
  if (!action) throw new OntologyPackageError('PACKAGE_INVALID', 'Missing action.');
  return executeActionDefinition(action, snapshot, snapshot, parameters, invokeLogic);
}

async function readRequest(args: string[]): Promise<IScriptRequest> {
  const { options, positional } = parseOptions(args);
  if (options.has('--input-file')) {
    const target = options.get('--input-file')!;
    if ((await fs.stat(target)).size > 1024 * 1024) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Request exceeds size limit.');
    return JSON.parse(await fs.readFile(target, 'utf8')) as IScriptRequest;
  }
  if (process.stdin.isTTY || !['invoke', 'project'].includes(positional[0]) || (positional[0] === 'project' && positional[1] === 'list')) return {};
  let content = '';
  for await (const chunk of process.stdin) {
    content += String(chunk);
    if (Buffer.byteLength(content) > 1024 * 1024) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Request exceeds size limit.');
  }
  return content.trim() ? (JSON.parse(content) as IScriptRequest) : {};
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  let requestId = randomUUID() as string;
  let response: IOntologyScriptResponse;
  try {
    const request = await readRequest(args);
    requestId = request.requestId || requestId;
    const trace = { executedFunctionIds: [] as string[] };
    const data = await runOntologyCommand(args, request, trace);
    response = { protocolVersion: 1, requestId, isSuccess: true, data: toOntologyJsonValue(data), meta: trace };
  } catch (error) {
    const code = error instanceof OntologyPackageError ? error.code : 'EXECUTION_FAILED';
    response = {
      protocolVersion: 1,
      requestId,
      isSuccess: false,
      error: { code, message: error instanceof Error ? error.message : String(error), isRetryable: false, ...(error instanceof OntologyPackageError && error.recovery !== undefined ? { recovery: toOntologyJsonValue(error.recovery) } : {}) },
    };
    process.exitCode = code === 'INVALID_ARGUMENTS' ? 2 : code.includes('BINDING') ? 3 : code.includes('AUTHORIZED') || code === 'PERMISSION_DENIED' ? 4 : 5;
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}
