import type { IProvider } from '@/common/storage';

export type ModelGroupOption = {
  id: string;
  label: string;
  provider?: string;
  providerLabel?: string;
};

export type ProviderModelGroup<T extends ModelGroupOption = ModelGroupOption> = {
  key: string;
  name: string;
  models: T[];
  provider?: IProvider;
};

export function buildProviderModelGroups<T extends ModelGroupOption>(models: T[], providers?: IProvider[]): ProviderModelGroup<T>[] {
  if (!models.length) return [];

  const modelById = new Map(models.map((model) => [model.id, model]));
  const groupedModelIds = new Set<string>();
  const groups: ProviderModelGroup<T>[] = [];
  const modelProviderGroups = new Map<string, ProviderModelGroup<T>>();

  for (const model of models) {
    if (!model.provider) continue;

    const group = modelProviderGroups.get(model.provider) || {
      key: `model-provider-${model.provider}`,
      name: model.providerLabel || model.provider,
      models: [],
    };
    group.models.push(model);
    modelProviderGroups.set(model.provider, group);
    groupedModelIds.add(model.id);
  }

  groups.push(...modelProviderGroups.values());

  for (const provider of providers || []) {
    if (provider.enabled === false) continue;

    const providerModels: T[] = [];
    for (const modelName of provider.model || []) {
      if (provider.modelEnabled?.[modelName] === false) continue;
      const model = modelById.get(modelName);
      if (!model || groupedModelIds.has(model.id)) continue;

      providerModels.push(model);
      groupedModelIds.add(model.id);
    }

    if (providerModels.length > 0) {
      groups.push({
        key: provider.id,
        name: provider.name,
        models: providerModels,
        provider,
      });
    }
  }

  const ungroupedModels = models.filter((model) => !groupedModelIds.has(model.id));
  if (ungroupedModels.length > 0) {
    groups.push({
      key: '__other__',
      name: '',
      models: ungroupedModels,
    });
  }

  return groups;
}
