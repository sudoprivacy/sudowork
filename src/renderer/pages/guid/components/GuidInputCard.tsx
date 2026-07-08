import { Input, Tag, Tooltip } from '@arco-design/web-react';
import type { RefTextAreaType } from '@arco-design/web-react/es/Input';
import { IconClose, IconPaste } from '@arco-design/web-react/icon';
import { FolderOpen, Lightning } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompositionInput } from '@/renderer/hooks/useCompositionInput';
import ContextMenu, { type ContextMenuItem } from '@/renderer/components/ContextMenu';
import FilePreview from '@/renderer/components/FilePreview';
import styles from '../styles/index.module.css';

type GuidInputCardProps = {
  textareaRef?: React.Ref<RefTextAreaType>;
  // Input state
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onPaste: React.ClipboardEventHandler;
  onFocus: () => void;
  onBlur: () => void;
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  placeholder: string;

  // Styling
  isInputActive: boolean;
  isFileDragging: boolean;
  activeBorderColor: string;
  inactiveBorderColor: string;
  activeShadow: string;
  dragHandlers: Record<string, any>;

  // Mention state
  mentionOpen: boolean;
  mentionSelectorBadge: React.ReactNode;
  mentionDropdown: React.ReactNode;

  // Skill selector state
  selectedSkills?: string[];
  onRemoveSkill?: (skillName: string) => void;
  getSkillDisplayName?: (skillName: string) => { displayName: string; emoji: string };

  // Files
  files: string[];
  onRemoveFile: (path: string) => void;

  // Workspace
  dir: string;
  onClearDir: () => void;

  // Action row
  actionRow: React.ReactNode;
};

// eslint-disable-next-line max-len
const GuidInputCard: React.FC<GuidInputCardProps> = ({
  textareaRef,
  input,
  onInputChange,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur,
  onSelect,
  placeholder,
  isInputActive,
  isFileDragging,
  activeBorderColor,
  inactiveBorderColor,
  activeShadow,
  dragHandlers,
  mentionOpen,
  mentionSelectorBadge,
  mentionDropdown,
  selectedSkills,
  onRemoveSkill,
  getSkillDisplayName,
  files,
  onRemoveFile,
  dir,
  onClearDir,
  actionRow,
}) => {
  const { t } = useTranslation();
  const { compositionHandlers, isComposing } = useCompositionInput();
  const textareaAutoSize = { minRows: 3, maxRows: 20 };
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposing.current) return;
    onKeyDown(e);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    const items: ContextMenuItem[] = [
      {
        label: t('common.paste', { defaultValue: 'Paste' }),
        icon: <IconPaste />,
        onClick: async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text && target) {
              const start = target.selectionStart ?? target.value.length;
              const end = target.selectionEnd ?? start;
              const currentValue = target.value;
              const newValue = currentValue.slice(0, start) + text + currentValue.slice(end);

              onInputChange(newValue);

              setTimeout(() => {
                target.focus();
                const newCursorPos = start + text.length;
                target.setSelectionRange(newCursorPos, newCursorPos);
              }, 10);
            }
          } catch (error) {
            console.error('Failed to read clipboard:', error);
          }
        },
      },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div
      className={`w-full box-border relative p-16px ${dir ? 'pb-8px' : ''} b bg-fill-1 b-solid rd-20px flex flex-col ${mentionOpen ? 'overflow-visible' : 'overflow-hidden'} transition-all duration-200 ${isFileDragging ? 'border-dashed' : ''}`}
      style={{
        zIndex: 1,
        transition: 'box-shadow 0.25s ease, border-color 0.25s ease, border-width 0.25s ease',
        ...(isFileDragging
          ? {
              backgroundColor: 'rgba(var(--ui-accent-orange-rgb), 0.08)',
              borderColor: 'rgba(var(--ui-accent-orange-rgb), 0.42)',
              borderWidth: '1px',
            }
          : {
              borderWidth: '1px',
              borderColor: isInputActive ? activeBorderColor : inactiveBorderColor,
              boxShadow: isInputActive ? activeShadow : 'none',
            }),
      }}
      {...dragHandlers}
    >
      {mentionSelectorBadge}
      {/* 已选技能标签 */}
      {selectedSkills && selectedSkills.length > 0 && (
        <div className='flex flex-col gap-6px mb-8px'>
          <div className='flex items-center gap-4px text-11px text-secondary'>
            <Lightning size='12' />
            <span>当前使用技能</span>
          </div>
          <div className='flex flex-wrap gap-6px'>
            {selectedSkills.map((skillName) => {
              const skillInfo = getSkillDisplayName?.(skillName);
              const displayName = skillInfo?.displayName || skillName;
              return (
                <Tag key={skillName} closable onClose={() => onRemoveSkill?.(skillName)} className='text-12px rd-full' icon={<Lightning size='12' className='mr-4px text-[var(--ui-accent-orange)]' />}>
                  {displayName}
                </Tag>
              );
            })}
          </div>
        </div>
      )}
      <Input.TextArea
        ref={textareaRef}
        autoSize={textareaAutoSize}
        placeholder={placeholder}
        className={`text-16px focus:b-none rounded-xl !bg-transparent !b-none !resize-none !p-0 ${styles.lightPlaceholder}`}
        value={input}
        onChange={onInputChange}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
        onSelect={onSelect}
        {...compositionHandlers}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      />
      {mentionOpen && (
        <div className='absolute z-50' style={{ left: 16, top: 44 }}>
          {mentionDropdown}
        </div>
      )}
      {files.length > 0 && (
        <div className='flex flex-wrap items-center gap-3 my-3'>
          {files.map((path) => (
            <FilePreview key={path} path={path} onRemove={() => onRemoveFile(path)} />
          ))}
        </div>
      )}
      {actionRow}
      {dir && (
        <div className='flex items-start justify-between gap-10px mt-8px px-10px py-6px text-13px text-secondary' style={{ borderTop: '1px solid var(--border-default)' }}>
          <div className='flex items-start min-w-0 flex-1 gap-8px'>
            <FolderOpen className='mt-1px flex-shrink-0' theme='outline' size='16' fill={'var(--text-secondary)'} style={{ lineHeight: 0 }} />
            <Tooltip content={dir} position='top'>
              <span className='block min-w-0 whitespace-normal break-all leading-18px'>
                {t('conversation.welcome.currentWorkspace')}: {dir}
              </span>
            </Tooltip>
          </div>
          <Tooltip content={t('conversation.welcome.clearWorkspace')} position='top'>
            <button
              type='button'
              className='mt-1px h-28px w-28px rd-full f-center flex-shrink-0 text-tertiary hover:text-danger hover:bg-danger-soft active:bg-danger-soft transition-colors'
              onClick={onClearDir}
              aria-label={t('conversation.welcome.clearWorkspace')}
              style={{ border: '1px solid var(--border-default)' }}
            >
              <IconClose strokeWidth={3} style={{ fontSize: 15 }} />
            </button>
          </Tooltip>
        </div>
      )}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
    </div>
  );
};

export default GuidInputCard;
