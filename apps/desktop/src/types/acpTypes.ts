/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// The ACP backend registry and all ACP protocol types are pure (no app-transport,
// @process/@channels/electron/node dependency), so they now live in
// @sudowork/common and are consumed directly by the renderer and a future shared
// renderer package. Re-exported here so every existing `@/types/acpTypes` import
// (types AND runtime) keeps resolving unchanged.
export * from '@sudowork/common/acpTypes';
