/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty, Button } from '@arco-design/web-react';
import classNames from 'classnames';
import './EmptyState.css';

export interface EmptyStateAction {
  /** 按钮文本 */
  label: string;
  /** 按钮点击回调 */
  onClick: () => void;
  /** 按钮类型，默认为 primary */
  type?: 'primary' | 'secondary' | 'dashed' | 'text' | 'outline';
  /** 是否禁用 */
  disabled?: boolean;
  /** 额外类名 */
  className?: string;
}

export interface EmptyStateProps {
  /** 自定义图标 */
  icon?: React.ReactNode;
  /** 标题文本 */
  title: string;
  /** 描述文本 */
  description?: string;
  /** 操作按钮列表 */
  actions?: EmptyStateAction[];
  /** 额外类名 */
  className?: string;
  /** 是否使用简单模式（无边框背景） */
  simple?: boolean;
  /** 插图类型，当未提供 icon 时使用预设插图 */
  illustrationType?: 'default' | 'search' | 'messages' | 'files' | 'tasks';
}

/**
 * 统一的空状态组件，支持引导操作按钮
 * Unified empty state component with guide action buttons
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<FolderOpen size={48} />}
 *   title="工作空间为空"
 *   description="上传文件或打开文件夹后，文件将显示在这里"
 *   actions={[
 *     { label: '选择文件夹', onClick: handleSelectFolder, type: 'primary' },
 *     { label: '上传文件', onClick: handleUploadFile }
 *   ]}
 * />
 * ```
 */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, actions, className, simple = false, illustrationType = 'default' }) => {
  // 默认空状态插图（当未提供 icon 时）
  // Default empty state illustration (when icon is not provided)
  const getIllustration = () => {
    switch (illustrationType) {
      case 'search':
        // 搜索为空 - 放大镜图标
        return (
          <svg width='120' height='120' viewBox='0 0 120 120' fill='none' className='opacity-60'>
            <circle cx='55' cy='55' r='35' stroke='var(--text-tertiary)' strokeWidth='3' fill='none' />
            <line x1='78' y1='78' x2='100' y2='100' stroke='var(--text-tertiary)' strokeWidth='3' strokeLinecap='round' />
            <path d='M95 25 L105 35' stroke='var(--text-tertiary)' strokeWidth='2' strokeLinecap='round' opacity='0.5' />
            <path d='M95 35 L105 25' stroke='var(--text-tertiary)' strokeWidth='2' strokeLinecap='round' opacity='0.5' />
          </svg>
        );
      case 'messages':
        // 消息为空 - 对话气泡
        return (
          <svg width='120' height='120' viewBox='0 0 120 120' fill='none' className='opacity-60'>
            <rect x='25' y='30' width='70' height='50' rx='10' stroke='var(--text-tertiary)' strokeWidth='3' fill='none' />
            <path d='M55 80 L45 95 L65 85' stroke='var(--text-tertiary)' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' fill='none' />
            <circle cx='45' cy='50' r='4' fill='var(--text-tertiary)' />
            <circle cx='60' cy='50' r='4' fill='var(--text-tertiary)' />
            <circle cx='75' cy='50' r='4' fill='var(--text-tertiary)' />
          </svg>
        );
      case 'files':
        // 文件为空 - 文件夹
        return (
          <svg width='120' height='120' viewBox='0 0 120 120' fill='none' className='opacity-60'>
            <path d='M25 35 L50 35 L60 45 L95 45 L95 85 L25 85 Z' stroke='var(--text-tertiary)' strokeWidth='3' fill='none' strokeLinejoin='round' />
            <path d='M35 55 L50 70 L75 50' stroke='var(--text-tertiary)' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        );
      case 'tasks':
        // 任务为空 - 清单
        return (
          <svg width='120' height='120' viewBox='0 0 120 120' fill='none' className='opacity-60'>
            <rect x='30' y='25' width='60' height='70' rx='8' stroke='var(--text-tertiary)' strokeWidth='3' fill='none' />
            <line x1='45' y1='40' x2='75' y2='40' stroke='var(--text-tertiary)' strokeWidth='2' strokeLinecap='round' />
            <line x1='45' y1='55' x2='75' y2='55' stroke='var(--text-tertiary)' strokeWidth='2' strokeLinecap='round' />
            <line x1='45' y1='70' x2='65' y2='70' stroke='var(--text-tertiary)' strokeWidth='2' strokeLinecap='round' />
            <path d='M38 38 L42 42 L48 36' stroke='var(--text-tertiary)' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        );
      default:
        // 默认 - 空心圆加勾
        return (
          <svg width='120' height='120' viewBox='0 0 120 120' fill='none' className='opacity-60'>
            <circle cx='60' cy='60' r='40' stroke='var(--text-tertiary)' strokeWidth='2' strokeDasharray='6 6' fill='none' />
            <path d='M45 55 L60 70 L75 45' stroke='var(--text-tertiary)' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        );
    }
  };

  const defaultIcon = getIllustration();
  return (
    <div
      className={classNames(
        'empty-state flex flex-col items-center justify-center py-40px px-20px',
        {
          'empty-state--simple': simple,
          'empty-state--with-border': !simple,
        },
        className
      )}
    >
      {/* 图标区域 / Icon area */}
      <div className='empty-state__icon mb-24px text-t-tertiary'>{icon || defaultIcon}</div>

      {/* 标题 / Title */}
      {title && <div className='empty-state__title text-16px font-500 text-t-primary mb-8px text-center'>{title}</div>}

      {/* 描述 / Description */}
      {description && <div className='empty-state__description text-13px text-t-secondary mb-20px text-center max-w-300px'>{description}</div>}

      {/* 操作按钮 / Action buttons */}
      {actions && actions.length > 0 && (
        <div className='empty-state__actions flex gap-12px flex-wrap justify-center'>
          {actions.map((action, index) => (
            <Button key={index} type={action.type || 'primary'} onClick={action.onClick} disabled={action.disabled} className={classNames('empty-state__action-btn px-20px min-w-100px', action.className)} style={{ borderRadius: 'var(--radius-md)' }}>
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
