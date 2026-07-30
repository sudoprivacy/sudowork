/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chatLib';
import type { TChatConversation } from '@/common/storage';
import { isElectronDesktop } from '@/renderer/utils/platform';
import type { ExportZipFile } from '@/renderer/pages/conversation/grouped-history/types';
import { appendWorkspaceFilesToZip, buildConversationJson, buildConversationMarkdown, EXPORT_IO_TIMEOUT_MS, formatTimestamp, joinFilePath, sanitizeFileName, withTimeout } from '@/renderer/pages/conversation/grouped-history/utils/exportHelpers';
import type { TeamAssistant, TTeam } from '../types';
import { buildTeamFolderName, buildTeamManifestJson, buildTeamManifestMarkdown, buildTeamMemberConversationFolderName, type ITeamExportWarning } from '../utils/exportHelpers';
import { unwrapTeamResult } from '../utils';

export function useTeamExport() {
  const { t } = useTranslation();
  const [exportTeam, setExportTeam] = useState<TTeam | null>(null);
  const [exportTargetPath, setExportTargetPath] = useState('');
  const [isExportVisible, setIsExportVisible] = useState(false);
  const [isExportLoading, setIsExportLoading] = useState(false);
  const [isExportFinished, setIsExportFinished] = useState(false);
  const [isDirectorySelectorVisible, setIsDirectorySelectorVisible] = useState(false);
  const [currentExportRequestId, setCurrentExportRequestId] = useState<string | null>(null);
  const isExportCanceledRef = useRef(false);

  const fileExists = useCallback(async (filePath: string): Promise<boolean> => {
    try {
      await withTimeout(ipcBridge.fs.getFileMetadata.invoke({ path: filePath }), EXPORT_IO_TIMEOUT_MS, `getFileMetadata:${filePath}`);
      return true;
    } catch {
      return false;
    }
  }, []);

  const createUniqueFilePath = useCallback(
    async (directory: string, fileNameWithoutExt: string, ext: 'zip') => {
      const safeBaseName = sanitizeFileName(fileNameWithoutExt);
      const candidate = joinFilePath(directory, `${safeBaseName}.${ext}`);
      if (!(await fileExists(candidate))) {
        return candidate;
      }

      for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
        const nextCandidate = joinFilePath(directory, `${safeBaseName}-${Date.now()}-${index}.${ext}`);
        if (!(await fileExists(nextCandidate))) {
          return nextCandidate;
        }
      }

      return candidate;
    },
    [fileExists]
  );

  const getDesktopPath = useCallback(async (): Promise<string> => {
    try {
      const desktopPath = await ipcBridge.application.getPath.invoke({ name: 'desktop' });
      return desktopPath || '';
    } catch {
      return '';
    }
  }, []);

  const onOpenExport = useCallback(
    async (team: TTeam) => {
      isExportCanceledRef.current = false;
      setExportTeam(team);
      setIsExportVisible(true);
      setIsExportFinished(false);
      const desktopPath = await getDesktopPath();
      setExportTargetPath(desktopPath);
    },
    [getDesktopPath]
  );

  const onCloseExport = useCallback(() => {
    if (isExportLoading) {
      isExportCanceledRef.current = true;
    }
    if (isExportLoading && currentExportRequestId) {
      void ipcBridge.fs.cancelZip.invoke({ requestId: currentExportRequestId });
    }
    setIsExportVisible(false);
    setExportTeam(null);
    setExportTargetPath('');
    setIsExportLoading(false);
    setIsExportFinished(false);
    setCurrentExportRequestId(null);
  }, [currentExportRequestId, isExportLoading]);

  const onSelectExportDirectoryFromModal = useCallback((paths: string[] | undefined) => {
    setIsDirectorySelectorVisible(false);
    if (paths && paths.length > 0) {
      setExportTargetPath(paths[0]);
    }
  }, []);

  const onSelectExportFolder = useCallback(async () => {
    if (isExportLoading) return;

    if (!isElectronDesktop()) {
      setIsDirectorySelectorVisible(true);
      return;
    }

    try {
      const desktopPath = exportTargetPath || (await getDesktopPath());
      const res = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openDirectory'],
        defaultPath: desktopPath || undefined,
      });
      if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
        setExportTargetPath(res.data.filePaths[0]);
      }
    } catch (error) {
      console.error('[TeamExport] Failed to open export directory dialog:', error);
      Message.error(t('team.export.failed'));
    }
  }, [exportTargetPath, getDesktopPath, isExportLoading, t]);

  const fetchConversation = useCallback(async (conversationId: string): Promise<TChatConversation | null> => {
    try {
      return unwrapTeamResult(await withTimeout(ipcBridge.conversation.get.invoke({ id: conversationId }), EXPORT_IO_TIMEOUT_MS, `getConversation:${conversationId}`)) ?? null;
    } catch (error) {
      console.warn('[TeamExport] Failed to load conversation:', conversationId, error);
      return null;
    }
  }, []);

  const fetchConversationMessages = useCallback(async (conversationId: string): Promise<TMessage[] | null> => {
    try {
      return await withTimeout(ipcBridge.database.getConversationMessages.invoke({ conversation_id: conversationId, page: 0, pageSize: 10000 }), EXPORT_IO_TIMEOUT_MS, `getConversationMessages:${conversationId}`);
    } catch (error) {
      console.warn('[TeamExport] Failed to load messages:', conversationId, error);
      return null;
    }
  }, []);

  const fetchTeamWorkspaceTree = useCallback(async (team: TTeam, leaderConversationId: string | null, warnings: ITeamExportWarning[]) => {
    if (!team.workspace || !leaderConversationId) return undefined;

    try {
      const trees = await withTimeout(
        ipcBridge.conversation.getWorkspace.invoke({
          conversation_id: leaderConversationId,
          workspace: team.workspace,
          path: team.workspace,
        }),
        EXPORT_IO_TIMEOUT_MS,
        `getTeamWorkspace:${team.id}`
      );
      return trees?.[0];
    } catch (error) {
      console.warn('[TeamExport] Failed to read workspace:', team.id, error);
      warnings.push({ conversationId: leaderConversationId, reason: 'workspace_load_failed' });
      return undefined;
    }
  }, []);

  const buildMemberConversationFiles = useCallback(
    async (teamFolderName: string, member: TeamAssistant, warnings: ITeamExportWarning[]): Promise<ExportZipFile[]> => {
      if (!member.conversation_id) {
        warnings.push({ memberSlotId: member.slot_id, reason: 'missing_conversation_id' });
        return [];
      }
      const conversation = await fetchConversation(member.conversation_id);
      if (!conversation) {
        warnings.push({ memberSlotId: member.slot_id, conversationId: member.conversation_id, reason: 'conversation_load_failed' });
        return [];
      }
      const messages = await fetchConversationMessages(conversation.id);
      if (!messages) {
        warnings.push({ memberSlotId: member.slot_id, conversationId: conversation.id, reason: 'messages_load_failed' });
        return [];
      }
      const memberFolder = buildTeamMemberConversationFolderName(teamFolderName, member, conversation.id);
      return [
        {
          name: `${memberFolder}/conversation.json`,
          content: buildConversationJson(conversation, messages),
        },
        {
          name: `${memberFolder}/conversation.md`,
          content: buildConversationMarkdown(conversation, messages),
        },
      ];
    },
    [fetchConversation, fetchConversationMessages]
  );

  const buildTeamExportFiles = useCallback(
    async (team: TTeam): Promise<ExportZipFile[]> => {
      const warnings: ITeamExportWarning[] = [];
      const teamFolderName = buildTeamFolderName(team);
      const conversationFiles: ExportZipFile[] = [];

      for (const member of team.assistants) {
        const memberFiles = await buildMemberConversationFiles(teamFolderName, member, warnings);
        conversationFiles.push(...memberFiles);
      }

      const leaderConversationId = team.assistants.find((member) => member.role === 'leader')?.conversation_id ?? null;
      const workspaceTree = await fetchTeamWorkspaceTree(team, leaderConversationId, warnings);
      const files: ExportZipFile[] = [
        {
          name: `${teamFolderName}/team.json`,
          content: buildTeamManifestJson(team, warnings),
        },
        {
          name: `${teamFolderName}/team.md`,
          content: buildTeamManifestMarkdown(team, warnings),
        },
        ...conversationFiles,
      ];
      appendWorkspaceFilesToZip(files, workspaceTree, teamFolderName);
      return files;
    },
    [buildMemberConversationFiles, fetchTeamWorkspaceTree]
  );

  const runCreateZip = useCallback(async (path: string, files: ExportZipFile[], requestId: string): Promise<boolean> => {
    try {
      return await withTimeout(ipcBridge.fs.createZip.invoke({ path, files, requestId }), EXPORT_IO_TIMEOUT_MS * 8, `createZip:${requestId}`);
    } catch (error) {
      void ipcBridge.fs.cancelZip.invoke({ requestId });
      throw error;
    }
  }, []);

  const onConfirmExport = useCallback(async () => {
    if (!exportTeam) return;

    const directory = exportTargetPath.trim();
    if (!directory) {
      Message.warning(t('team.export.selectFolder'));
      return;
    }

    setIsExportLoading(true);
    isExportCanceledRef.current = false;
    const requestId = `team-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCurrentExportRequestId(requestId);

    const throwIfCanceled = () => {
      if (isExportCanceledRef.current) {
        throw new Error('export canceled');
      }
    };

    try {
      throwIfCanceled();
      const exportPath = await createUniqueFilePath(directory, `${sanitizeFileName(exportTeam.name || exportTeam.id).slice(0, 40)}-team-${formatTimestamp()}`, 'zip');
      throwIfCanceled();
      const files = await buildTeamExportFiles(exportTeam);
      throwIfCanceled();
      const success = await runCreateZip(exportPath, files, requestId);
      throwIfCanceled();

      if (success) {
        Message.success(t('team.export.success'));
        setIsExportFinished(true);
      } else {
        Message.error(t('team.export.failed'));
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('canceled')) {
        Message.warning(t('team.export.canceled'));
      } else {
        console.error('[TeamExport] Failed to export team:', error);
        Message.error(t('team.export.failed'));
      }
    } finally {
      setIsExportLoading(false);
      setCurrentExportRequestId(null);
      isExportCanceledRef.current = false;
    }
  }, [buildTeamExportFiles, createUniqueFilePath, exportTargetPath, exportTeam, runCreateZip, t]);

  return {
    exportTeam,
    exportTargetPath,
    isExportVisible,
    isExportLoading,
    isExportFinished,
    isDirectorySelectorVisible,
    setIsDirectorySelectorVisible,
    onOpenExport,
    onCloseExport,
    onSelectExportFolder,
    onSelectExportDirectoryFromModal,
    onConfirmExport,
  };
}
