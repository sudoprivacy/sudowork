/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// 回归守卫：i18n/index.ts 读 language 必须用 ProcessConfig.getSync（本地 fs），
// 不能用 ConfigStorage.get —— 后者是 @office-ai/platform 的 BroadcastChannel RPC，
// 主进程自调会永久 pending（详见 src/process/initStorage.ts:93 注释），导致 i18nReady
// 永不 resolve、新建团队卡在"正在启动团队成员"。
// 若有人改回 ConfigStorage.get，下方 mock 使其永不 resolve → 本测试超时失败。

vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    // 永不 resolve（模拟主进程自调的 pending 行为）
    get: () => new Promise<void>(() => {}),
  },
}));

vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    getSync: (key: string) => (key === 'language' ? 'en-US' : undefined),
  },
}));

vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' } }));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

let i18nReady: Promise<void> | undefined;

beforeAll(async () => {
  const mod = await import('@process/i18n');
  i18nReady = mod.i18nReady;
});

describe('main-process i18nReady', () => {
  it('resolves within finite time even when ConfigStorage.get would hang (regression guard)', async () => {
    expect(i18nReady).toBeDefined();
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('i18nReady did not resolve within 2s — likely regressed to ConfigStorage.get')), 2000));
    await expect(Promise.race([i18nReady as Promise<void>, timeout])).resolves.toBeUndefined();
  });
});
