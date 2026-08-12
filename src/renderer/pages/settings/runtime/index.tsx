/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { nexus as nexusIpc, libreOffice as libreOfficeIpc, pythonRuntime as pythonRuntimeIpc, scode as scodeIpc, nodeRuntime as nodeRuntimeIpc, shareoneCli, localKnowledgeBase as localKnowledgeBaseIpc, popplerRuntime as popplerRuntimeIpc } from '@/common/ipcBridge';
import type { ICliStatus, ILibreOfficeInstallPhase, IPopplerInstallPhase, IPythonInstallPhase, NexusInstallPhase } from '@/common/ipcBridge';
import { IS_SHAREONE_DISABLED } from '@/common/buildMode';
import type { LocalKbInstallPhase } from '@/common/types/localKnowledgeBase';
import PageWrapper from '@renderer/components/base/PageWrapper';
import RuntimeToolRow from './components/RuntimeToolRow';
import type { LoadState, ToolRow } from './types';

type RefreshOptions = {
  silent?: boolean;
};

export default function RuntimeSettings() {
  const { t } = useTranslation();

  const [nodeStatus, setNodeStatus] = useState<ICliStatus | null>(null);
  const [nodeLoad, setNodeLoad] = useState<LoadState>('idle');

  const [nexusPort, setNexusPort] = useState<number | undefined>(undefined);
  const [nexusRunning, setNexusRunning] = useState<boolean>(false);
  const [nexusInstalled, setNexusInstalled] = useState<boolean>(false);
  const [nexusStatusResolved, setNexusStatusResolved] = useState<boolean>(false);
  const [nexusLoad, setNexusLoad] = useState<LoadState>('idle');
  const [nexusPhase, setNexusPhase] = useState<NexusInstallPhase | undefined>(undefined);
  const [nexusPercent, setNexusPercent] = useState<number | undefined>(undefined);

  const [libreOfficeStatus, setLibreOfficeStatus] = useState<ICliStatus | null>(null);
  const [libreOfficeLoad, setLibreOfficeLoad] = useState<LoadState>('idle');
  const [libreOfficePhase, setLibreOfficePhase] = useState<ILibreOfficeInstallPhase | undefined>(undefined);
  const [libreOfficePercent, setLibreOfficePercent] = useState<number | undefined>(undefined);

  const [pythonStatus, setPythonStatus] = useState<ICliStatus | null>(null);
  const [pythonLoad, setPythonLoad] = useState<LoadState>('idle');
  const [pythonPhase, setPythonPhase] = useState<IPythonInstallPhase | undefined>(undefined);
  const [pythonPercent, setPythonPercent] = useState<number | undefined>(undefined);

  const [popplerStatus, setPopplerStatus] = useState<ICliStatus | null>(null);
  const [popplerLoad, setPopplerLoad] = useState<LoadState>('idle');
  const [popplerPhase, setPopplerPhase] = useState<IPopplerInstallPhase | undefined>(undefined);
  const [popplerPercent, setPopplerPercent] = useState<number | undefined>(undefined);

  const [scodeStatus, setScodeStatus] = useState<ICliStatus | null>(null);
  const [scodeLoad, setScodeLoad] = useState<LoadState>('idle');

  const [shareoneStatus, setShareoneStatus] = useState<ICliStatus | null>(null);
  const [shareoneLoad, setShareoneLoad] = useState<LoadState>('idle');

  const [embeddingStatus, setEmbeddingStatus] = useState<ICliStatus | null>(null);
  const [embeddingLoad, setEmbeddingLoad] = useState<LoadState>('idle');
  const [embeddingPhase, setEmbeddingPhase] = useState<LocalKbInstallPhase | undefined>(undefined);
  const [embeddingPercent, setEmbeddingPercent] = useState<number | undefined>(undefined);

  const [nexusVersion, setNexusVersion] = useState<string | undefined>(undefined);

  const refreshNode = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setNodeLoad('loading');
    }
    try {
      const res = await nodeRuntimeIpc.checkInstalled.invoke();
      if (res?.success && res.data) {
        setNodeStatus(res.data);
      } else {
        setNodeStatus({ installed: false, source: 'managed' });
      }
    } catch {
      setNodeStatus({ installed: false, source: 'managed' });
    } finally {
      if (!options?.silent) {
        setNodeLoad('idle');
      }
    }
  }, []);

  const installNode = useCallback(async () => {
    setNodeLoad('installing');
    try {
      const res = await nodeRuntimeIpc.install.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Node.js' }));
        await refreshNode();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Node.js' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Node.js' }));
    } finally {
      setNodeLoad('idle');
    }
  }, [refreshNode, t]);

  const uninstallNode = useCallback(async () => {
    setNodeLoad('loading');
    try {
      const res = await nodeRuntimeIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Node.js' }));
        await refreshNode();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Node.js' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Node.js' }));
    } finally {
      setNodeLoad('idle');
    }
  }, [refreshNode, t]);

  const refreshLibreOffice = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setLibreOfficeLoad('loading');
    }
    try {
      const res = await libreOfficeIpc.checkInstalled.invoke();
      if (res?.success && res.data) setLibreOfficeStatus(res.data);
    } finally {
      if (!options?.silent) {
        setLibreOfficeLoad('idle');
      }
    }
  }, []);

  const installLibreOffice = useCallback(async () => {
    setLibreOfficeLoad('installing');
    try {
      const res = await libreOfficeIpc.install.invoke();
      if (res?.success) {
        await refreshLibreOffice();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'LibreOffice' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
    } finally {
      setLibreOfficeLoad('idle');
      setLibreOfficePhase(undefined);
      setLibreOfficePercent(undefined);
    }
  }, [refreshLibreOffice, t]);

  const uninstallLibreOffice = useCallback(async () => {
    setLibreOfficeLoad('loading');
    try {
      const res = await libreOfficeIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'LibreOffice' }));
        await refreshLibreOffice();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'LibreOffice' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'LibreOffice' }));
    } finally {
      setLibreOfficeLoad('idle');
    }
  }, [refreshLibreOffice, t]);

  const refreshPython = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setPythonLoad('loading');
    }
    try {
      const res = await pythonRuntimeIpc.checkInstalled.invoke();
      if (res?.success && res.data) setPythonStatus(res.data);
    } finally {
      if (!options?.silent) {
        setPythonLoad('idle');
      }
    }
  }, []);

  const installPython = useCallback(async () => {
    setPythonLoad('installing');
    try {
      const res = await pythonRuntimeIpc.install.invoke();
      if (res?.success) {
        await refreshPython();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Python' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Python' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Python' }));
    } finally {
      setPythonLoad('idle');
      setPythonPhase(undefined);
      setPythonPercent(undefined);
    }
  }, [refreshPython, t]);

  const uninstallPython = useCallback(async () => {
    setPythonLoad('loading');
    try {
      const res = await pythonRuntimeIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Python' }));
        await refreshPython();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Python' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Python' }));
    } finally {
      setPythonLoad('idle');
    }
  }, [refreshPython, t]);

  const refreshPoppler = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setPopplerLoad('loading');
    }
    try {
      const res = await popplerRuntimeIpc.checkInstalled.invoke();
      if (res?.success && res.data) {
        setPopplerStatus(res.data);
      } else {
        setPopplerStatus({ installed: false, source: 'none' });
      }
    } catch {
      setPopplerStatus({ installed: false, source: 'none' });
    } finally {
      if (!options?.silent) {
        setPopplerLoad('idle');
      }
    }
  }, []);

  const installPoppler = useCallback(async () => {
    setPopplerLoad('installing');
    setPopplerPhase(undefined);
    setPopplerPercent(undefined);
    try {
      const res = await popplerRuntimeIpc.install.invoke();
      if (res?.success) {
        await refreshPoppler();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Poppler' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Poppler' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Poppler' }));
    } finally {
      setPopplerLoad('idle');
      setPopplerPhase(undefined);
      setPopplerPercent(undefined);
    }
  }, [refreshPoppler, t]);

  const uninstallPoppler = useCallback(async () => {
    setPopplerLoad('loading');
    try {
      const res = await popplerRuntimeIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Poppler' }));
        await refreshPoppler();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Poppler' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Poppler' }));
    } finally {
      setPopplerLoad('idle');
    }
  }, [refreshPoppler, t]);

  const refreshScode = useCallback(async () => {
    try {
      const res = await scodeIpc.getStatus.invoke();
      if (res?.success && res.data) {
        const { installed, version } = res.data;
        setScodeStatus(installed ? { installed: true, source: 'managed', version } : { installed: false, source: 'none' });
      } else {
        setScodeStatus({ installed: false, source: 'none' });
      }
    } catch {
      setScodeStatus({ installed: false, source: 'none' });
    }
  }, []);

  const installScode = useCallback(async () => {
    setScodeLoad('installing');
    try {
      const res = await scodeIpc.install.invoke();
      if (res?.success) {
        await refreshScode();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Sudocode' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Sudocode' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Sudocode' }));
    } finally {
      setScodeLoad('idle');
    }
  }, [refreshScode, t]);

  const refreshShareone = useCallback(async () => {
    if (IS_SHAREONE_DISABLED) return;
    try {
      const res = await shareoneCli.checkInstalled.invoke();
      if (res?.success && res.data) {
        setShareoneStatus(res.data);
      } else {
        setShareoneStatus({ installed: false, source: 'none' });
      }
    } catch {
      setShareoneStatus({ installed: false, source: 'none' });
    }
  }, []);

  const installShareone = useCallback(async () => {
    setShareoneLoad('installing');
    try {
      const res = await shareoneCli.install.invoke();
      if (res?.success) {
        await refreshShareone();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'ShareOne' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'ShareOne' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'ShareOne' }));
    } finally {
      setShareoneLoad('idle');
    }
  }, [refreshShareone, t]);

  const refreshEmbedding = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setEmbeddingLoad('loading');
    }
    try {
      const res = await localKnowledgeBaseIpc.getDependencyStatus.invoke();
      if (res?.success && res.data) {
        setEmbeddingStatus({
          installed: res.data.embeddingModel.installed,
          path: res.data.embeddingModel.path,
          version: res.data.embeddingModel.modelId,
          source: res.data.embeddingModel.installed ? 'managed' : 'none',
        });
      } else {
        setEmbeddingStatus({ installed: false, source: 'none' });
      }
    } catch {
      setEmbeddingStatus({ installed: false, source: 'none' });
    } finally {
      if (!options?.silent) {
        setEmbeddingLoad('idle');
      }
    }
  }, []);

  const installEmbedding = useCallback(async () => {
    const embeddingModelName = t('settings.runtimeSettings.embeddingModelName');
    setEmbeddingLoad('installing');
    setEmbeddingPhase(undefined);
    setEmbeddingPercent(undefined);
    try {
      const res = await localKnowledgeBaseIpc.installEmbeddingModel.invoke(undefined);
      if (res?.success) {
        await refreshEmbedding();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: embeddingModelName }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: embeddingModelName }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: embeddingModelName }));
    } finally {
      setEmbeddingLoad('idle');
      setEmbeddingPhase(undefined);
      setEmbeddingPercent(undefined);
    }
  }, [refreshEmbedding, t]);

  const refreshNexus = useCallback(async () => {
    try {
      const res = await nexusIpc.getStatus.invoke();
      if (res?.success && res.data) {
        setNexusRunning(res.data.running);
        setNexusPort(res.data.port);
        setNexusInstalled(res.data.installed);
        setNexusVersion(res.data.version);
      } else {
        setNexusRunning(false);
        setNexusPort(undefined);
        setNexusInstalled(false);
        setNexusVersion(undefined);
      }
    } finally {
      setNexusStatusResolved(true);
    }
  }, []);

  const installNexus = useCallback(async () => {
    setNexusLoad('installing');
    setNexusPhase(undefined);
    setNexusPercent(undefined);
    try {
      const res = await nexusIpc.install.invoke();
      if (res?.success) {
        await refreshNexus();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Nexus' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
      setNexusPhase(undefined);
      setNexusPercent(undefined);
    }
  }, [refreshNexus, t]);

  const uninstallNexus = useCallback(async () => {
    setNexusLoad('loading');
    try {
      const res = await nexusIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Nexus' }));
        await refreshNexus();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
    }
  }, [refreshNexus, t]);

  const startNexus = useCallback(async () => {
    setNexusLoad('loading');
    try {
      const res = await nexusIpc.start.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.startSuccess', { name: 'Nexus' }));
        await new Promise((r) => setTimeout(r, 3000));
        await refreshNexus();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.startFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.startFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
    }
  }, [refreshNexus, t]);

  const refreshRuntimePage = useCallback(
    async (options?: RefreshOptions) => {
      await Promise.all([refreshNode(options), refreshScode(), refreshShareone(), refreshEmbedding(options), refreshNexus(), refreshLibreOffice(options), refreshPython(options), refreshPoppler(options)]);
    },
    [refreshEmbedding, refreshLibreOffice, refreshNexus, refreshNode, refreshPoppler, refreshPython, refreshScode, refreshShareone]
  );

  // Load all on mount; also restore install state if an install is already in progress
  useEffect(() => {
    void refreshRuntimePage();
    void libreOfficeIpc.getInstallState.invoke().then((res) => {
      if (res?.success && res.data?.installing) {
        setLibreOfficeLoad('installing');
        if (res.data.phase) setLibreOfficePhase(res.data.phase);
        if (res.data.percent != null) setLibreOfficePercent(res.data.percent);
      }
    });
    void pythonRuntimeIpc.getInstallState.invoke().then((res) => {
      if (res?.success && res.data?.installing) {
        setPythonLoad('installing');
        if (res.data.phase) setPythonPhase(res.data.phase);
        if (res.data.percent != null) setPythonPercent(res.data.percent);
      }
    });
    void popplerRuntimeIpc.getInstallState.invoke().then((res) => {
      if (res?.success && res.data?.installing) {
        setPopplerLoad('installing');
        if (res.data.phase) setPopplerPhase(res.data.phase);
        if (res.data.percent != null) setPopplerPercent(res.data.percent);
      }
    });
  }, [refreshRuntimePage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshRuntimePage({ silent: true });
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshRuntimePage]);

  // Auto-refresh when main process finishes a background install (e.g. first-launch prompt)
  useEffect(() => {
    const unsubNode = nodeRuntimeIpc.installResult.on(() => void refreshNode());
    const unsubScodeProgress = scodeIpc.installProgress.on(() => {
      setScodeLoad('installing');
    });
    const unsubScodeResult = scodeIpc.installResult.on(() => {
      setScodeLoad('idle');
      void refreshScode();
    });
    const unsubShareoneResult: () => void = IS_SHAREONE_DISABLED
      ? () => undefined
      : shareoneCli.installResult.on(() => {
          setShareoneLoad('idle');
          void refreshShareone();
        });
    const unsubEmbeddingProgress = localKnowledgeBaseIpc.installEmbeddingModelProgress.on(({ phase, percent }) => {
      setEmbeddingLoad('installing');
      setEmbeddingPhase(phase);
      if (percent != null) setEmbeddingPercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubEmbeddingResult = localKnowledgeBaseIpc.installEmbeddingModelResult.on((result) => {
      setEmbeddingLoad('idle');
      setEmbeddingPhase(undefined);
      setEmbeddingPercent(undefined);
      if (!result.success && result.msg) {
        Message.error(result.msg);
      }
      void refreshEmbedding();
    });
    const unsubNexusProgress = nexusIpc.installProgress.on(({ phase, percent }) => {
      setNexusPhase(phase);
      if (percent != null) setNexusPercent(percent);
    });
    const unsubNexusResult = nexusIpc.installResult.on(() => void refreshNexus());
    const unsubLoProgress = libreOfficeIpc.installProgress.on(({ phase, percent }) => {
      setLibreOfficePhase(phase);
      if (percent != null) setLibreOfficePercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubLoResult = libreOfficeIpc.installResult.on(() => void refreshLibreOffice());
    const unsubPyProgress = pythonRuntimeIpc.installProgress.on(({ phase, percent }) => {
      setPythonPhase(phase);
      if (percent != null) setPythonPercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubPyResult = pythonRuntimeIpc.installResult.on(() => void refreshPython());
    const unsubPopplerProgress = popplerRuntimeIpc.installProgress.on(({ phase, percent }) => {
      setPopplerLoad('installing');
      setPopplerPhase(phase);
      if (percent != null) setPopplerPercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubPopplerResult = popplerRuntimeIpc.installResult.on(() => {
      setPopplerLoad('idle');
      setPopplerPhase(undefined);
      setPopplerPercent(undefined);
      void refreshPoppler();
    });
    return () => {
      unsubNode();
      unsubScodeProgress();
      unsubScodeResult();
      unsubShareoneResult();
      unsubEmbeddingProgress();
      unsubEmbeddingResult();
      unsubNexusProgress();
      unsubNexusResult();
      unsubLoProgress();
      unsubLoResult();
      unsubPyProgress();
      unsubPyResult();
      unsubPopplerProgress();
      unsubPopplerResult();
    };
  }, [refreshNode, refreshNexus, refreshScode, refreshShareone, refreshEmbedding, refreshLibreOffice, refreshPython, refreshPoppler]);

  const tableData: ToolRow[] = [
    {
      key: 'node',
      displayName: 'Node.js',
      command: 'node',
      badge: 'NJ',
      status: nodeStatus,
      loadState: nodeLoad,
      onRefresh: refreshNode,
      onInstall: installNode,
      onUninstall: uninstallNode,
    },
    {
      key: 'libreoffice',
      displayName: 'LibreOffice',
      command: 'libreoffice',
      badge: 'LO',
      status: libreOfficeStatus,
      loadState: libreOfficeLoad,
      installPhase: libreOfficePhase,
      installPercent: libreOfficePercent,
      onRefresh: refreshLibreOffice,
      onInstall: installLibreOffice,
      onUninstall: uninstallLibreOffice,
    },
    {
      key: 'python',
      displayName: 'Python',
      command: 'python3',
      badge: 'PY',
      status: pythonStatus,
      loadState: pythonLoad,
      installPhase: pythonPhase,
      installPercent: pythonPercent,
      onRefresh: refreshPython,
      onInstall: installPython,
      onUninstall: uninstallPython,
    },
    {
      key: 'poppler',
      displayName: 'Poppler',
      command: 'pdftotext',
      badge: 'PP',
      status: popplerStatus,
      loadState: popplerLoad,
      installPhase: popplerPhase,
      installPercent: popplerPercent,
      onRefresh: refreshPoppler,
      onInstall: installPoppler,
      onUninstall: uninstallPoppler,
    },
    {
      key: 'sudocode',
      displayName: 'Sudo Code',
      command: 'scode',
      badge: 'SC',
      status: scodeStatus,
      loadState: scodeLoad,
      onRefresh: refreshScode,
      onInstall: scodeStatus?.installed ? undefined : installScode,
    },
    {
      key: 'shareone',
      displayName: 'ShareOne',
      command: 'shareone',
      badge: 'SO',
      status: shareoneStatus,
      loadState: shareoneLoad,
      onRefresh: refreshShareone,
      onInstall: shareoneStatus?.installed ? undefined : installShareone,
    },
    {
      key: 'embedding',
      displayName: t('settings.runtimeSettings.embeddingModelName', { defaultValue: 'Local KB Embedding Model' }),
      command: 'Xenova/multilingual-e5-small',
      badge: 'EM',
      status: embeddingStatus,
      loadState: embeddingLoad,
      installPhase: embeddingPhase,
      installPercent: embeddingPercent,
      onRefresh: refreshEmbedding,
      onInstall: embeddingStatus?.installed ? undefined : installEmbedding,
    },
    {
      key: 'nexus',
      displayName: 'Nexus Server',
      command: 'nexusd',
      badge: 'NX',
      status: nexusInstalled ? { installed: true, source: 'managed', version: nexusVersion } : null,
      statusResolved: nexusStatusResolved,
      nexusPort,
      nexusRunning,
      nexusInstalled,
      loadState: nexusLoad,
      installPhase: nexusPhase,
      installPercent: nexusPercent,
      onRefresh: refreshNexus,
      onInstall: installNexus,
      onUninstall: uninstallNexus,
      onStart: startNexus,
    },
  ];

  return (
    <PageWrapper title={t('settings.runtimeSettings.title')} subtitle={t('settings.runtimeSettings.description')}>
      <div className='flex flex-col h-full w-full'>
        <AionScrollArea className='flex-1 min-h-0 pb-4' disableOverflow>
          <div className='space-y-4'>
            <div className='bg-muted rd-16px border px-4 md:px-6 lg:px-7 py-4 md:py-4.5'>
              <div className='flex flex-col divide-y divide-light'>
                {tableData
                  .filter((record) => !IS_SHAREONE_DISABLED || record.key !== 'shareone')
                  .map((record) => (
                    <RuntimeToolRow key={record.key} record={record} />
                  ))}
              </div>
            </div>
          </div>
        </AionScrollArea>
      </div>
    </PageWrapper>
  );
}
