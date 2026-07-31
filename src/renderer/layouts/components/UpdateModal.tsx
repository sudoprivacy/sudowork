/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Progress, Switch, Message } from '@arco-design/web-react';
import { IconDownload, IconRefresh } from '@arco-design/web-react/icon';
import { CircleCheck, CircleX, Download, FolderOpen, HardDriveDownload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import MarkdownView from '@/renderer/components/Markdown';
import type { UpdateDownloadProgressEvent, UpdateReleaseInfo, AutoUpdateStatus } from '@/common/updateTypes';
import { isNightlyBuild, buildVersion } from '@/common/buildInfo';

type UpdateStatus = 'checking' | 'upToDate' | 'available' | 'downloading' | 'downloaded' | 'success' | 'error';

type UpdateInfo = UpdateReleaseInfo;

const UpdateModal: React.FC = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ percent: 0, speed: '', total: 0, transferred: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [releasePageUrl, setReleasePageUrl] = useState('');
  const [useAutoUpdate, setUseAutoUpdate] = useState(true); // 默认使用自动更新
  const [autoUpdateInfo, setAutoUpdateInfo] = useState<{ version: string; releaseNotes?: string } | null>(null);
  const [autoUpdateDownloadedPath, setAutoUpdateDownloadedPath] = useState<string | null>(null);

  const resetState = () => {
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
  const hasCompatibleManualAsset = Boolean(updateInfo?.recommendedAsset);

  const openReleasePage = () => {
    if (!releasePageUrl) return;
    void ipcBridge.shell.openExternal.invoke(releasePageUrl).catch((error) => {
      console.error('Failed to open release page:', error);
    });
  };

  const checkForUpdates = async () => {
    setStatus('checking');
    try {
      // Nightly builds: skip electron-updater, only use manual GitHub release check
      if (isNightlyBuild) {
        setUseAutoUpdate(false);
        const res = await ipcBridge.update.check.invoke({ includePrerelease: true });
        if (!res?.success) {
          throw new Error(res?.msg || t('update.checkFailed'));
        }
        setCurrentVersion(res.data?.currentVersion || '');

        if (res.data?.updateAvailable && res.data.latest) {
          setUpdateInfo(res.data.latest);
          setReleasePageUrl(res.data.latest.htmlUrl || '');
          if (!res.data.latest.recommendedAsset) {
            setErrorMsg(t('update.noCompatibleAssetManual'));
          }
          setStatus('available');
          return;
        }

        setUpdateInfo(res.data?.latest || null);
        setReleasePageUrl(res.data?.latest?.htmlUrl || '');
        setStatus('upToDate');
        return;
      }

      // 优先使用自动更新模式
      if (useAutoUpdate) {
        const res = await ipcBridge.autoUpdate.check.invoke({ includePrerelease });
        if (res?.success && res.data?.updateInfo) {
          setAutoUpdateInfo({
            version: res.data.updateInfo.version,
            releaseNotes: res.data.updateInfo.releaseNotes,
          });
          // 获取当前版本和 markdown 格式的 release notes
          const manualRes = await ipcBridge.update.check.invoke({ includePrerelease });
          if (manualRes?.success) {
            setCurrentVersion(manualRes.data?.currentVersion || '');
            if (manualRes.data?.latest) {
              setUpdateInfo(manualRes.data.latest);
              setReleasePageUrl(manualRes.data.latest.htmlUrl || '');
              if (!manualRes.data.latest.recommendedAsset) {
                setUseAutoUpdate(false);
                setErrorMsg(t('update.noCompatibleAssetManual'));
              }
            }
          }
          // Check if already downloaded
          const cachedRes = await ipcBridge.autoUpdate.getDownloadedFilePath.invoke();
          if (cachedRes?.success && cachedRes.data?.path) {
            setAutoUpdateDownloadedPath(cachedRes.data.path);
          }
          setStatus('available');
          return;
        } else if (res?.msg) {
          // 自动更新失败，尝试手动更新
          console.warn('Auto-update check failed, falling back to manual mode:', res.msg);
        }
      }

      // 手动更新模式
      const res = await ipcBridge.update.check.invoke({ includePrerelease });
      if (!res?.success) {
        throw new Error(res?.msg || t('update.checkFailed'));
      }
      setCurrentVersion(res.data?.currentVersion || '');

      if (res.data?.updateAvailable && res.data.latest) {
        setUpdateInfo(res.data.latest);
        setReleasePageUrl(res.data.latest.htmlUrl || '');
        if (!res.data.latest.recommendedAsset) {
          setErrorMsg(t('update.noCompatibleAssetManual'));
        }
        setStatus('available');
        return;
      }

      setUpdateInfo(res.data?.latest || null);
      setReleasePageUrl(res.data?.latest?.htmlUrl || '');
      setStatus('upToDate');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Update check failed:', err);
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const startAutoDownload = async () => {
    if (!updateInfo && !autoUpdateInfo) return;
    setStatus('downloading');
    try {
      if (updateInfo && !updateInfo.recommendedAsset) {
        setUseAutoUpdate(false);
        throw new Error(t('update.noCompatibleAssetManual'));
      }
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

  const startManualDownload = async () => {
    if (!updateInfo) return;
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

  const quitAndInstall = async () => {
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

  const checkForUpdatesRef = React.useRef(checkForUpdates);
  checkForUpdatesRef.current = checkForUpdates;

  const handleOpenUpdateModal = useCallback(() => {
    setVisible(true);
    resetState();
    void checkForUpdatesRef.current();
  }, []);

  useEffect(() => {
    const removeOpenListener = ipcBridge.update.open.on(handleOpenUpdateModal);
    window.addEventListener('sudowork-open-update-modal', handleOpenUpdateModal);

    return () => {
      removeOpenListener();
      window.removeEventListener('sudowork-open-update-modal', handleOpenUpdateModal);
    };
  }, [handleOpenUpdateModal]);

  // 监听自动更新状态
  useEffect(() => {
    const removeListener = ipcBridge.autoUpdate.status.on((evt: AutoUpdateStatus) => {
      if (!evt) return;

      switch (evt.status) {
        case 'checking':
          break;
        case 'available':
          setAutoUpdateInfo({
            version: evt.version || '',
            releaseNotes: evt.releaseNotes,
          });
          setStatus('available');
          setVisible(true);
          break;
        case 'not-available':
          setStatus('upToDate');
          break;
        case 'downloading':
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
    });

    return () => {
      removeListener();
    };
  }, [t]);

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

  const handleClose = () => {
    setVisible(false);
  };

  const openFile = () => {
    if (!downloadPath) return;
    void ipcBridge.shell.openFile.invoke(downloadPath).catch((error) => {
      console.error('Failed to open file:', error);
    });
  };

  const showInFolder = () => {
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
                    {buildVersion || currentVersion} → <span className='text-[rgb(var(--primary-6))] font-500'>{updateInfo?.version || autoUpdateInfo?.version}</span>
                  </div>
                </div>
              </div>
              <div className='flex items-center gap-2'>
                {!hasCompatibleManualAsset && releasePageUrl ? (
                  <Button type='primary' size='small' onClick={openReleasePage} className='!px-4'>
                    {t('update.goToRelease')}
                  </Button>
                ) : (
                  <>
                    {/* Manual download button - always show when asset is available */}
                    <Button size='small' onClick={startManualDownload} icon={<IconDownload style={{ fontSize: 14 }} />} className='!px-3'>
                      {t('update.downloadButton')}
                    </Button>
                    {/* Auto-update button */}
                    {useAutoUpdate && (
                      <Button type='primary' size='small' onClick={startAutoDownload} icon={<HardDriveDownload size={14} />} className='!px-3'>
                        {t('update.downloadAndInstall')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 自动更新开关 / Auto update toggle (hidden for nightly builds) */}
            {!isNightlyBuild && (
              <div className='flex items-center justify-between px-6 py-3 bg-fill-1 border-b'>
                <div className='text-13px text-secondary'>{t('update.autoUpdateMode')}</div>
                <Switch checked={useAutoUpdate} onChange={setUseAutoUpdate} size='small' disabled={!hasCompatibleManualAsset} />
              </div>
            )}

            {/* Nightly build notice */}
            {isNightlyBuild && <div className='mx-6 mt-3 px-3 py-2.5 text-12px rounded-8px bg-secondary-brand text-brand'>{t('update.nightlyUpdateNotice', { defaultValue: 'This is a nightly build. Only manual download is supported for nightly updates.' })}</div>}

            {!hasCompatibleManualAsset && <div className='mx-6 mt-3 px-3 py-2.5 text-12px rounded-8px bg-warning-soft text-warning'>{t('update.noCompatibleAssetManual')}</div>}

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
              <Button size='small' onClick={showInFolder} icon={<FolderOpen size={14} />} className='!px-4'>
                {t('update.showInFolder')}
              </Button>
              <Button type='primary' size='small' onClick={quitAndInstall} icon={<HardDriveDownload size={14} />} className='!px-4'>
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
              <Button size='small' onClick={showInFolder} icon={<FolderOpen size={14} />} className='!px-4'>
                {t('update.showInFolder')}
              </Button>
              <Button type='primary' size='small' onClick={openFile} className='!px-4'>
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
              <Button size='small' onClick={checkForUpdates} icon={<IconRefresh style={{ fontSize: 14 }} />} className='!px-4'>
                {t('common.retry')}
              </Button>
              {releasePageUrl && (
                <Button type='primary' size='small' onClick={openReleasePage} className='!px-4'>
                  {t('update.goToRelease')}
                </Button>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <Modal visible={visible} onCancel={handleClose} maskClosable={!isDownloading} escToExit={!isDownloading} title={t('update.modalTitle')} footer={null} style={{ width: status === 'available' ? 600 : 480 }}>
      <div className='flex flex-col h-full w-full'>{renderContent()}</div>
    </Modal>
  );
};

export default UpdateModal;
