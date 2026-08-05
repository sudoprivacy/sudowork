/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag, Spin } from '@arco-design/web-react';
import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeContext } from '@/renderer/context/ThemeContext';

export interface ThoughtData {
  subject: string;
  description: string;
}

interface ThoughtDisplayProps {
  thought: ThoughtData;
  style?: 'default' | 'compact';
  running?: boolean;
  state?: 'processing' | 'waiting';
  onStop?: () => void;
  /** 处理开始时间戳（毫秒），用于恢复计时器 / Processing start timestamp in milliseconds for timer restoration */
  startTime?: number;
}

// 背景渐变常量 Background gradient constants
const GRADIENT_DARK = 'linear-gradient(135deg, #464767 0%, #323232 100%)';
const GRADIENT_LIGHT = 'linear-gradient(90deg, #F0F3FF 0%, #F2F2F2 100%)';

// 格式化时间 Format elapsed time
const formatElapsedTime = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const ThoughtDisplay: React.FC<ThoughtDisplayProps> = ({ thought, style = 'default', running = false, state = 'processing', onStop: _onStop, startTime }) => {
  const { theme } = useThemeContext();
  const { t } = useTranslation();
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number>(0);

  // 计时器 Timer for elapsed time
  useEffect(() => {
    if (!running && !thought?.subject) {
      setElapsedTime(0);
      return;
    }

    // 使用传入的 startTime 或当前时间 Use provided startTime or current time
    const effectiveStartTime = startTime ?? Date.now();
    startTimeRef.current = effectiveStartTime;

    // 如果有 startTime，计算初始已用时间 Calculate initial elapsed time if startTime was provided
    const initialElapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    setElapsedTime(Math.max(0, initialElapsed));

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(timer);
  }, [running, thought?.subject, startTime]);

  // 根据主题和样式计算最终样式 Calculate final style based on theme and style prop
  const containerStyle = useMemo(() => {
    const background = theme === 'dark' ? GRADIENT_DARK : GRADIENT_LIGHT;

    if (style === 'compact') {
      return {
        background,
        marginBottom: '8px',
        maxHeight: '100px',
        overflow: 'scroll' as const,
      };
    }

    return {
      background,
      marginBottom: '-14px',
      zIndex: 1,
    };
  }, [theme, style]);

  // 如果没有 thought 且不在运行中，不显示
  if (state !== 'waiting' && !thought?.subject && !running) {
    return null;
  }

  if (state === 'waiting') {
    return (
      <div className='p-2.5 rd-t-20px text-14px pb-6 lh-20px text-foreground flex items-center gap-2' style={containerStyle}>
        <Tag color='arcoblue' size='small'>
          {t('messages.waitingForUserInput')}
        </Tag>
        <span className='text-secondary'>{t('messages.enterAnswer')}</span>
      </div>
    );
  }

  // 运行中但没有 thought 时显示默认处理状态
  if (running && !thought?.subject) {
    return (
      <div className='p-2.5 rd-t-20px text-14px pb-6 lh-20px text-foreground flex items-center gap-2' style={containerStyle}>
        <Spin size={14} />
        <span className='text-secondary'>
          {t('conversation.chat.processing')}
          <span className='ml-2 opacity-60'>({formatElapsedTime(elapsedTime)})</span>
        </span>
      </div>
    );
  }

  // Check if description is different from subject (avoid showing duplicate content)
  const showDescription = thought.description && thought.description !== thought.subject;

  return (
    <div className='p-2.5 rd-t-20px text-14px pb-6 lh-20px text-foreground' style={containerStyle}>
      <div className='flex items-center gap-2'>
        {running && <Spin size={14} />}
        <Tag color='arcoblue' size='small'>
          {thought.subject}
        </Tag>
        {showDescription && <span className='flex-1 truncate'>{thought.description}</span>}
        {running && <span className='text-tertiary text-12px whitespace-nowrap'>({formatElapsedTime(elapsedTime)})</span>}
      </div>
    </div>
  );
};

export default ThoughtDisplay;
