/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VisibleTo } from '../api/types';

/** Scope choices for a private wiki (moss has no "admins only" for private wikis). */
export type VisibilityMode = 'all' | 'departments' | 'users' | 'self';

export interface IVisibilityValue {
  mode: VisibilityMode;
  departmentIds: string[];
  userIds: string[];
}

/**
 * Read a stored scope (mirrors moss admin `customVisibilityFrom`). Empty lists,
 * `{ null, null }` and an owner-only user list all read as "only me".
 */
export function visibilityFrom(visibleTo: VisibleTo | undefined, ownerId: string | null | undefined): IVisibilityValue {
  if (!visibleTo) return { mode: 'all', departmentIds: [], userIds: [] };
  if (visibleTo.department_ids?.length) {
    return { mode: 'departments', departmentIds: [...visibleTo.department_ids], userIds: [] };
  }
  const userIds = (visibleTo.user_ids ?? []).filter((id) => id !== 'admin');
  if (userIds.length && !(userIds.length === 1 && userIds[0] === ownerId)) {
    return { mode: 'users', departmentIds: [], userIds };
  }
  return { mode: 'self', departmentIds: [], userIds: [] };
}

/** Build the scope to save (mirrors moss admin `customVisibleToFrom`). An empty pick saves as only me. */
export function visibleToFrom(value: IVisibilityValue, ownerId: string): VisibleTo {
  if (value.mode === 'all') return null;
  if (value.mode === 'departments' && value.departmentIds.length) {
    return { department_ids: value.departmentIds, user_ids: null };
  }
  if (value.mode === 'users' && value.userIds.length) {
    return { department_ids: null, user_ids: value.userIds };
  }
  return { department_ids: null, user_ids: [ownerId] };
}
