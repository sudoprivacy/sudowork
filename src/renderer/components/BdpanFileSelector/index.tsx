/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { BdpanFileEntry } from '@/common/ipcBridge';
import AionModal from '@/renderer/components/base/AionModal';
import { Button, Message, Spin } from '@arco-design/web-react';
import { FileDisplayOne, FolderOpen, LeftSmall } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Step = 'checking' | 'waiting_auth' | 'file_browser' | 'error';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (selectedPaths: string[]) => void;
}

const BdpanFileSelector: React.FC<Props> = ({ visible, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  // File browser state
  const [currentPath, setCurrentPath] = useState('/');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [files, setFiles] = useState<BdpanFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Track whether loginInteractive is running
  const loginPending = useRef(false);

  // ── Step: check auth ────────────────────────────────────────────────────────
  const checkAuth = useCallback(async () => {
    setStep('checking');
    setErrorMsg('');
    try {
      const res = await ipcBridge.bdpan.whoami.invoke();
      if (res?.success && res.data?.authenticated && res.data?.has_valid_token) {
        await loadFiles('/');
        return;
      }
      // Need to login
      await startLogin();
    } catch (err) {
      setStep('error');
      setErrorMsg(String(err));
    }
  }, []);

  // ── Step: login ─────────────────────────────────────────────────────────────
  const startLogin = async () => {
    if (loginPending.current) return;
    loginPending.current = true;
    setStep('waiting_auth');

    try {
      const res = await ipcBridge.bdpan.loginInteractive.invoke();
      loginPending.current = false;

      if (res?.success && res.data?.type === 'success') {
        await loadFiles('/');
      } else {
        setStep('error');
        setErrorMsg(res?.data?.message || t('conversation.bdpan.loginTimeout'));
      }
    } catch (err) {
      loginPending.current = false;
      setStep('error');
      setErrorMsg(String(err));
    }
  };

  // ── Load files ───────────────────────────────────────────────────────────────
  const loadFiles = async (dirPath: string) => {
    setLoadingFiles(true);
    setStep('file_browser');
    setCurrentPath(dirPath);
    setSelected(new Set());
    try {
      const res = await ipcBridge.bdpan.ls.invoke({ path: dirPath });
      if (res?.success) {
        const sorted = [...(res.data?.files ?? [])].sort((a, b) => {
          if (a.isdir !== b.isdir) return a.isdir ? -1 : 1;
          return a.filename.localeCompare(b.filename);
        });
        setFiles(sorted);
      } else {
        Message.error(res?.data?.error ?? t('conversation.bdpan.lsFailed'));
      }
    } catch (err) {
      Message.error(String(err));
    } finally {
      setLoadingFiles(false);
    }
  };

  const navigateInto = (file: BdpanFileEntry) => {
    if (!file.isdir) return;
    setPathHistory((h) => [...h, currentPath]);
    loadFiles(file.path);
  };

  const navigateBack = () => {
    const prev = pathHistory[pathHistory.length - 1];
    if (prev === undefined) return;
    setPathHistory((h) => h.slice(0, -1));
    loadFiles(prev);
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
      setPathHistory([]);
      setFiles([]);
      setSelected(new Set());
      checkAuth();
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
    return (
      <div className='flex flex-col h-400px'>
        {/* Breadcrumb / nav bar */}
        <div className='flex items-center gap-8px px-16px py-10px border-b border-[var(--bg-3)] flex-shrink-0'>
          <Button
            type='text'
            size='small'
            icon={<LeftSmall size={16} />}
            disabled={pathHistory.length === 0}
            onClick={navigateBack}
          />
          <span className='text-t-secondary text-13px truncate flex-1'>{currentPath}</span>
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
                {file.isdir && <LeftSmall size={14} fill='var(--color-text-3)' className='rotate-180' />}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-16px py-12px border-t border-[var(--bg-3)] flex-shrink-0'>
          <span className='text-t-secondary text-13px'>
            {selected.size > 0 ? t('conversation.bdpan.selectedCount', { count: selected.size }) : t('conversation.bdpan.selectHint')}
          </span>
          <div className='flex gap-8px'>
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

  return (
    <AionModal
      visible={visible}
      onCancel={onCancel}
      style={{ width: 520 }}
      header={t('conversation.bdpan.title')}
      footer={null}
    >
      {renderContent()}
    </AionModal>
  );
};

export default BdpanFileSelector;
