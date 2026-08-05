/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import classNames from 'classnames';
import { ClipboardList, FolderOpen, Inbox, MessagesSquare, SearchX } from 'lucide-react';

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
const EmptyState: React.FC<IEmptyStateProps> = ({ icon, title, description, actions, className, simple = false, illustrationType = 'default' }) => {
  const getIllustration = () => {
    const props = { size: 48, className: 'opacity-60', strokeWidth: 1.5 };
    switch (illustrationType) {
      case 'search':
        return <SearchX {...props} />;
      case 'messages':
        return <MessagesSquare {...props} />;
      case 'files':
        return <FolderOpen {...props} />;
      case 'tasks':
        return <ClipboardList {...props} />;
      default:
        return <Inbox {...props} />;
    }
  };

  const defaultIcon = getIllustration();
  return (
    <div
      className={classNames(
        'flex flex-col items-center justify-center py-10 px-5 text-center',
        {
          'bg-transparent': simple,
          'rounded-xl border border-dashed border-light': !simple,
        },
        className
      )}
    >
      {/* 图标区域 / Icon area */}
      <div className='f-center mb-6'>{icon || defaultIcon}</div>

      {/* 标题 / Title */}
      {title && <div className='text-16px font-500 text-foreground mb-2 text-center leading-[1.5]'>{title}</div>}

      {/* 描述 / Description */}
      {description && <div className='text-13px text-secondary mb-5 text-center max-w-75 leading-[1.5]'>{description}</div>}

      {/* 操作按钮 / Action buttons */}
      {actions && actions.length > 0 && (
        <div className='flex gap-3 flex-wrap justify-center mt-[var(--space-4)]'>
          {actions.map((action, index) => (
            <Button key={index} type={action.type || 'primary'} shape='round' onClick={action.onClick} disabled={action.disabled} className={classNames('px-5 min-w-25 transition-all duration-200 hover:-translate-y-1px active:translate-y-0', action.className)}>
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmptyState;

interface EmptyStateAction {
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

interface IEmptyStateProps {
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
