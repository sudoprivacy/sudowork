/**
 * IPC bridge for Assistant Hub — mirrors skillHubBridge pattern.
 * All operations delegate to the AssistantManager singleton.
 */

import { ipcBridge } from '@/common';
import { assistantManager } from '@/process/AssistantManager';
import { mainLog, mainError } from '@process/utils/mainLogger';

export function initAssistantHubBridge(): void {
  mainLog('AssistantHub', 'Initializing AssistantHub bridge...');

  ipcBridge.assistantHub.getInstalledAssistants.provider(async () => {
    try {
      const assistants = await assistantManager.getInstalledAssistants();
      return { success: true, data: assistants };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get installed assistants:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.enableAssistant.provider(async ({ name }) => {
    const result = await assistantManager.enableAssistant(name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.disableAssistant.provider(async ({ name }) => {
    const result = await assistantManager.disableAssistant(name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.updateAssistantMeta.provider(async ({ name, updates }) => {
    const result = await assistantManager.updateAssistantMeta(name, updates);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.getAssistantMeta.provider(async ({ name }) => {
    try {
      const meta = await assistantManager.getAssistantMeta(name);
      return { success: true, data: meta };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get assistant meta:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.createAssistant.provider(async ({ meta, ruleContent }) => {
    const result = await assistantManager.createAssistant(meta, ruleContent);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.uninstallAssistant.provider(async ({ name }) => {
    const result = await assistantManager.uninstallAssistant(name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });
}
