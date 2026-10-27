import type { IOntologyDescribeAssetFieldsInput, IOntologyStudioSaveInput, IOntologyWorkbenchSnapshot, IOntologyStandardPreview, IOntologyStandardImportInput, IOntologyStandardExportInput, OntologyFileFormat } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchApi } from '../OntologyWorkbench';

export interface IOntologyStudioApi extends IOntologyWorkbenchApi {
  packageImport?: {
    preview: (input: { filePath: string }) => Promise<import('@sudowork/ontology-common').IOntologyPackagePreview>;
    import: (input: import('@sudowork/ontology-common').IOntologyPackageImportInput) => Promise<IOntologyWorkbenchSnapshot>;
  };
  runtimeEnvironment?: {
    get: (input: { workspaceId: string }) => Promise<import('@sudowork/ontology-common').IOntologyRuntimeEnvironment>;
    configure: (input: { workspaceId: string; bindings: import('@sudowork/ontology-common').IOntologyRuntimeBindings }) => Promise<import('@sudowork/ontology-common').IOntologyRuntimeEnvironment>;
    verify: (input: { workspaceId: string }) => Promise<import('@sudowork/ontology-common').OntologyJsonValue | undefined>;
  };
  updateAgentDefinition?: (input: { workspaceId: string; expectedRevision: number; definition: import('@sudowork/ontology-common').IOntologyAgentDefinition }) => Promise<IOntologyWorkbenchSnapshot>;
  runtimePackage?: {
    plan: (input: { workspaceId: string; versionId: string }) => Promise<import('@sudowork/ontology-common').IOntologyPackagePlan>;
    export: (input: import('@sudowork/ontology-common').IOntologyPackageExportInput) => Promise<import('@sudowork/ontology-common').IOntologyPackageExportResult>;
    cancel: (input: { requestId: string }) => Promise<void>;
    onProgress: (onChanged: (event: import('@sudowork/ontology-common').IOntologyPackageExportProgress) => void) => () => void;
  };
  projects?: {
    list: () => Promise<import('@sudowork/ontology-common').IOntologyStudioProjectList>;
    get: (input: { workspaceId: string }) => Promise<import('@sudowork/ontology-common').IOntologyStudioProject>;
    connectSource: (input: import('@sudowork/ontology-common').IOntologyConnectSourceInput) => Promise<import('@sudowork/ontology-common').IOntologyStudioProject>;
    resumeSource: (input: { operationId: string }) => Promise<import('@sudowork/ontology-common').IOntologyStudioProject | null>;
    onChanged: (onChanged: (event: { workspaceId: string }) => void) => () => void;
  };
  requestAiRepair: (input: { workspaceId: string; title: string; prompt: string }, onConversationReady: (conversationId: string) => void) => Promise<void>;
  createAgentBlueprint: (input: import('@sudowork/ontology-common').IOntologyAgentBlueprintInput) => Promise<{
    snapshot: IOntologyWorkbenchSnapshot;
    blueprint: import('@sudowork/ontology-common').IOntologyAgentBlueprint;
  }>;
  describeAssetFields: (input: IOntologyDescribeAssetFieldsInput) => Promise<IOntologyWorkbenchSnapshot>;
  saveStudioModel: (input: IOntologyStudioSaveInput) => Promise<IOntologyWorkbenchSnapshot>;
  previewStandardFile: (input: { filePath: string }) => Promise<IOntologyStandardPreview>;
  importStandardFile: (input: IOntologyStandardImportInput) => Promise<IOntologyWorkbenchSnapshot>;
  exportStandardFile: (input: IOntologyStandardExportInput) => Promise<{ content: string; format: OntologyFileFormat }>;
  pickStandardFile: () => Promise<string | undefined>;
  pickDataFiles: () => Promise<string[]>;
  pickSqliteFile: () => Promise<string | undefined>;
}
