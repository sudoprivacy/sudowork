/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

export const isDefaultModel = (value?: string | null, label?: string | null): boolean => {
  return [value, label].some((text) => /^(default(?: model)?|recommended|默认(?:模型)?)$/i.test(text?.trim() || ''));
};

export const getModelDisplayLabel = ({ selectedValue, selectedLabel, defaultModelLabel, fallbackLabel }: { selectedValue?: string | null; selectedLabel?: string | null; defaultModelLabel: string; fallbackLabel: string }): string => {
  if (!selectedLabel) return fallbackLabel;
  return isDefaultModel(selectedValue, selectedLabel) ? defaultModelLabel : selectedLabel;
};
