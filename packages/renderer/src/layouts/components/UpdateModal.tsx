/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Progress, Message } from '@arco-design/web-react';
import { IconDownload, IconRefresh } from '@arco-design/web-react/icon';
import { CircleCheck, CircleX, Download, FolderOpen, HardDriveDownload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { UpdateDownloadProgressEvent, UpdateReleaseInfo, AutoUpdateStatus } from '@sudowork/common/updateTypes';
import { isNightlyBuild, buildVersion } from '@sudowork/common/buildInfo';
import MarkdownView from '@renderer/components/Markdown';

type UpdateStatus = 'checking' | 'upToDate' | 'available' | 'downloading' | 'downloaded' | 'success' | 'error';

type UpdateInfo = UpdateReleaseInfo;

function UpdateModal() {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ percent: 0, speed: '', total: 0, transferred: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [releasePageUrl, setReleasePageUrl] = useState('');
  const [autoUpdateInfo, setAutoUpdateInfo] = useState<{ version: string; releaseNotes?: string } | null>(null);
  const [autoUpdateDownloadedPath, setAutoUpdateDownloadedPath] = useState<string | null>(null);
  const updateVersionRef = React.useRef<string | null>(null);
  const releaseRequestRef = React.useRef(0);

  const resetState = () => {
    updateVersionRef.current = null;
    releaseRequestRef.current += 1;
    setStatus('checking');
    setUpdateInfo(null);
    setCurrentVersion('');
    setDownloadId(null);
    setProgress({ percent: 0, speed: '', total: 0, transferred: 0 });
    setErrorMsg('');
    setDownloadPath('');
    setReleasePageUrl('');
    setAutoUpdateInfo(null);
    setAutoUpdateDownloadedPath(null);
  };

  const includePrerelease = localStorage.getItem('update.includePrerelease') === 'true';
  const isAutoUpdateAvailable = !isNightlyBuild && Boolean(autoUpdateInfo);
  const isManualDownloadAvailable = Boolean(updateInfo?.recommendedAsset) && (!autoUpdateInfo || updateInfo?.version === autoUpdateInfo.version);
  const isPlatformUnsupported = !isAutoUpdateAvailable && updateInfo !== null && !isManualDownloadAvailable;

  const loadReleaseDetails = useCallback(
    async (expectedVersion?: string) => {
      const request = ++releaseRequestRef.current;
      const res = await ipcBridge.update.check.invoke({ includePrerelease: isNightlyBuild || includePrerelease });
      if (request !== releaseRequestRef.current) return undefined;
      if (!res?.success || !res.data) throw new Error(res?.msg || t('update.checkFailed'));
      setCurrentVersion(res.data.currentVersion);
      // Release notes and manual installers are optional enrichment for an
      // already validated updater feed. Never mix assets from another release.
      if (expectedVersion && res.data.latest?.version !== expectedVersion) return undefined;
      setUpdateInfo(res.data.latest || null);
      setReleasePageUrl(res.data.latest?.htmlUrl || '');
      return res.data;
    },
    [includePrerelease, t]
  );

  const onAutoUpdateAvailable = useCallback(
    (info: { version: string; releaseNotes?: string }) => {
      const isSameVersion = updateVersionRef.current === info.version;
      setAutoUpdateInfo(info);
      setIsVisible(true);
      setStatus((previous) => (isSameVersion && (previous === 'downloading' || previous === 'downloaded') ? previous : 'available'));
      if (isSameVersion) return;
      updateVersionRef.current = info.version;
      setUpdateInfo(null);
      setReleasePageUrl('');
      setErrorMsg('');
      setAutoUpdateDownloadedPath(null);
      // Startup events and explicit checks share the same candidate. A slow
      // or failed release-details request must not block the native updater.
      void loadReleaseDetails(info.version).catch((error) => console.warn('Failed to load optional update details:', error));
    },
    [loadReleaseDetails]
  );

  const onOpenReleasePage = () => {
    if (!releasePageUrl) return;
    void ipcBridge.shell.openExternal.invoke(releasePageUrl).catch((error) => {
      console.error('Failed to open release page:', error);
    });
  };

  const onCheckForUpdates = async () => {
    resetState();
    try {
      if (!isNightlyBuild) {
        // A valid native feed is authoritative for platform compatibility.
        // Only fall back to manual installation when this channel fails.
        const res = await ipcBridge.autoUpdate.check.invoke({ includePrerelease }).catch(() => null);
        if (res?.success) {
          if (res.data?.updateInfo) onAutoUpdateAvailable(res.data.updateInfo);
          else setStatus('upToDate');
          return;
        }
      }
      setAutoUpdateInfo(null);
      const data = await loadReleaseDetails();
      if (data) setStatus(data.updateAvailable && data.latest ? 'available' : 'upToDate');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Update check failed:', err);
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const onStartAutoDownload = async () => {
    if (!isAutoUpdateAvailable) return;
    setStatus('downloading');
    try {
      const res = await ipcBridge.autoUpdate.download.invoke();
      if (!res?.success) {
        throw new Error(res?.msg || t('update.downloadStartFailed'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Download failed:', err);
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const onStartManualDownload = async () => {
    if (!isManualDownloadAvailable || !updateInfo) return;
    const asset = updateInfo.recommendedAsset;
    if (!asset) {
      setErrorMsg(t('update.noCompatibleAssetManual'));
      return;
    }

    setStatus('downloading');
    try {
      const res = await ipcBridge.update.download.invoke({
        url: asset.url,
        fileName: asset.name,
        sha512: asset.sha512,
      });
      if (!res?.success || !res.data) {
        throw new Error(res?.msg || t('update.downloadStartFailed'));
      }

      // If cached, show success immediately
      if (res.data.downloadId === 'cached') {
        setDownloadPath(res.data.filePath);
        setStatus('success');
        return;
      }

      setDownloadId(res.data.downloadId);
      setDownloadPath(res.data.filePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Manual download failed:', err);
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const onQuitAndInstall = async () => {
    try {
      await ipcBridge.autoUpdate.quitAndInstall.invoke();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Install failed:', err);
      Message.error(msg);
    }
  };

  const formatSpeed = (bytesPerSecond: number) => {
    if (bytesPerSecond > 1024 * 1024) {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  };

  const formatSize = (bytes: number) => {
    if (bytes > 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const onCheckForUpdatesRef = React.useRef(onCheckForUpdates);
  onCheckForUpdatesRef.current = onCheckForUpdates;

  const onOpenUpdateModal = useCallback(() => {
    setIsVisible(true);
    void onCheckForUpdatesRef.current();
  }, []);

  useEffect(() => {
    const removeOpenListener = ipcBridge.update.open.on(onOpenUpdateModal);
    window.addEventListener('sudowork-open-update-modal', onOpenUpdateModal);

    return () => {
      removeOpenListener();
      window.removeEventListener('sudowork-open-update-modal', onOpenUpdateModal);
    };
  }, [onOpenUpdateModal]);

  // 监听自动更新状态
  useEffect(() => {
    let isActive = true;
    let isLiveStatusReceived = false;
    const onStatus = (evt: AutoUpdateStatus) => {
      if (!evt) return;

      switch (evt.status) {
        case 'checking':
          break;
        case 'available':
          if (evt.version && !isNightlyBuild) onAutoUpdateAvailable({ version: evt.version, releaseNotes: evt.releaseNotes });
          break;
        case 'not-available':
          setStatus('upToDate');
          break;
        case 'downloading':
          setStatus('downloading');
          if (evt.progress) {
            setProgress({
              percent: Math.round(evt.progress.percent),
              speed: formatSpeed(evt.progress.bytesPerSecond),
              total: evt.progress.total,
              transferred: evt.progress.transferred,
            });
          }
          break;
        case 'downloaded':
          setStatus('downloaded');
          if (evt.downloadedFilePath) {
            setAutoUpdateDownloadedPath(evt.downloadedFilePath);
          }
          break;
        case 'error':
          setStatus('error');
          setErrorMsg(evt.error || t('update.downloadFailed'));
          break;
      }
    };
    const removeListener = ipcBridge.autoUpdate.status.on((evt) => {
      isLiveStatusReceived = true;
      onStatus(evt);
    });
    void ipcBridge.autoUpdate.getStatus
      .invoke()
      .then((res) => {
        if (!isActive || isLiveStatusReceived || !res?.success || !res.data) return;
        onStatus(res.data);
        if (res.data.status === 'downloading' || res.data.status === 'downloaded') setIsVisible(true);
      })
      .catch((error) => console.warn('Failed to restore update status:', error));

    return () => {
      isActive = false;
      removeListener();
    };
  }, [onAutoUpdateAvailable, t]);

  useEffect(() => {
    const removeProgressListener = ipcBridge.update.downloadProgress.on((evt: UpdateDownloadProgressEvent) => {
      if (!evt) return;
      if (!downloadId || evt.downloadId !== downloadId) return;

      setProgress({
        percent: Math.round(evt.percent ?? 0),
        speed: formatSpeed(evt.bytesPerSecond ?? 0),
        total: evt.totalBytes ?? 0,
        transferred: evt.receivedBytes ?? 0,
      });

      if (evt.status === 'completed') {
        setStatus('success');
        if (evt.filePath) {
          setDownloadPath(evt.filePath);
        }
      } else if (evt.status === 'error' || evt.status === 'cancelled') {
        setStatus('error');
        setErrorMsg(evt.error || t('update.downloadFailed'));
      }
    });

    return () => {
      removeProgressListener();
    };
  }, [downloadId, t]);

  // 下载过程中不允许关闭弹窗（只能通过关闭按钮关闭）
  // Prevent accidental dismissal during active download
  const isDownloading = status === 'downloading';

  const onClose = () => {
    setIsVisible(false);
  };

  const onOpenFile = () => {
    if (!downloadPath) return;
    void ipcBridge.shell.openFile.invoke(downloadPath).catch((error) => {
      console.error('Failed to open file:', error);
    });
  };

  const onShowInFolder = () => {
    const pathToShow = downloadPath || autoUpdateDownloadedPath;
    if (!pathToShow) return;
    void ipcBridge.shell.showItemInFolder.invoke(pathToShow).catch((error) => {
      console.error('Failed to show item in folder:', error);
    });
  };

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className='flex flex-col items-center justify-center py-12'>
            <div className='size-12 mb-5 relative'>
              <div className='absolute inset-0 border-[3px] border-fill-3 rounded-full' />
              <div className='absolute inset-0 border-[3px] border-primary border-t-transparent rounded-full animate-spin' />
            </div>
            <div className='text-15px text-foreground font-500'>{t('update.checking')}</div>
          </div>
        );

      case 'upToDate':
        return (
          <div className='flex flex-col items-center justify-center py-8'>
            <CircleCheck size={48} color='#16a34a' className='mb-5' />
            <div className='text-16px text-foreground font-600 mb-2'>{t('update.upToDateTitle')}</div>
            <div className='text-13px text-secondary'>{t('update.currentVersion', { version: buildVersion || currentVersion || '-' })}</div>
          </div>
        );

      case 'available':
        return (
          <div className='flex flex-col h-full'>
            {/* 版本信息头部 / Version info header */}
            <div className='flex items-center justify-between px-6 py-4 border-b bg-fill-1'>
              <div className='flex items-center gap-3'>
                <div className='size-10 bg-[rgb(var(--primary-6))]/12 rounded-10px f-center'>
                  <Download size={20} color='rgb(var(--primary-6))' />
                </div>
                <div>
                  <div className='text-15px font-600 text-foreground'>{t('update.availableTitle')}</div>
                  <div className='text-12px text-tertiary mt-0.5'>
                    {buildVersion || currentVersion} → <span className='text-[rgb(var(--primary-6))] font-500'>{autoUpdateInfo?.version || updateInfo?.version}</span>
                  </div>
                </div>
              </div>
              <div className='flex items-center gap-2'>
                {isPlatformUnsupported && releasePageUrl ? (
                  <Button type='primary' size='small' onClick={onOpenReleasePage} className='!px-4'>
                    {t('update.goToRelease')}
                  </Button>
                ) : (
                  <>
                    {isManualDownloadAvailable && (
                      <Button size='small' onClick={onStartManualDownload} icon={<IconDownload style={{ fontSize: 14 }} />} className='!px-3'>
                        {t('update.downloadButton')}
                      </Button>
                    )}
                    {isAutoUpdateAvailable && (
                      <Button type='primary' size='small' onClick={onStartAutoDownload} icon={<HardDriveDownload size={14} />} className='!px-3'>
                        {t('update.downloadAndInstall')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Nightly build notice */}
            {isNightlyBuild && <div className='mx-6 mt-3 px-3 py-2.5 text-12px rounded-8px bg-orange-1 text-orange-6 dark:bg-orange-9/20'>{t('update.nightlyUpdateNotice', { defaultValue: 'This is a nightly build. Only manual download is supported for nightly updates.' })}</div>}

            {isPlatformUnsupported && <div className='mx-6 mt-3 px-3 py-2.5 text-12px rounded-8px bg-warning-soft text-warning'>{t('update.noCompatibleAssetManual')}</div>}

            {/* 更新日志内容 / Release notes content */}
            <div className='flex-1 min-h-0 overflow-y-auto px-6 py-4 custom-scrollbar'>
              {updateInfo?.name && <div className='text-14px font-500 text-foreground mb-3'>{updateInfo.name}</div>}
              {updateInfo?.body || autoUpdateInfo?.releaseNotes ? (
                <div className='text-13px text-secondary leading-relaxed'>
                  <MarkdownView allowHtml>{updateInfo?.body || autoUpdateInfo?.releaseNotes || ''}</MarkdownView>
                </div>
              ) : (
                <div className='text-13px text-tertiary italic'>{t('update.noReleaseNotes')}</div>
              )}
            </div>
          </div>
        );

      case 'downloading':
        return (
          <div className='flex flex-col items-center justify-center py-12 px-8'>
            <div className='size-14 bg-[rgb(var(--primary-6))]/12 rounded-full f-center mb-5'>
              <Download size={24} color='rgb(var(--primary-6))' className='animate-bounce' />
            </div>
            <div className='text-16px text-foreground font-600 mb-5'>{t('update.downloadingTitle')}</div>
            <div className='w-full max-w-80'>
              <Progress percent={progress.percent} status='normal' showText={false} strokeWidth={6} className='!mb-3' />
              <div className='flex justify-between text-12px text-tertiary'>
                <span>
                  {formatSize(progress.transferred)} / {formatSize(progress.total)}
                </span>
                <span className='text-[rgb(var(--primary-6))] font-500'>{progress.speed}</span>
              </div>
            </div>
          </div>
        );

      case 'downloaded':
        return (
          <div className='flex flex-col items-center justify-center py-12 px-8'>
            <div className='size-14 bg-success-soft rounded-full f-center mb-5'>
              <CircleCheck size={28} style={{ color: 'var(--success)' }} />
            </div>
            <div className='text-16px text-foreground font-600 mb-2'>{t('update.readyToInstall')}</div>
            <div className='text-13px text-tertiary mb-6 text-center max-w-90'>{t('update.readyToInstallDesc')}</div>
            <div className='flex gap-3'>
              <Button size='small' onClick={onShowInFolder} icon={<FolderOpen size={14} />} className='!px-4'>
                {t('update.showInFolder')}
              </Button>
              <Button type='primary' size='small' onClick={onQuitAndInstall} icon={<HardDriveDownload size={14} />} className='!px-4'>
                {t('update.installNow')}
              </Button>
            </div>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center justify-center py-12 px-8'>
            <div className='size-14 bg-success-soft rounded-full f-center mb-5'>
              <CircleCheck size={28} style={{ color: 'var(--success)' }} />
            </div>
            <div className='text-16px text-foreground font-600 mb-2'>{t('update.downloadCompleteTitle')}</div>
            <div className='text-12px text-tertiary mb-6 text-center max-w-90 break-all line-clamp-2'>{downloadPath}</div>
            <div className='flex gap-3'>
              <Button size='small' onClick={onShowInFolder} icon={<FolderOpen size={14} />} className='!px-4'>
                {t('update.showInFolder')}
              </Button>
              <Button type='primary' size='small' onClick={onOpenFile} className='!px-4'>
                {t('update.openFile')}
              </Button>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className='flex flex-col items-center justify-center py-12 px-8'>
            <div className='size-14 bg-danger-soft rounded-full f-center mb-5'>
              <CircleX size={28} style={{ color: 'var(--danger)' }} />
            </div>
            <div className='text-16px text-foreground font-600 mb-2'>{t('update.errorTitle')}</div>
            <div className='text-13px text-tertiary mb-6 text-center max-w-90'>{errorMsg}</div>
            <div className='flex gap-3'>
              <Button size='small' onClick={onCheckForUpdates} icon={<IconRefresh style={{ fontSize: 14 }} />} className='!px-4'>
                {t('common.retry')}
              </Button>
              {releasePageUrl && (
                <Button type='primary' size='small' onClick={onOpenReleasePage} className='!px-4'>
                  {t('update.goToRelease')}
                </Button>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <Modal visible={isVisible} onCancel={onClose} maskClosable={!isDownloading} escToExit={!isDownloading} title={t('update.modalTitle')} footer={null} style={{ width: status === 'available' ? 600 : 480 }}>
      <div className='flex flex-col h-full w-full'>{renderContent()}</div>
    </Modal>
  );
}

export default UpdateModal;
