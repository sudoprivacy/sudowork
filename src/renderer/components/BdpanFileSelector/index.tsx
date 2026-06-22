/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message, Spin } from '@arco-design/web-react';
import { Close, FileDisplayOne, FolderOpen, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionModal from '@/renderer/components/base/AionModal';
import type { BdpanFileEntry } from '@/common/ipcBridge';
import { ipcBridge } from '@/common';

type Step = 'checking' | 'getting_auth_url' | 'enter_code' | 'submitting_code' | 'file_browser' | 'error';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (selectedPaths: string[]) => void;
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
  const common = parents.every((p) => p === first) ? first : '/';
  return common;
}

/**
 * Build breadcrumb segments for a path relative to root.
 * Returns array of { label, path } — root segment first, always included.
 * e.g. root=/apps/bdpan, current=/apps/bdpan/1/2 →
 *   [{ label: 'bdpan', path: '/apps/bdpan' }, { label: '1', path: '/apps/bdpan/1' }, { label: '2', path: '/apps/bdpan/1/2' }]
 */
function buildBreadcrumbs(root: string, current: string): { label: string; path: string }[] {
  const rootLabel = root;
  const segments: { label: string; path: string }[] = [{ label: rootLabel, path: root }];

  if (current === root) return segments;

  // Strip root prefix and split remaining
  const rel = current.startsWith(root + '/') ? current.slice(root.length + 1) : current.slice(root.length);
  const parts = rel.split('/').filter(Boolean);
  let accumulated = root;
  for (const part of parts) {
    accumulated = accumulated === '/' ? `/${part}` : `${accumulated}/${part}`;
    segments.push({ label: part, path: accumulated });
  }
  return segments;
}

const BdpanFileSelector: React.FC<Props> = ({ visible, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  // File browser state
  const [username, setUsername] = useState<string | undefined>(undefined);
  const [bdpanRoot, setBdpanRoot] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<BdpanFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const [authCode, setAuthCode] = useState('');

  // ── Load files ───────────────────────────────────────────────────────────────
  const loadFiles = useCallback(
    async (dirPath: string, root?: string) => {
      setLoadingFiles(true);
      setStep('file_browser');
      setCurrentPath(dirPath);
      setSelected(new Set());
      setLastSelectedIndex(null);
      try {
        const res = await ipcBridge.bdpan.ls.invoke({ path: dirPath });
        if (res?.success) {
          // Filter out the directory itself (bdpan ls returns self for empty dirs)
          const rawFiles = (res.data?.files ?? []).filter((f) => f.path !== dirPath);
          const sorted = [...rawFiles].sort((a, b) => {
            if (a.isdir !== b.isdir) return a.isdir ? -1 : 1;
            return a.filename.localeCompare(b.filename);
          });
          setFiles(sorted);

          // On first load (root discovery), derive bdpanRoot from the returned paths
          if (root === undefined && dirPath === '/') {
            const detectedRoot = deriveRoot(res.data?.files ?? []);
            setBdpanRoot(detectedRoot);
            setCurrentPath(detectedRoot);
          }
        } else {
          Message.error(res?.data?.error ?? t('conversation.bdpan.lsFailed'));
        }
      } catch (err) {
        Message.error(String(err));
      } finally {
        setLoadingFiles(false);
      }
    },
    [t]
  );

  // ── Step: check auth ────────────────────────────────────────────────────────
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

  // ── Step 1: get auth URL and open browser ────────────────────────────────────
  const startLogin = async () => {
    setStep('getting_auth_url');
    setAuthCode('');
    setErrorMsg('');
    try {
      const res = await ipcBridge.bdpan.loginGetAuthUrl.invoke();
      if (!res?.success || !res.data?.auth_url) {
        setStep('error');
        setErrorMsg(res?.data?.error ?? t('conversation.bdpan.loginFailed'));
        return;
      }
      // Auto-open the auth URL in system default browser
      ipcBridge.shell.openExternal.invoke(res.data.auth_url).catch(() => {});
      setStep('enter_code');
    } catch (err) {
      setStep('error');
      setErrorMsg(String(err));
    }
  };

  // ── Step 2: submit the auth code user retrieved from browser ─────────────────
  const submitAuthCode = async () => {
    const trimmed = authCode.trim();
    if (trimmed.length !== 32) return;
    setStep('submitting_code');
    try {
      const res = await ipcBridge.bdpan.loginSetCode.invoke({ code: trimmed });
      if (res?.success) {
        // Fetch username via whoami then go to file browser
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

  const logout = async () => {
    await ipcBridge.bdpan.logout.invoke();
    onCancel();
  };

  const navigateInto = (file: BdpanFileEntry) => {
    if (!file.isdir) return;
    void loadFiles(file.path, bdpanRoot ?? undefined);
  };

  const handleFileClick = (file: BdpanFileEntry, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelectedIndex !== null) {
      // Range select: add all non-dir files between anchor and current indices (dirs are skipped)
      const lo = Math.min(lastSelectedIndex, index);
      const hi = Math.max(lastSelectedIndex, index);
      setSelected((s) => {
        const next = new Set(s);
        for (let i = lo; i <= hi; i++) {
          if (!files[i].isdir) next.add(files[i].path);
        }
        return next;
      });
      return;
    }

    if (file.isdir) {
      // Plain or cmd/ctrl click on dir: navigate in
      if (!e.metaKey && !e.ctrlKey) {
        navigateInto(file);
      }
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      // Toggle individual file
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
        return next;
      });
    } else {
      // Plain click: select only this file
      setSelected(new Set([file.path]));
    }
    setLastSelectedIndex(index);
  };

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setUsername(undefined);
      setBdpanRoot(null);
      setFiles([]);
      setSelected(new Set());
      setAuthCode('');
      void checkAuth();
    }
  }, [visible]);

  // ── Render ───────────────────────────────────────────────────────────────────
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

    // file_browser
    const root = bdpanRoot ?? '/';
    const crumbs = buildBreadcrumbs(root, currentPath);

    return (
      <div className='flex flex-col h-400px'>
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
                    <button className='text-[var(--color-primary-6)] text-13px hover:underline bg-transparent border-none cursor-pointer p-0' onClick={() => loadFiles(crumb.path, root)}>
                      {crumb.label}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <Button type='text' size='small' icon={<Refresh size={15} />} loading={loadingFiles} onClick={() => loadFiles(currentPath, root)} />
        </div>

        {/* File list */}
        <div
          className='flex-1 overflow-y-auto'
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelected(new Set());
              setLastSelectedIndex(null);
            }
          }}
        >
          {loadingFiles ? (
            <div className='flex items-center justify-center h-full'>
              <Spin />
            </div>
          ) : files.length === 0 ? (
            <div className='flex items-center justify-center h-full text-secondary text-14px'>{t('conversation.bdpan.emptyDir')}</div>
          ) : (
            files.map((file, index) => (
              <div key={file.path} className={`flex items-center gap-10px px-16px py-10px cursor-pointer transition-colors select-none ${selected.has(file.path) ? 'bg-[rgba(var(--primary-6),0.14)]' : 'hover:bg-[var(--bg-2)]'}`} onClick={(e) => handleFileClick(file, index, e)}>
                {file.isdir ? <FolderOpen size={18} fill='var(--color-text-3)' /> : <FileDisplayOne size={18} fill='var(--color-text-3)' />}
                <span className='flex-1 text-foreground text-14px truncate'>{file.filename}</span>
                {file.isdir && <span className='text-secondary text-12px'>›</span>}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-16px py-12px border-t border-[var(--bg-3)] flex-shrink-0'>
          <span className='text-secondary text-13px'>{selected.size > 0 ? t('conversation.bdpan.selectedCount', { count: selected.size }) : t('conversation.bdpan.selectHint')}</span>
          <div className='flex items-center gap-8px'>
            <Button onClick={onCancel}>{t('conversation.bdpan.cancel')}</Button>
            <Button
              type='primary'
              disabled={selected.size === 0}
              onClick={() => {
                const root = bdpanRoot ?? '';
                onConfirm(Array.from(selected).map((p) => `bdpan://${p}?root=${encodeURIComponent(root)}`));
              }}
            >
              {t('conversation.bdpan.confirm')}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const headerConfig = {
    render: () => (
      <div className='flex items-center justify-between pb-20px' style={{ borderBottom: '1px solid var(--bg-3)' }}>
        <h3 className='text-18px font-500 text-foreground m-0'>{t('conversation.bdpan.title')}</h3>
        <div className='flex items-center gap-12px'>
          {username && (
            <span className='text-secondary text-13px'>
              {username}{' '}
              <button className='text-[var(--color-primary-6)] text-13px hover:underline bg-transparent border-none cursor-pointer p-0' onClick={logout}>
                {t('conversation.bdpan.logout')}
              </button>
            </span>
          )}
          <button onClick={onCancel} className='w-32px h-32px f-center rd-8px transition-colors duration-200 cursor-pointer border-0 bg-transparent p-0 hover:bg-2 focus:outline-none' aria-label='Close'>
            <Close size={20} fill='#86909c' />
          </button>
        </div>
      </div>
    ),
  };

  return (
    <AionModal visible={visible} onCancel={onCancel} style={{ width: 520 }} header={headerConfig} footer={null}>
      {renderContent()}
    </AionModal>
  );
};

export default BdpanFileSelector;
