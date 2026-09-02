import type { AcpModelInfo } from '@/types/acpTypes';

export async function setAcpModelWithScodePersistence({ backend, modelId, onSetModel, onPersistScodeDefaultModel }: ISetAcpModelWithScodePersistenceParams): Promise<AcpModelInfo | null> {
  const modelInfo = await onSetModel(modelId);
  if (backend === 'scode') {
    await onPersistScodeDefaultModel(modelId);
  }
  return modelInfo;
}

interface ISetAcpModelWithScodePersistenceParams {
  backend?: string;
  modelId: string;
  onSetModel: (modelId: string) => Promise<AcpModelInfo | null>;
  onPersistScodeDefaultModel: (modelId: string) => void | Promise<void>;
}
