import { Button, Input, Message, Tag, Tooltip } from '@arco-design/web-react';
import { ArrowUp, CloseSmall, Lightning } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPaste } from '@arco-design/web-react/icon';
import { useInputFocusRing } from '@/renderer/hooks/useInputFocusRing';
import SlashCommandMenu, { type SlashCommandMenuItem } from '@/renderer/components/SlashCommandMenu';
import { useSlashCommandController } from '@/renderer/hooks/useSlashCommandController';
import SkillSelectorPopover from '@/renderer/components/SkillSelectorPopover';
import { useSkillSelectorController, type SkillSelectorItem, stripAtQuery, replaceAtQuery } from '@/renderer/hooks/useSkillSelectorController';
import type { WorkspaceFileItem } from '@/renderer/hooks/useWorkspaceFiles';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import type { SlashCommandItem } from '@/common/slash/types';
import ContextMenu, { type ContextMenuItem } from '@/renderer/components/ContextMenu';
import ActionChip from '@/renderer/components/ui/ActionChip';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { skillHub } from '@/common/ipcBridge';
import { resolveSkillIcon, getInstalledSkillDisplay } from '@/renderer/utils/skillDisplay';
import { addEventListener } from '@/renderer/utils/emitter';
import { allSupportedExts } from '../services/FileService';
import type { FileMetadata } from '../services/FileService';
import { usePasteService } from '../hooks/usePasteService';
import { useLatestRef } from '../hooks/useLatestRef';
import { useDragUpload } from '../hooks/useDragUpload';
import { useCompositionInput } from '../hooks/useCompositionInput';

const constVoid = (): void => undefined;
// 临界值：超过该字符数直接切换至多行模式，避免为超长文本做昂贵的宽度测量
// Threshold: switch to multi-line mode directly when character count exceeds this value to avoid heavy layout work
const MAX_SINGLE_LINE_CHARACTERS = 800;

const SendBox: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  onSend: (message: string, skills?: string[]) => Promise<void>;
  onStop?: () => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  tools?: React.ReactNode;
  prefix?: React.ReactNode;
  placeholder?: string;
  onFilesAdded?: (files: FileMetadata[]) => void;
  supportedExts?: string[];
  defaultMultiLine?: boolean;
  lockMultiLine?: boolean;
  /** Whether an element (e.g. ThoughtDisplay) is attached above the box, squaring the top corners */
  topAttached?: boolean;
  sendButtonPrefix?: React.ReactNode;
  slashCommands?: SlashCommandItem[];
  onSlashBuiltinCommand?: (name: string) => void;
  onSkillsChange?: (skills: string[]) => void;
  /** Initial selected skills restored from draft state */
  initialSelectedSkills?: string[];
  /** Workspace files for @ file references */
  workspaceFiles?: WorkspaceFileItem[];
  /** Called when a file is selected via @ selector, allowing parent to track the file */
  onAtFileSelected?: (file: WorkspaceFileItem) => void;
}> = ({
  onSend,
  onStop,
  prefix,
  className,
  loading,
  tools,
  disabled,
  placeholder,
  value: input = '',
  onChange: setInput = constVoid,
  onFilesAdded,
  supportedExts = allSupportedExts,
  defaultMultiLine = false,
  lockMultiLine = false,
  topAttached = false,
  sendButtonPrefix,
  slashCommands = [],
  onSlashBuiltinCommand,
  onSkillsChange,
  initialSelectedSkills = [],
  workspaceFiles,
  onAtFileSelected,
}) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isSingleLine, setIsSingleLine] = useState(!defaultMultiLine);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isInputActive = isInputFocused;
  const { activeBorderColor, inactiveBorderColor, activeShadow } = useInputFocusRing();
  const containerRef = useRef<HTMLDivElement>(null);
  const singleLineWidthRef = useRef<number>(0);
  const measurementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestInputRef = useLatestRef(input);
  const setInputRef = useLatestRef(setInput);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const target = e.currentTarget as HTMLTextAreaElement;
      const items: ContextMenuItem[] = [
        {
          label: t('common.paste', { defaultValue: 'Paste' }),
          icon: <IconPaste />,
          onClick: async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text && target) {
                const cursorPosition = target.selectionStart ?? target.value.length;
                const currentValue = target.value;
                const start = target.selectionStart ?? target.value.length;
                const end = target.selectionEnd ?? start;
                const newValue = currentValue.slice(0, start) + text + currentValue.slice(end);

                // Use input ref setter to ensure state is updated
                setInput(newValue);

                // Focus and set cursor position after insertion
                setTimeout(() => {
                  target.focus();
                  const newCursorPos = cursorPosition + text.length;
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
    },
    [setInput, t]
  );

  // 集成预览面板的"添加到聊天"功能 / Integrate preview panel's "Add to chat" functionality
  const { setSendBoxHandler, domSnippets, removeDomSnippet, clearDomSnippets } = usePreviewContext();

  // 注册处理器以接收来自预览面板的文本 / Register handler to receive text from preview panel
  useEffect(() => {
    const handler = (text: string) => {
      const base = latestInputRef.current;
      const newValue = base ? `${base}\n\n${text}` : text;
      setInputRef.current(newValue);
    };
    setSendBoxHandler(handler);
    return () => {
      setSendBoxHandler(null);
    };
  }, [latestInputRef, setInputRef, setSendBoxHandler]);

  // 初始化时获取单行输入框的可用宽度
  // Initialize and get the available width of single-line input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (containerRef.current && singleLineWidthRef.current === 0) {
        const textarea = containerRef.current.querySelector('textarea');
        if (textarea) {
          // 保存单行模式下的可用宽度作为固定基准
          // Save the available width in single-line mode as a fixed baseline
          singleLineWidthRef.current = textarea.offsetWidth;
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // 检测是否单行
  // Detect whether to use single-line or multi-line mode
  useEffect(() => {
    // 有换行符直接多行
    // Switch to multi-line mode if newline character exists
    if (input.includes('\n')) {
      setIsSingleLine(false);
      return;
    }

    // 还没获取到基准宽度时不做判断
    // Skip detection if baseline width is not yet obtained
    if (singleLineWidthRef.current === 0) {
      return;
    }

    // 长文本无需测量，直接切换多行，防止创建超宽 DOM 触发长时间布局计算
    // Skip measurement for long text and switch to multi-line immediately to avoid expensive layout caused by extra-wide DOM
    if (input.length >= MAX_SINGLE_LINE_CHARACTERS) {
      setIsSingleLine(false);
      return;
    }

    // 检测内容宽度
    // Detect content width
    const frame = requestAnimationFrame(() => {
      const textarea = containerRef.current?.querySelector('textarea');
      if (!textarea) {
        return;
      }

      // 复用单个离屏 canvas，防止持续创建/销毁元素
      // Reuse a single offscreen canvas to avoid creating/destroying DOM nodes repeatedly
      const canvas = measurementCanvasRef.current ?? document.createElement('canvas');
      if (!measurementCanvasRef.current) {
        measurementCanvasRef.current = canvas;
      }
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      const textareaStyle = getComputedStyle(textarea);
      const fallbackFontSize = textareaStyle.fontSize || '14px';
      const fallbackFontFamily = textareaStyle.fontFamily || 'sans-serif';
      context.font = textareaStyle.font || `${fallbackFontSize} ${fallbackFontFamily}`.trim();

      const textWidth = context.measureText(input || '').width;

      // 使用初始化时保存的固定宽度作为判断基准
      // Use the fixed baseline width saved during initialization
      const baseWidth = singleLineWidthRef.current;

      // 文本宽度超过基准宽度时切换到多行
      // Switch to multi-line when text width exceeds baseline width
      if (textWidth >= baseWidth) {
        setIsSingleLine(false);
      } else if (textWidth < baseWidth - 30 && !lockMultiLine) {
        // 文本宽度小于基准宽度减30px时切回单行，留出小缓冲区避免临界点抖动
        // 如果 lockMultiLine 为 true，则不切换回单行
        // Switch back to single-line when text width is less than baseline minus 30px, leaving a small buffer to avoid flickering at the threshold
        // If lockMultiLine is true, do not switch back to single-line
        setIsSingleLine(true);
      }
      // 在 (baseWidth-30) 到 baseWidth 之间保持当前状态
      // Maintain current state between (baseWidth-30) and baseWidth
    });

    return () => cancelAnimationFrame(frame);
  }, [input, lockMultiLine]);

  // 使用拖拽 hook
  const { isFileDragging, dragHandlers } = useDragUpload({
    supportedExts,
    onFilesAdded,
  });

  // Skill selector state
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(() => initialSelectedSkills);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [isSkillPopoverOpen, setIsSkillPopoverOpen] = useState(false);

  // Fetch installed skills on mount and after agent-created skills are installed.
  useEffect(() => {
    const fetchInstalledSkills = async () => {
      if (!isElectronDesktop()) return;
      setLoadingSkills(true);
      try {
        const res = await skillHub.getInstalledSkills.invoke();
        if (res.success && res.data) {
          setInstalledSkills(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch installed skills:', err);
      } finally {
        setLoadingSkills(false);
      }
    };
    void fetchInstalledSkills();

    const removeSkillsChanged = addEventListener('skills.changed', () => {
      void fetchInstalledSkills();
    });

    return () => {
      removeSkillsChanged();
    };
  }, []);

  // Notify parent when skills change
  useEffect(() => {
    onSkillsChange?.(selectedSkills);
  }, [selectedSkills, onSkillsChange]);

  const builtinSlashCommands = useMemo<SlashCommandItem[]>(() => {
    if (!onSlashBuiltinCommand) {
      return [];
    }
    return [
      {
        name: 'open',
        description: t('conversation.workspace.addFile', { defaultValue: 'Add File' }),
        kind: 'builtin',
        source: 'builtin',
      },
    ];
  }, [onSlashBuiltinCommand, t]);

  const mergedSlashCommands = useMemo(() => {
    const map = new Map<string, SlashCommandItem>();
    for (const command of builtinSlashCommands) {
      map.set(command.name, command);
    }
    for (const command of slashCommands) {
      if (!map.has(command.name)) {
        map.set(command.name, command);
      }
    }
    return Array.from(map.values());
  }, [builtinSlashCommands, slashCommands]);

  const slashController = useSlashCommandController({
    input,
    commands: mergedSlashCommands,
    onExecuteBuiltin: (name) => {
      onSlashBuiltinCommand?.(name);
      setInput('');
    },
    onSelectTemplate: (name) => {
      setInput(`/${name} `);
    },
  });

  const slashMenuItems = useMemo<SlashCommandMenuItem[]>(
    () =>
      slashController.filteredCommands.map((command) => ({
        key: command.name,
        label: `/${command.name}`,
        description: command.description,
        badge: command.hint,
      })),
    [slashController.filteredCommands]
  );

  // Transform installed skills to selector items (only enabled skills)
  const skillSelectorItems = useMemo<SkillSelectorItem[]>(() => {
    const items = installedSkills
      .filter((skill) => skill.enabled !== false)
      .map((skill) => {
        const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
        return {
          name: skill.name,
          displayName,
          description,
          icon: icon || resolveSkillIcon(skill.meta?.icon),
          emoji,
          enabled: skill.enabled,
        };
      });
    // Deduplicate items by name to prevent duplicate keys
    return Array.from(new Map(items.map((item) => [item.name, item])).values());
  }, [installedSkills]);

  const skillSelectorController = useSkillSelectorController({
    input,
    cursorPosition,
    selectedSkills,
    onRemoveSkill: (skillName) => {
      setSelectedSkills(selectedSkills.filter((s) => s !== skillName));
    },
  });

  const onSkillPopoverClose = useCallback(() => {
    setIsSkillPopoverOpen(false);
  }, []);

  // Sync skill selector open state from @ trigger
  useEffect(() => {
    if (skillSelectorController.isOpen) {
      setIsSkillPopoverOpen(true);
    }
  }, [skillSelectorController.isOpen]);

  // Skill trigger button - shown when running in Electron desktop
  const skillTriggerButton = isElectronDesktop() ? (
    <SkillSelectorPopover
      popupVisible={isSkillPopoverOpen}
      onVisibleChange={(v) => {
        if (!v) onSkillPopoverClose();
      }}
      onAfterClose={() => containerRef.current?.querySelector('textarea')?.focus()}
      skills={skillSelectorItems}
      selectedKeys={selectedSkills}
      loading={loadingSkills}
      onSelectItem={(skill) => {
        if (!selectedSkills.includes(skill.name)) {
          setSelectedSkills((prev) => [...prev, skill.name]);
        }
        // Strip @query from input when opened via @ trigger (safe no-op if no @ in input)
        setInput(stripAtQuery(input, cursorPosition));
        if (skillSelectorController.isOpen) {
          skillSelectorController.setDismissed(true);
        }
        onSkillPopoverClose();
      }}
      onDismiss={() => {
        setInput(stripAtQuery(input, cursorPosition));
        if (skillSelectorController.isOpen) {
          skillSelectorController.setDismissed(true);
        }
        onSkillPopoverClose();
      }}
      workspaceFiles={workspaceFiles ?? undefined}
      onSelectFile={(file) => {
        if (skillSelectorController.isOpen) {
          // Opened via @ trigger: replace @query with @filepath
          const newInput = replaceAtQuery(input, `@${file.relativePath}`, cursorPosition);
          setInput(newInput);
          skillSelectorController.setDismissed(true);
        }
        onAtFileSelected?.(file);
        onSkillPopoverClose();
      }}
    >
      <Tooltip content={t('conversation.welcome.addSkill', { defaultValue: '添加技能 / 文件' })} position='top'>
        <span className='inline-flex ml-3'>
          <ActionChip icon={<span className='text-14px font-700 leading-none'>@</span>} label={t('messages.skills.triggerLabel', { defaultValue: 'Skills / Files' })} onClick={() => setIsSkillPopoverOpen(true)} />
        </span>
      </Tooltip>
    </SkillSelectorPopover>
  ) : null;

  // 使用共享的输入法合成处理
  const { compositionHandlers, createKeyDownHandler } = useCompositionInput();

  // 使用共享的PasteService集成
  const { onPaste, onFocus: handlePasteFocus } = usePasteService({
    supportedExts,
    onFilesAdded,
    onTextPaste: (text: string) => {
      // 处理清理后的文本粘贴，在当前光标位置插入文本而不是替换整个内容
      const textarea = document.activeElement as HTMLTextAreaElement;
      if (textarea && textarea.tagName === 'TEXTAREA') {
        const cursorPosition = textarea.selectionStart;
        const currentValue = textarea.value;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        const newValue = currentValue.slice(0, start) + text + currentValue.slice(end);
        setInput(newValue);
        // 设置光标到插入文本后的位置
        setTimeout(() => {
          textarea.setSelectionRange(cursorPosition + text.length, cursorPosition + text.length);
        }, 0);
      } else {
        // 如果无法获取光标位置，回退到追加到末尾的行为
        setInput(text);
      }
    },
  });
  const handleInputFocus = useCallback(() => {
    handlePasteFocus();
    setIsInputFocused(true);
  }, [handlePasteFocus]);
  const handleInputBlur = useCallback(() => {
    setIsInputFocused(false);
  }, []);

  const sendMessageHandler = () => {
    if (loading || isLoading) {
      Message.warning(t('messages.conversationInProgress'));
      return;
    }
    if (!input.trim() && domSnippets.length === 0) {
      return;
    }
    setIsLoading(true);

    // 构建消息内容：如果有 DOM 片段，附加完整 HTML / Build message: if has DOM snippets, append full HTML
    let finalMessage = input;
    if (domSnippets.length > 0) {
      const snippetsHtml = domSnippets.map((s) => `\n\n---\nDOM Snippet (${s.tag}):\n\`\`\`html\n${s.html}\n\`\`\``).join('');
      finalMessage = input + snippetsHtml;
    }

    // 立即清空输入框和技能，避免异步 onSend 完成后覆盖用户新输入
    // Clear input and skills immediately to prevent async onSend completion from overwriting new user input
    const skillsToSend = [...selectedSkills];
    setInput('');
    setSelectedSkills([]);
    clearDomSnippets();

    onSend(finalMessage, skillsToSend)
      .then(() => {})
      .catch((error) => {
        console.error('[SendBox] Error in onSend', error);
      })
      .finally(() => {
        // 只有在组件仍挂载的情况下才更新状态
        setIsLoading(false);
      });
  };

  const stopHandler = async () => {
    if (!onStop || isStopping) return;
    setIsStopping(true);
    try {
      await onStop();
    } finally {
      setIsLoading(false);
      setIsStopping(false);
    }
  };

  // Calculate button disabled state and style
  const isButtonDisabled = disabled || isStopping || (!input.trim() && domSnippets.length === 0);

  // Reusable send button component
  const sendButton = (
    <Button
      shape='circle'
      type='primary'
      disabled={isButtonDisabled}
      icon={<ArrowUp theme='filled' fill='white' strokeWidth={4} />}
      onClick={() => {
        sendMessageHandler();
      }}
    />
  );

  return (
    <div className={className}>
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
      <div
        ref={containerRef}
        className={`relative p-16px b bg-fill-1 b-solid flex flex-col ${slashController.isOpen ? 'overflow-visible' : 'overflow-hidden'} ${isFileDragging ? 'b-dashed' : ''}`}
        style={{
          transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
          borderRadius: topAttached ? '0 0 20px 20px' : '20px',
          ...(isFileDragging
            ? {
                backgroundColor: 'rgba(var(--ui-accent-orange-rgb), 0.08)',
                borderColor: 'rgba(var(--ui-accent-orange-rgb), 0.42)',
                borderWidth: '1px',
                borderTopWidth: topAttached ? 0 : '1px',
              }
            : {
                borderWidth: '1px',
                borderTopWidth: topAttached ? 0 : '1px',
                borderColor: isInputActive ? activeBorderColor : inactiveBorderColor,
                boxShadow: isInputActive ? activeShadow : 'none',
              }),
        }}
        {...dragHandlers}
      >
        {/* Slash Command Menu */}
        {slashController.isOpen && (
          <div className='absolute left-12px right-12px bottom-[calc(100%+8px)] z-70'>
            <SlashCommandMenu
              title={t('messages.slash.title', { defaultValue: 'Commands' })}
              hint={t('messages.slash.hint', { defaultValue: 'Type / to open command menu' })}
              items={slashMenuItems}
              activeIndex={slashController.activeIndex}
              loading={false}
              onHoverItem={slashController.setActiveIndex}
              onSelectItem={(item) => {
                const targetIndex = slashController.filteredCommands.findIndex((command) => command.name === item.key);
                if (targetIndex >= 0) {
                  slashController.onSelectByIndex(targetIndex);
                }
              }}
            />
          </div>
        )}
        <div style={{ width: '100%' }}>
          {prefix}
          {/* DOM 片段标签 / DOM snippet tags */}
          {domSnippets.length > 0 && (
            <div className='flex flex-wrap gap-6px mb-8px'>
              {domSnippets.map((snippet) => (
                <Tag key={snippet.id} closable closeIcon={<CloseSmall theme='outline' size='12' />} onClose={() => removeDomSnippet(snippet.id)} className='text-12px bg-fill-2 b-1 b-solid b-border-2 rd-4px'>
                  {snippet.tag}
                </Tag>
              ))}
            </div>
          )}
          {/* Skill tags - displayed above input */}
          {selectedSkills.length > 0 && (
            <div className='flex flex-col gap-6px mb-8px'>
              <div className='flex items-center gap-4px text-11px text-secondary'>
                <Lightning size='12' className='text-[var(--ui-accent-orange)]' />
                <span>{t('messages.skills.activeSkills', { defaultValue: '当前使用技能' })}</span>
              </div>
              <div className='flex flex-wrap gap-6px'>
                {selectedSkills.map((skillName) => {
                  const skillInfo = installedSkills.find((s) => s.name === skillName);
                  const displayName =
                    skillInfo?.meta?.display_name ||
                    skillName
                      .split(/[-_]/)
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ');
                  return (
                    <Tag key={skillName} closable onClose={() => setSelectedSkills(selectedSkills.filter((s) => s !== skillName))} className='text-12px rd-full' icon={<Lightning size='12' className='mr-4px text-[var(--ui-accent-orange)]' />}>
                      {displayName}
                    </Tag>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className={isSingleLine ? 'flex items-center gap-2 w-full min-w-0 overflow-hidden' : 'w-full overflow-hidden'}>
          {isSingleLine && (
            <div className='flex-shrink-0 sendbox-tools flex items-center'>
              {tools}
              {skillTriggerButton}
            </div>
          )}
          <Input.TextArea
            autoFocus={true}
            disabled={disabled}
            value={input}
            placeholder={placeholder}
            className='pl-0 pr-0 !b-none focus:shadow-none m-0 !bg-transparent !focus:bg-transparent !hover:bg-transparent lh-[20px] !resize-none text-14px'
            style={{
              width: isSingleLine ? 'auto' : '100%',
              flex: isSingleLine ? 1 : 'none',
              minWidth: 0,
              maxWidth: '100%',
              marginLeft: 0,
              marginRight: 0,
              marginBottom: isSingleLine ? 0 : '8px',
              height: isSingleLine ? '20px' : 'auto',
              minHeight: isSingleLine ? '20px' : '80px',
              overflowY: isSingleLine ? 'hidden' : 'auto',
              overflowX: 'hidden',
              whiteSpace: isSingleLine ? 'nowrap' : 'pre-wrap',
              textOverflow: isSingleLine ? 'ellipsis' : 'clip',
              wordBreak: isSingleLine ? 'normal' : 'break-word',
              overflowWrap: 'break-word',
            }}
            onChange={(v) => {
              setInput(v);
            }}
            onSelect={(e) => {
              const target = e.currentTarget as HTMLTextAreaElement;
              setCursorPosition(target.selectionStart);
            }}
            onPaste={onPaste}
            onContextMenu={handleContextMenu}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            {...compositionHandlers}
            autoSize={isSingleLine ? false : { minRows: 1, maxRows: 10 }}
            onKeyDown={createKeyDownHandler(sendMessageHandler, (event) => {
              // Try skill selector first (for @), then slash command (for /)
              if (skillSelectorController.isOpen) {
                return skillSelectorController.onKeyDown(event);
              }
              if (slashController.isOpen) {
                return slashController.onKeyDown(event);
              }
              return false;
            })}
          ></Input.TextArea>
          {isSingleLine && (
            <div className='flex items-center gap-3'>
              {sendButtonPrefix}
              {isLoading || loading ? <Button shape='circle' type='secondary' className='bg-animate' disabled={isStopping} icon={<div className='mx-auto size-12px bg-6'></div>} onClick={stopHandler}></Button> : sendButton}
            </div>
          )}
        </div>
        {!isSingleLine && (
          <div className='flex items-center justify-between gap-2 w-full'>
            <div className='sendbox-tools flex items-center'>
              {tools}
              {skillTriggerButton}
            </div>
            <div className='flex items-center gap-3'>
              {sendButtonPrefix}
              {isLoading || loading ? <Button shape='circle' type='secondary' className='bg-animate' disabled={isStopping} icon={<div className='mx-auto size-12px bg-6'></div>} onClick={stopHandler}></Button> : sendButton}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SendBox;
