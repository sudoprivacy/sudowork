import type { IOntologyDescribeAssetFieldsInput, IOntologyStudioSaveInput, IOntologyWorkbenchSnapshot, IOntologyStandardPreview, IOntologyStandardImportInput, IOntologyStandardExportInput, OntologyFileFormat } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchApi } from '../OntologyWorkbench';

export interface IOntologyStudioApi extends IOntologyWorkbenchApi {
  createAgentBlueprint: (input: import('@sudowork/ontology-common').IOntologyAgentBlueprintInput) => Promise<{ snapshot: IOntologyWorkbenchSnapshot; blueprint: import('@sudowork/ontology-common').IOntologyAgentBlueprint }>;
  describeAssetFields: (input: IOntologyDescribeAssetFieldsInput) => Promise<IOntologyWorkbenchSnapshot>;
  saveStudioModel: (input: IOntologyStudioSaveInput) => Promise<IOntologyWorkbenchSnapshot>;
  previewStandardFile: (input: { filePath: string }) => Promise<IOntologyStandardPreview>;
  importStandardFile: (input: IOntologyStandardImportInput) => Promise<IOntologyWorkbenchSnapshot>;
  exportStandardFile: (input: IOntologyStandardExportInput) => Promise<{ content: string; format: OntologyFileFormat }>;
  pickStandardFile: () => Promise<string | undefined>;
  pickDataFiles: () => Promise<string[]>;
  pickSqliteFile: () => Promise<string | undefined>;
}
