/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import profileBoy from '@/renderer/assets/profile_boy.jpg';
import profileGirl from '@/renderer/assets/profile_girl.jpg';
import type { UserAvatarRecord } from '../types';

const STORAGE_KEY = 'sudowork_user_avatar_v1';
const CHANGE_EVENT = 'sudowork-avatar-changed';

const PRESET_SRC: Record<'boy' | 'girl', string> = {
  boy: profileBoy,
  girl: profileGirl,
};

function readRecord(): UserAvatarRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserAvatarRecord;
    if (parsed?.type === 'preset' && (parsed.value === 'boy' || parsed.value === 'girl')) return parsed;
    if (parsed?.type === 'generated' && typeof parsed.localPath === 'string' && parsed.localPath) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeRecord(record: UserAvatarRecord | null): void {
  if (record) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useUserAvatar(): {
  record: UserAvatarRecord | null;
  avatarSrc: string | null;
  loading: boolean;
  setAvatar: (r: UserAvatarRecord) => void;
  clear: () => void;
} {
  const [record, setRecord] = useState<UserAvatarRecord | null>(() => readRecord());
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 多实例同步：监听跨窗口 storage 事件与同窗口自定义事件
  useEffect(() => {
    const sync = () => setRecord(readRecord());
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  // record 变化时解析出可直接用于 <img src> 的字符串
  useEffect(() => {
    let cancelled = false;

    if (!record) {
      setAvatarSrc(null);
      setLoading(false);
      return;
    }

    if (record.type === 'preset') {
      setAvatarSrc(PRESET_SRC[record.value]);
      setLoading(false);
      return;
    }

    setLoading(true);
    ipcBridge.fs.getImageBase64
      .invoke({ path: record.localPath })
      .then((base64) => {
        if (cancelled) return;
        setAvatarSrc(base64);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // 降级：文件已被清理 / 数据迁移 / 账号切换导致脏 record，清空回退到默认图标
        setAvatarSrc(null);
        setLoading(false);
        writeRecord(null);
      });

    return () => {
      cancelled = true;
    };
  }, [record]);

  const setAvatar = useCallback((r: UserAvatarRecord) => {
    writeRecord(r);
  }, []);

  const clear = useCallback(() => {
    writeRecord(null);
  }, []);

  return { record, avatarSrc, loading, setAvatar, clear };
}
