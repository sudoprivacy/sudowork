/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Empty-state display for AssistantHub / SkillHub catalog views.
 *
 * Differentiates between three "I see nothing here" causes so users
 * stop guessing why catalogs look empty:
 *
 *   - TOKEN_MISSING: server hasn't provisioned a skillhub token for
 *     this profile. Common when (a) consumer-mode user skipped login,
 *     (b) the per-tenant skillhub credential isn't configured on
 *     sudowork-server, or (c) the credentials fetch silently failed
 *     post-login. UI nudges them to check login / wait for sync;
 *     retry button is intentionally omitted because retrying the
 *     fetch won't help — the token just isn't there.
 *
 *   - FETCH_FAILED: transport/server error. Catch-all for unexpected
 *     errors. Retry CTA shown.
 *
 *   - null (no error stored): actually empty catalog. Falls through
 *     to caller-supplied default content (so existing per-page empty
 *     state — "暂无智能体" / "未找到技能" — stays the same).
 *
 * Why a shared component (vs duplicating in Agent + Skill modals):
 * adding a third Hub tomorrow shouldn't mean re-deciding "what to
 * show when token is missing". SSOT for the user-facing wording +
 * the retry-vs-help branching lives here.
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { IconExclamationCircle, IconLock, IconRefresh } from '@arco-design/web-react/icon';
import type { HubError } from '@common/nexus/hubErrors';

interface IHubEmptyStateProps {
  /** Typed error from the most recent hub fetch. When null (and no onLogin), render
   *  nothing (the caller decides what "actually empty" looks like). */
  error?: HubError | null;
  /** Invoked when the user clicks the retry button. Only shown for
   *  retriable error classes (i.e. FETCH_FAILED). */
  onRetry?: () => void;
  /** 游客态登录引导回调。传入时优先渲染「登录后查看 + 去登录」，忽略 error。 */
  onLogin?: () => void;
}

export default function HubEmptyState({ error, onRetry, onLogin }: IHubEmptyStateProps) {
  const { t } = useTranslation();

  if (!error && !onLogin) return null;

  // 游客态登录引导：传入 onLogin 时优先渲染（须在下方 error.code 访问之前 early-return，避免 error=null 时崩溃）
  if (onLogin) {
    return (
      <div className='flex flex-col items-center justify-center py-8 text-center' data-testid='hub-empty-state-login'>
        <IconLock className='text-32px text-foreground-secondary mb-3' />
        <div className='text-13px text-foreground-secondary mb-3'>{t('settings.hubEmpty.loginToView', { defaultValue: '登录后查看完整列表' })}</div>
        <Button size='mini' onClick={onLogin}>
          {t('settings.hubEmpty.login', { defaultValue: '去登录' })}
        </Button>
      </div>
    );
  }

  // 到此处 onLogin 必假；结合上方守卫 error 必真，收窄类型供下方 error.code/message/retriable 安全访问
  if (!error) return null;

  const isTokenMissing = error.code === 'TOKEN_MISSING';
  const Icon = isTokenMissing ? IconLock : IconExclamationCircle;
  const titleKey = isTokenMissing ? 'settings.hubEmpty.tokenMissing' : 'settings.hubEmpty.fetchFailed';
  const titleFallback = isTokenMissing ? '未配置 Skill Hub — 请检查 sudowork-server 登录状态' : '拉取失败，请重试';

  return (
    <div className='flex flex-col items-center justify-center py-8 text-center' data-testid={`hub-empty-state-${error.code.toLowerCase()}`}>
      <Icon className='text-32px text-foreground-secondary mb-3' />
      <div className='text-13px text-foreground-secondary mb-1'>{t(titleKey, { defaultValue: titleFallback })}</div>
      {error.message ? <div className='text-11px text-foreground-tertiary mb-3 max-w-90'>{error.message}</div> : null}
      {error.retriable && onRetry ? (
        <Button size='mini' icon={<IconRefresh />} onClick={onRetry}>
          {t('settings.hubEmpty.retry', { defaultValue: '重试' })}
        </Button>
      ) : null}
    </div>
  );
}
