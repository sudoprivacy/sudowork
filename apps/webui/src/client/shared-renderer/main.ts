/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Additive web entry that hosts the shared `@sudowork/renderer` over the moss
 * transport (proving the transport-swap on the web). It lives ALONGSIDE the
 * existing `src/client` console — this entry does not touch it.
 *
 * Order matters (mirrors the desktop entry packages/renderer/src/index.ts):
 * side-effect-import the moss adapter FIRST so `bridge.adapter` is wired before
 * the renderer's eager module-level ipcBridge calls run. `useAppMode` primes the
 * app mode via a module-level `ConfigStorage` ipcBridge call at import time, and
 * ES import hoisting means the transport must be live before `mountApp` (and the
 * modules it pulls in) execute.
 */

import '../bridgeAdapter/mossAdapter'
import { mountApp } from '@sudowork/renderer/bootstrap/mount'

mountApp()
