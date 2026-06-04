/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getChannelManager } from '@/channels';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { serviceManager } from '@process/services/serviceManager';
import { mcporterService } from '@process/services/mcporter';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function stopAllRuntimes(): Promise<void> {
  mainLog('ModeSwitch', 'Stopping channel manager and local runtimes');

  try {
    await getChannelManager().shutdown();
  } catch (error) {
    mainWarn('ModeSwitch', 'ChannelManager shutdown failed during mode switch:', error);
  }

  try {
    await serviceManager.shutdown();
  } finally {
    serviceManager.reset();
  }

  try {
    await mcporterService.stop();
  } catch (error) {
    mainWarn('ModeSwitch', 'mcporter stop failed during mode switch:', error);
  }

  await wait(500);
}

export async function startAllRuntimes(): Promise<void> {
  mainLog('ModeSwitch', 'Starting local runtimes and channel manager');
  serviceManager.reset();
  await serviceManager.startup();
  await getChannelManager().initialize();
}
