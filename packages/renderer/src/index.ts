/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

// Desktop entry. Order matters: the electron transport adapter is side-effect
// imported BEFORE the mount module so `bridge` is wired before any eager
// module-level ipcBridge call runs (useAppMode primes the app mode via
// ConfigStorage at import time). The web host has a parallel entry that imports
// a moss adapter module instead; the render itself (mountApp) is
// transport-agnostic and shared by both.
import './bootstrap/runtimePatches';
import './bootstrap/crashHandler';
import './bootstrap/devTriggers';
import './adapter/browser';
import { mountApp } from './bootstrap/mount';

mountApp();
