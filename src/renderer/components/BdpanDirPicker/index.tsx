import { Button, Input, Message, Modal, Spin } from '@arco-design/web-react';
import { FolderOpen, FolderPlus, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BdpanFileEntry } from '@/common/ipcBridge';
import { ipcBridge } from '@/common';

type Step = 'checking' | 'getting_auth_url' | 'enter_code' | 'submitting_code' | 'file_browser' | 'error';

interface Props {
  visible: boolean;
  /** The local absolute path being uploaded */
  localPath: string;
  onCancel: () => void;
  /** Called with the selected bdpan absolute directory path */
  onConfirm: (bdpanDirPath: string) => void;
}

/** Derive the common parent directory from a list of paths */
function deriveRoot(files: BdpanFileEntry[]): string {
  if (files.length === 0) return '/';
  const parentOf = (p: string) => {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  };
  const parents = files.map((f) => parentOf(f.path));
  const first = parents[0];
  return parents.every((p) => p === first) ? first : '/';
}

function buildBreadcrumbs(root: string, current: string): { label: string; path: string }[] {
  const segments: { label: string; path: string }[] = [{ label: root, path: root }];
  if (current === root) return segments;
  const rel = current.startsWith(root + '/') ? current.slice(root.length + 1) : current.slice(root.length);
  const parts = rel.split('/').filter(Boolean);
  let accumulated = root;
  for (const part of parts) {
    accumulated = accumulated === '/' ? `/${part}` : `${accumulated}/${part}`;
    segments.push({ label: part, path: accumulated });
  }
  return segments;
}

const BdpanDirPicker: React.FC<Props> = ({ visible, localPath, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  const [username, setUsername] = useState<string | undefined>(undefined);
  const [bdpanRoot, setBdpanRoot] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [dirs, setDirs] = useState<BdpanFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [authCode, setAuthCode] = useState('');

  // New folder state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const newFolderInputRef = useRef<any>(null);

  const [messageApi, messageContextHolder] = Message.useMessage();

  const loadFiles = useCallback(async (dirPath: string, root?: string) => {
    setLoadingFiles(true);
    setStep('file_browser');
    setCurrentPath(dirPath);
    try {
      const res = await ipcBridge.bdpan.ls.invoke({ path: dirPath });
      if (res?.success) {
        const rawFiles = (res.data?.files ?? []).filter((f) => f.path !== dirPath);
        const sorted = rawFiles.filter((f) => f.isdir).sort((a, b) => a.filename.localeCompare(b.filename));
        setDirs(sorted);

        if (root === undefined && dirPath === '/') {
          const detectedRoot = deriveRoot(res.data?.files ?? []);
          setBdpanRoot(detectedRoot);
          setCurrentPath(detectedRoot);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    setStep('checking');
    setErrorMsg('');
    try {
      const res = await ipcBridge.bdpan.whoami.invoke();
      if (res?.success && res.data?.authenticated && res.data?.has_valid_token) {
        setUsername(res.data.username);
        await loadFiles('/');
        return;
      }
      await startLogin();
    } catch (err) {
      setStep('error');
      setErrorMsg(String(err));
    }
  }, [loadFiles]);

  const startLogin = async () => {
    setStep('getting_auth_url');
    setErrorMsg('');
    try {
      const res = await ipcBridge.bdpan.loginGetAuthUrl.invoke();
      if (!res?.success || !res.data?.auth_url) {
        setStep('error');
        setErrorMsg(res?.data?.error ?? t('conversation.bdpan.loginFailed'));
        return;
      }
      ipcBridge.shell.openExternal.invoke(res.data.auth_url).catch(() => {});
      setStep('enter_code');
    } catch (err) {
      setStep('error');
      setErrorMsg(String(err));
    }
  };

  const submitAuthCode = async () => {
    const trimmed = authCode.trim();
    if (trimmed.length !== 32) return;
    setStep('submitting_code');
    try {
      const res = await ipcBridge.bdpan.loginSetCode.invoke({ code: trimmed });
      if (res?.success) {
        const whoami = await ipcBridge.bdpan.whoami.invoke();
        setUsername(whoami?.data?.username);
        await loadFiles('/');
      } else {
        setErrorMsg(res?.data?.message ?? t('conversation.bdpan.loginFailed'));
        setStep('error');
      }
    } catch (err) {
      setErrorMsg(String(err));
      setStep('error');
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const newPath = currentPath.endsWith('/') ? `${currentPath}${name}` : `${currentPath}/${name}`;
    setCreatingFolder(true);
    try {
      const res = await ipcBridge.bdpan.mkdir.invoke({ path: newPath });
      if (res?.success) {
        setShowNewFolder(false);
        setNewFolderName('');
        await loadFiles(currentPath, bdpanRoot ?? undefined);
      } else {
        messageApi.error(res?.data?.error ?? t('conversation.bdpan.mkdir.failed'));
      }
    } catch (err) {
      messageApi.error(String(err));
    } finally {
      setCreatingFolder(false);
    }
  };

  const logout = async () => {
    await ipcBridge.bdpan.logout.invoke();
    onCancel();
  };

  useEffect(() => {
    if (visible) {
      setUsername(undefined);
      setBdpanRoot(null);
      setDirs([]);
      setAuthCode('');
      setShowNewFolder(false);
      setNewFolderName('');
      void checkAuth();
    }
  }, [visible]);

  // Focus input when new folder row appears
  useEffect(() => {
    if (showNewFolder) {
      setTimeout(() => newFolderInputRef.current?.focus?.(), 50);
    }
  }, [showNewFolder]);

  const renderContent = () => {
    if (step === 'checking') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-12px'>
          <Spin size={32} />
          <span className='text-secondary text-14px'>{t('conversation.bdpan.checking')}</span>
        </div>
      );
    }

    if (step === 'getting_auth_url') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-12px'>
          <Spin size={32} />
          <span className='text-secondary text-14px'>{t('conversation.bdpan.gettingAuthUrl')}</span>
        </div>
      );
    }

    if (step === 'enter_code' || step === 'submitting_code') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-16px p-24px'>
          <div className='flex items-center gap-8px'>
            <span className='text-foreground text-14px whitespace-nowrap'>{t('conversation.bdpan.authCode')}</span>
            <Input style={{ width: 160 }} maxLength={32} placeholder={t('conversation.bdpan.authCodePlaceholder')} value={authCode} onChange={setAuthCode} onPressEnter={submitAuthCode} disabled={step === 'submitting_code'} />
            <Button type='primary' loading={step === 'submitting_code'} disabled={authCode.trim().length !== 32} onClick={submitAuthCode}>
              {t('conversation.bdpan.authCodeSubmit')}
            </Button>
          </div>
        </div>
      );
    }

    if (step === 'error') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-16px p-24px'>
          <p className='text-foreground text-14px text-center m-0'>{t('conversation.bdpan.loginFailed')}</p>
          {errorMsg && <p className='text-secondary text-12px text-center m-0'>{errorMsg}</p>}
          <div className='flex gap-8px'>
            <Button onClick={onCancel}>{t('conversation.bdpan.cancel')}</Button>
            <Button type='primary' onClick={startLogin}>
              {t('conversation.bdpan.retry')}
            </Button>
          </div>
        </div>
      );
    }

    const root = bdpanRoot ?? '/';
    const crumbs = buildBreadcrumbs(root, currentPath);
    const localName = localPath.split('/').filter(Boolean).pop() ?? localPath;

    return (
      <div className='flex flex-col h-400px'>
        {messageContextHolder}

        {/* Local path hint */}
        <div className='px-16px py-8px bg-[var(--bg-2)] border-b border-[var(--bg-3)] flex-shrink-0 text-13px text-secondary truncate'>
          {t('conversation.bdpan.upload.localPath')}: <span className='font-mono text-foreground'>{localName}</span>
        </div>

        {/* Breadcrumb nav bar */}
        <div className='flex items-center gap-4px px-16px py-10px border-b border-[var(--bg-3)] flex-shrink-0 flex-wrap'>
          <div className='flex items-center gap-4px flex-1 flex-wrap'>
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <React.Fragment key={crumb.path}>
                  {i > 0 && <span className='text-secondary text-13px'>/</span>}
                  {isLast ? (
                    <span className='text-foreground text-13px font-medium'>{crumb.label}</span>
                  ) : (
                    <button className='text-primary text-13px hover:underline bg-transparent border-none cursor-pointer p-0' onClick={() => loadFiles(crumb.path, root)}>
                      {crumb.label}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <Button type='text' size='small' icon={<Refresh size={15} />} loading={loadingFiles} onClick={() => loadFiles(currentPath, root)} />
          <Button
            type='text'
            size='small'
            icon={<FolderPlus size={15} />}
            onClick={() => {
              setShowNewFolder(true);
              setNewFolderName('');
            }}
          />
        </div>

        {/* Dir list */}
        <div className='flex-1 overflow-y-auto'>
          {loadingFiles ? (
            <div className='flex items-center justify-center h-full'>
              <Spin />
            </div>
          ) : (
            <>
              {dirs.map((dir) => (
                <div key={dir.path} className='flex items-center gap-10px px-16px py-10px cursor-pointer transition-colors select-none hover:bg-[var(--bg-2)]' onClick={() => loadFiles(dir.path, root)}>
                  <FolderOpen size={18} fill='var(--color-text-3)' />
                  <span className='flex-1 text-foreground text-14px truncate'>{dir.filename}</span>
                  <span className='text-secondary text-12px'>›</span>
                </div>
              ))}
              {dirs.length === 0 && !showNewFolder && <div className='flex items-center justify-center h-full text-secondary text-14px'>{t('conversation.bdpan.emptyDir')}</div>}
              {/* Inline new folder row */}
              {showNewFolder && (
                <div className='flex items-center gap-8px px-16px py-8px border-b border-[var(--bg-3)]'>
                  <FolderPlus size={18} fill='var(--color-text-3)' />
                  <Input ref={newFolderInputRef} style={{ flex: 1 }} placeholder={t('conversation.bdpan.mkdir.placeholder')} value={newFolderName} onChange={setNewFolderName} onPressEnter={handleCreateFolder} disabled={creatingFolder} />
                  <Button size='small' type='primary' loading={creatingFolder} disabled={!newFolderName.trim()} onClick={handleCreateFolder}>
                    {t('conversation.bdpan.mkdir.confirm')}
                  </Button>
                  <Button
                    size='small'
                    disabled={creatingFolder}
                    onClick={() => {
                      setShowNewFolder(false);
                      setNewFolderName('');
                    }}
                  >
                    {t('conversation.bdpan.cancel')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer: upload to current dir */}
        <div className='flex items-center justify-between px-16px py-12px border-t border-[var(--bg-3)] flex-shrink-0'>
          <span className='text-secondary text-13px truncate flex-1 mr-8px'>
            {t('conversation.bdpan.upload.uploadTo')}: <span className='font-mono text-foreground'>{currentPath}</span>
          </span>
          <div className='flex items-center gap-8px flex-shrink-0'>
            <Button onClick={onCancel}>{t('conversation.bdpan.cancel')}</Button>
            <Button type='primary' onClick={() => onConfirm(currentPath)}>
              {t('conversation.bdpan.upload.uploadButton')}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const modalTitle = (
    <div className='flex items-center justify-between'>
      <span>{t('conversation.bdpan.upload.title')}</span>
      {username && (
        <span className='text-secondary text-13px mr-4'>
          {username}{' '}
          <button className='text-primary text-13px hover:underline bg-transparent border-none cursor-pointer p-0' onClick={logout}>
            {t('conversation.bdpan.logout')}
          </button>
        </span>
      )}
    </div>
  );

  return (
    <Modal visible={visible} onCancel={onCancel} style={{ width: 520 }} title={modalTitle} footer={null}>
      {renderContent()}
    </Modal>
  );
};

export default BdpanDirPicker;
