/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// The unified channel message protocol types and their pure helpers (no
// app-transport, @process/@channels/electron/node dependency) now live in
// @sudowork/common so the renderer and a future shared renderer package can
// consume them. Re-exported here so every existing `@/channels/types` import
// (types AND runtime) keeps resolving unchanged.
export * from '@sudowork/common/channelTypes';
