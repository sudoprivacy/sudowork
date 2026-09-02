/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, Message, Modal, Spin } from '@arco-design/web-react';
import { Search } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ITeamAssistantCandidate } from '@/common/ipcBridge';
import { unwrapTeamResult } from '../utils';
import TeamAssistantCandidateCard, { useFilteredCandidates } from './TeamAssistantCandidateCard';

export default function TeamAddMemberModal({ isVisible, onClose, onAdded }: ITeamAddMemberModalProps) {
  const { t } = useTranslation();
  const [assistants, setAssistants] = useState<ITeamAssistantCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { search, setSearch, filtered } = useFilteredCandidates(assistants, t);

  useEffect(() => {
    if (!isVisible) return;
    let isCancelled = false;
    setIsLoading(true);
    setSearch('');
    void (async () => {
      try {
        const list = unwrapTeamResult(await ipcBridge.team.listAssistants.invoke()) ?? [];
        if (!isCancelled) setAssistants(list);
      } catch (error) {
        console.error('[TeamAddMemberModal] load assistants failed:', error);
        if (!isCancelled) Message.error(t('team.create.loadAssistantsFailed'));
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [isVisible, setSearch, t]);

  const handleSelect = async (candidate: ITeamAssistantCandidate) => {
    if (pendingId) return;
    setPendingId(candidate.assistant_id);
    try {
      await onAdded({ assistant_id: candidate.assistant_id, name: candidate.name, model: 'default', role: 'teammate' });
      onClose();
    } catch (error) {
      console.error('[TeamAddMemberModal] addMember failed:', error);
      Message.error(t('team.detail.addMemberFailed'));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Modal
      title={t('team.create.addMember')}
      visible={isVisible}
      onCancel={onClose}
      footer={null}
      style={{ width: 520, maxWidth: 'calc(100vw - 48px)' }}
      // 高于会话折叠按钮 (ConversationHeaderToggle, zIndex 9999) 的浮层
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 10000 }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <div className='flex h-[min(520px,calc(100vh-180px))] min-h-360px flex-col overflow-hidden'>
        <div className='relative'>
          <Search size={16} className='absolute left-14px top-1/2 -translate-y-1/2 text-gray-400' />
          <Input value={search} onChange={setSearch} placeholder={t('team.create.searchPlaceholder')} className='!h-44px !rounded-10px !bg-fill-1 !pl-38px' />
        </div>
        <div className='my-12px text-13px font-600 text-gray-600'>{t('team.create.allAssistantsCount', { count: filtered.length })}</div>
        <div className='flex min-h-0 flex-1 flex-col gap-10px overflow-y-auto pr-1'>
          {isLoading ? (
            <div className='flex h-full items-center justify-center'>
              <Spin />
            </div>
          ) : filtered.length === 0 ? (
            <div className='flex h-full items-center justify-center text-13px text-gray-400'>{t('team.create.noAssistants')}</div>
          ) : (
            filtered.map((candidate) => <TeamAssistantCandidateCard key={candidate.assistant_id} candidate={candidate} onClick={pendingId ? undefined : () => void handleSelect(candidate)} />)
          )}
        </div>
      </div>
    </Modal>
  );
}

interface ITeamAddMemberModalProps {
  isVisible: boolean;
  onClose: () => void;
  onAdded: (params: { assistant_id: string; name: string; model?: string; role?: 'lead' | 'teammate' }) => Promise<void>;
}
