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
const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actions,
  className,
  simple = false,
}) => {
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
      {icon && (
        <div className='empty-state__icon mb-24px text-t-tertiary'>
          {icon}
        </div>
      )}

      {/* 标题 / Title */}
      {title && (
        <div className='empty-state__title text-16px font-500 text-t-primary mb-8px text-center'>
          {title}
        </div>
      )}

      {/* 描述 / Description */}
      {description && (
        <div className='empty-state__description text-13px text-t-secondary mb-20px text-center max-w-300px'>
          {description}
        </div>
      )}

      {/* 操作按钮 / Action buttons */}
      {actions && actions.length > 0 && (
        <div className='empty-state__actions flex gap-12px flex-wrap justify-center'>
          {actions.map((action, index) => (
            <Button
              key={index}
              type={action.type || 'primary'}
              onClick={action.onClick}
              disabled={action.disabled}
              className='empty-state__action-btn px-20px min-w-100px'
              style={{ borderRadius: 'var(--radius-md)' }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
