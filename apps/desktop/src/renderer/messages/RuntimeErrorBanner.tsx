/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Attention } from '@icon-park/react';
import { theme } from '@office-ai/platform';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { bodyKey, ctaKey, formatBytes, showsBytes, titleKey, toRuntimeErrorClass, type RuntimeErrorClass } from '@/common/runtime-errors';

export default function RuntimeErrorBanner({ errorClass, errorBytes, fallbackContent, onCtaClick }: IRuntimeErrorBannerProps) {
  const { t } = useTranslation();
  const cls = toRuntimeErrorClass(errorClass);

  // Defensive fallback: if back-end emitted an errorClass the renderer
  // hasn't shipped yet (forward-compat across versions), degrade to the
  // raw upstream message rather than rendering an empty banner.
  if (!cls) {
    return <LegacyErrorRow content={fallbackContent} />;
  }

  const bytesStr = errorBytes !== undefined && showsBytes(cls) ? formatBytes(errorBytes) : '';
  const body = t(bodyKey(cls), { bytes: bytesStr, defaultValue: fallbackContent });
  const title = t(titleKey(cls), { defaultValue: '' });
  const ctaI18nKey = ctaKey(cls);
  const cta = ctaI18nKey ? t(ctaI18nKey, { defaultValue: '' }) : '';

  return (
    <div className='w-full' data-testid={`runtime-error-${cls}`}>
      <div className='bg-message-tips rd-8px p-x-12px p-y-10px flex items-start gap-8px'>
        <Attention theme='filled' size='18' strokeLinejoin='bevel' className='m-t-2px flex-shrink-0' fill={theme.Color.FunctionalColor.error} />
        <div className='flex-1 min-w-0'>
          {title ? <div className='text-foreground font-medium m-b-4px [word-break:break-word]'>{title}</div> : null}
          <div className='whitespace-break-spaces text-foreground/85 [word-break:break-word] text-13px'>{body}</div>
          {cta && onCtaClick ? (
            <button type='button' onClick={() => onCtaClick(cls)} className='m-t-8px text-12px text-primary hover:underline cursor-pointer bg-transparent border-0 p-0' data-testid={`runtime-error-cta-${cls}`}>
              {cta}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LegacyErrorRow({ content }: { content: string }) {
  return (
    <div className='w-full' data-testid='runtime-error-fallback'>
      <div className='bg-message-tips rd-8px p-x-12px p-y-8px flex items-start gap-4px'>
        <Attention theme='filled' size='16' strokeLinejoin='bevel' className='m-t-2px' fill={theme.Color.FunctionalColor.error} />
        <span className='whitespace-break-spaces text-foreground [word-break:break-word]'>{content}</span>
      </div>
    </div>
  );
}

interface IRuntimeErrorBannerProps {
  /** Error class string from IPC (typed as string for forward-compat across versions). */
  errorClass: string;
  /** Original bytes of the offending payload (for size-driven copies). */
  errorBytes?: number;
  /** Original textual content sent by back-end; used as fallback if i18n key missing or class unknown. */
  fallbackContent: string;
  /** Optional CTA click handler. The class is passed so caller can dispatch per-class actions. */
  onCtaClick?: (cls: RuntimeErrorClass) => void;
}
