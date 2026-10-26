import type { IOntologyDescribeAssetFieldsInput, IOntologyStudioSaveInput, IOntologyWorkbenchSnapshot, IOntologyStandardPreview, IOntologyStandardImportInput, IOntologyStandardExportInput, OntologyFileFormat } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchApi } from '../OntologyWorkbench';

export interface IOntologyStudioApi extends IOntologyWorkbenchApi {
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
