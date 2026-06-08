/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CliInstallService } from '../claudeCli/CliInstallService';
import { ipcBridge } from '@/common';

// Lark CLI is the official `@larksuite/cli` (Go binary + JS launcher).
// sudowork's role is install/uninstall only — auth (OAuth → OS keychain) and
// agent skills are managed by lark-cli itself.
const cli = new CliInstallService({
  name: 'lark-cli',
  npmPackage: '@larksuite/cli',
  ossName: 'lark-cli',
  declinedKey: 'larkCli.installDeclined',
  label: 'Lark CLI',
  useBundledNode: true,
  onProgress: (phase, percent) => {
    ipcBridge.larkCli.installProgress.emit({ phase, percent });
  },
});

export class LarkCliService {
  checkInstalled = () => cli.checkInstalled();

  install = () => cli.install();
}

export const larkCliService = new LarkCliService();
