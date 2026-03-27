/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { BdpanFileEntry } from '@/common/ipcBridge';
import AionModal from '@/renderer/components/base/AionModal';
import { Button, Message, Spin } from '@arco-design/web-react';
import { Close, FileDisplayOne, FolderOpen, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Step = 'checking' | 'waiting_auth' | 'file_browser' | 'error';

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

  // Track whether loginInteractive is running
  const loginPending = useRef(false);

  // ── Load files ───────────────────────────────────────────────────────────────
  const loadFiles = useCallback(async (dirPath: string, root?: string) => {
    setLoadingFiles(true);
    setStep('file_browser');
    setCurrentPath(dirPath);
    setSelected(new Set());
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
  }, [t]);

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

  // ── Step: login ─────────────────────────────────────────────────────────────
  const startLogin = async () => {
    if (loginPending.current) return;
    loginPending.current = true;
    setStep('waiting_auth');

    // Fire the interactive login in the background (long-running, may not resolve promptly)
    ipcBridge.bdpan.loginInteractive.invoke().catch(() => {});

    // Poll whoami until authenticated or timeout (~90s)
    const POLL_INTERVAL = 2000;
    const MAX_POLLS = 45;
    let polls = 0;
    const poll = async (): Promise<void> => {
      if (!loginPending.current) return; // cancelled (e.g. modal closed)
      polls++;
      try {
        const whoami = await ipcBridge.bdpan.whoami.invoke();
        if (whoami?.success && whoami.data?.authenticated && whoami.data?.has_valid_token) {
          loginPending.current = false;
          setUsername(whoami.data.username);
          await loadFiles('/');
          return;
        }
      } catch {}
      if (polls >= MAX_POLLS) {
        loginPending.current = false;
        setStep('error');
        setErrorMsg(t('conversation.bdpan.loginTimeout'));
        return;
      }
      setTimeout(poll, POLL_INTERVAL);
    };
    setTimeout(poll, POLL_INTERVAL);
  };

  const logout = async () => {
    await ipcBridge.bdpan.logout.invoke();
    onCancel();
  };

  const navigateInto = (file: BdpanFileEntry) => {
    if (!file.isdir) return;
    loadFiles(file.path, bdpanRoot ?? undefined);
  };

  const toggleSelect = (file: BdpanFileEntry) => {
    if (file.isdir) {
      navigateInto(file);
      return;
    }
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(file.path)) next.delete(file.path);
      else next.add(file.path);
      return next;
    });
  };

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      loginPending.current = false;
      setUsername(undefined);
      setBdpanRoot(null);
      setFiles([]);
      setSelected(new Set());
      checkAuth();
    } else {
      loginPending.current = false; // stop any in-flight poll when modal closes
    }
  }, [visible]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const renderContent = () => {
    if (step === 'checking') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-12px'>
          <Spin size={32} />
          <span className='text-t-secondary text-14px'>{t('conversation.bdpan.checking')}</span>
        </div>
      );
    }

    if (step === 'waiting_auth') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-12px'>
          <Spin size={32} />
          <span className='text-t-secondary text-14px'>{t('conversation.bdpan.waitingAuth')}</span>
        </div>
      );
    }

    if (step === 'error') {
      return (
        <div className='flex flex-col items-center justify-center h-300px gap-16px p-24px'>
          <p className='text-t-primary text-14px text-center m-0'>{t('conversation.bdpan.loginFailed')}</p>
          {errorMsg && <p className='text-t-secondary text-12px text-center m-0'>{errorMsg}</p>}
          <div className='flex gap-8px'>
            <Button onClick={onCancel}>{t('conversation.bdpan.cancel')}</Button>
            <Button type='primary' onClick={checkAuth}>{t('conversation.bdpan.retry')}</Button>
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
                  {i > 0 && <span className='text-t-secondary text-13px'>/</span>}
                  {isLast ? (
                    <span className='text-t-primary text-13px font-medium'>{crumb.label}</span>
                  ) : (
                    <button
                      className='text-[var(--color-primary-6)] text-13px hover:underline bg-transparent border-none cursor-pointer p-0'
                      onClick={() => loadFiles(crumb.path, root)}
                    >
                      {crumb.label}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <Button
            type='text'
            size='small'
            icon={<Refresh size={15} />}
            loading={loadingFiles}
            onClick={() => loadFiles(currentPath, root)}
          />
        </div>

        {/* File list */}
        <div className='flex-1 overflow-y-auto'>
          {loadingFiles ? (
            <div className='flex items-center justify-center h-full'>
              <Spin />
            </div>
          ) : files.length === 0 ? (
            <div className='flex items-center justify-center h-full text-t-secondary text-14px'>
              {t('conversation.bdpan.emptyDir')}
            </div>
          ) : (
            files.map((file) => (
              <div
                key={file.path}
                className={`flex items-center gap-10px px-16px py-10px cursor-pointer hover:bg-[var(--bg-2)] transition-colors ${selected.has(file.path) ? 'bg-[var(--primary-1)]' : ''}`}
                onClick={() => toggleSelect(file)}
              >
                {file.isdir ? (
                  <FolderOpen size={18} fill='var(--color-text-3)' />
                ) : (
                  <FileDisplayOne size={18} fill='var(--color-text-3)' />
                )}
                <span className='flex-1 text-t-primary text-14px truncate'>{file.filename}</span>
                {file.isdir && <span className='text-t-secondary text-12px'>›</span>}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-16px py-12px border-t border-[var(--bg-3)] flex-shrink-0'>
          <span className='text-t-secondary text-13px'>
            {selected.size > 0 ? t('conversation.bdpan.selectedCount', { count: selected.size }) : t('conversation.bdpan.selectHint')}
          </span>
          <div className='flex items-center gap-8px'>
            <Button onClick={onCancel}>{t('conversation.bdpan.cancel')}</Button>
            <Button
              type='primary'
              disabled={selected.size === 0}
              onClick={() => onConfirm(Array.from(selected))}
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
        <h3 className='text-18px font-500 text-t-primary m-0'>{t('conversation.bdpan.title')}</h3>
        <div className='flex items-center gap-12px'>
          {username && (
            <span className='text-t-secondary text-13px'>
              {username}{' '}
              <button
                className='text-[var(--color-primary-6)] text-13px hover:underline bg-transparent border-none cursor-pointer p-0'
                onClick={logout}
              >
                {t('conversation.bdpan.logout')}
              </button>
            </span>
          )}
          <button
            onClick={onCancel}
            className='w-32px h-32px flex items-center justify-center rd-8px transition-colors duration-200 cursor-pointer border-0 bg-transparent p-0 hover:bg-2 focus:outline-none'
            aria-label='Close'
          >
            <Close size={20} fill='#86909c' />
          </button>
        </div>
      </div>
    ),
  };

  return (
    <AionModal
      visible={visible}
      onCancel={onCancel}
      style={{ width: 520 }}
      header={headerConfig}
      footer={null}
    >
      {renderContent()}
    </AionModal>
  );
};

export default BdpanFileSelector;
