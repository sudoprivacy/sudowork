/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

export type GuidDraftState = {
  input: string;
  files: string[];
  dir: string;
  selectedSkills: string[];
};

const GUID_DRAFT_KEY = 'guid';

const guidDraftStore = new Map<string, GuidDraftState>();

export const getGuidDraft = (): GuidDraftState | undefined => guidDraftStore.get(GUID_DRAFT_KEY);

export const setGuidDraft = (draft: Partial<GuidDraftState>): void => {
  const prev = getGuidDraft() ?? {
    input: '',
    files: [],
    dir: '',
    selectedSkills: [],
  };
  guidDraftStore.set(GUID_DRAFT_KEY, {
    input: draft.input ?? prev.input,
    files: draft.files ?? prev.files,
    dir: draft.dir ?? prev.dir,
    selectedSkills: draft.selectedSkills ?? prev.selectedSkills,
  });
};

export const clearGuidDraft = (): void => {
  guidDraftStore.delete(GUID_DRAFT_KEY);
};
