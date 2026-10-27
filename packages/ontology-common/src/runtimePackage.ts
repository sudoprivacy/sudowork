import type { IOntologyFunctionParameter, IOntologyConnectorConfig, OntologyConnectionSourceType, OntologyJsonValue } from './index.js';

export const ONTOLOGY_PACKAGE_FORMAT_VERSION = 1;
export const ONTOLOGY_SCRIPT_PROTOCOL_VERSION = 1;
export const ONTOLOGY_PACKAGE_EXTENSION = 'sudoonto';

export interface IOntologyPackageOrigin {
  ontologyId: string;
  versionId: string;
  version: string;
  runtimeDigest: string;
}

export interface IOntologyPackageIdentity {
  ontologyId: string;
  source?: IOntologyPackageOrigin;
}

export interface IOntologyAgentDefinition {
  name: string;
  description: string;
  instructions: string;
}

export interface IOntologyRuntimeBindings {
  connections?: Record<string, Partial<IOntologyConnectorConfig>>;
  files?: Record<string, string>;
  actions?: Record<string, Record<string, OntologyJsonValue>>;
  secrets?: Record<string, OntologyJsonValue>;
  python?: string;
  allowedActions?: string[];
}

export interface IOntologyPackageCapability {
  id: string;
  artifactId: string;
  kind: 'logic' | 'relation' | 'action';
  name: string;
  description: string;
  parameters: IOntologyFunctionParameter[];
  isReadOnly: boolean;
  isEnabled?: boolean;
  output?: { returnType?: string; schema?: OntologyJsonValue };
  resourceRefs: string[];
  implementation?: { runtime: string; file: string };
}

export interface IOntologyPackageResource {
  id: string;
  name: string;
  provider: OntologyConnectionSourceType | 'file' | 'api' | 'notification' | 'script' | 'secret';
  assetIds: string[];
  requiredFields: string[];
  embeddedPath?: string;
}

export interface IOntologyPackageManifest {
  kind: 'sudowork-ontology-package';
  formatVersion: 1;
  protocolVersion: 1;
  ontologyId: string;
  name: string;
  version: string;
  versionId: string;
  derivedFrom?: IOntologyPackageOrigin;
  modelAuthority: 'rdf';
  runtimeDigest: string;
  resources: IOntologyPackageResource[];
  entrypoints: { model: string; semantic: string; capabilities: string; cli: string; agent: string; authoring: string };
}

export interface IOntologyPackagePreview {
  fingerprint: string;
  manifest: IOntologyPackageManifest;
  capabilities: IOntologyPackageCapability[];
  agent: IOntologyAgentDefinition;
  missingBindings: string[];
  objectCount: number;
  relationCount: number;
}

export interface IOntologyPackageImportInput {
  filePath: string;
  fingerprint: string;
  name?: string;
  isFork?: boolean;
}

export interface IOntologyRuntimeEnvironment {
  resources: IOntologyPackageResource[];
  missingBindings: string[];
  template: IOntologyRuntimeBindings;
}

export interface IOntologyPackageExportInput {
  requestId: string;
  workspaceId: string;
  versionId: string;
  embeddedResourceIds?: string[];
}

export interface IOntologyPackageExportProgress {
  requestId: string;
  phase: 'collecting' | 'validating' | 'packing';
  completed: number;
  total: number;
}

export interface IOntologyPackagePlan {
  versionId: string;
  version: string;
  resources: IOntologyPackageResource[];
  capabilities: IOntologyPackageCapability[];
}

export interface IOntologyPackageExportResult {
  isCancelled: boolean;
  filePath?: string;
  runtimeDigest?: string;
  packageDigest?: string;
  fileBytes?: number;
  runtimeVerification?: 'binding-required' | 'passed' | 'not-run';
  requiresBindings?: string[];
}

export interface IOntologyScriptResponse {
  meta?: { executedFunctionIds: string[] };
  protocolVersion: 1;
  requestId: string;
  isSuccess: boolean;
  data?: OntologyJsonValue;
  error?: { code: string; message: string; isRetryable: boolean; recovery?: OntologyJsonValue };
}
