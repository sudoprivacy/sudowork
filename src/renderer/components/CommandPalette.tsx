/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Search, FileSuccess, History, Setting, Star } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TChatConversation } from '@/common/storage';
import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { getActivityTime } from '@/renderer/utils/timeline';
import { formatSessionTime } from '@/renderer/utils/messageTime';

interface CommandPaletteItem {
  id: string;
  type: 'conversation' | 'file' | 'skill' | 'setting' | 'action';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
  score?: number;
  tabKey?: 'timeline' | 'scheduled';
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ visible, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load conversations
  useEffect(() => {
    if (visible) {
      ipcBridge.database.getUserConversations
        .invoke({ page: 0, pageSize: 10000 })
        .then((history) => {
          if (history && Array.isArray(history)) {
            const sorted = history.sort((a, b) => getActivityTime(b) - getActivityTime(a));
            setConversations(sorted);
          }
        })
        .catch((error) => {
          console.error('Failed to load conversations:', error);
        });
    }
  }, [visible]);

  // Focus input when opened
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  // Reset state when closed
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [visible]);

  // Filter and score items
  const filteredItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [];
    const keyword = query.toLowerCase().trim();

    // Action commands - always show with Chinese defaults
    const actionCommands: CommandPaletteItem[] = [
      {
        id: 'new-conversation',
        type: 'action',
        title: '新会话',
        icon: <History size={18} />,
        action: () => {
          // Navigate to guid page (new conversation)
          void navigate('/guid');
          onClose();
        },
      },
      {
        id: 'settings',
        type: 'setting',
        title: '设置',
        icon: <Setting size={18} />,
        action: () => {
          void navigate('/settings/profile');
          onClose();
        },
      },
    ];

    // Always show action commands when query is empty or matches
    if (!keyword) {
      items.push(...actionCommands);
    } else {
      actionCommands.forEach((cmd) => {
        if (cmd.title.toLowerCase().includes(keyword) || (cmd.subtitle && cmd.subtitle.toLowerCase().includes(keyword))) {
          items.push({ ...cmd, score: 1 });
        }
      });
    }

    // Filter conversations
    if (keyword) {
      conversations.forEach((conv) => {
        const titleMatch = conv.name.toLowerCase().includes(keyword);
        const score = titleMatch ? 2 : 0;
        if (score > 0) {
          const activityTime = getActivityTime(conv);
          const tabKey: 'timeline' | 'scheduled' = (conv.extra as any)?.cronJobId ? 'scheduled' : 'timeline';
          items.push({
            id: `conv-${conv.id}`,
            type: 'conversation',
            title: conv.name,
            subtitle: formatSessionTime(activityTime, 'zh-CN', '昨天'),
            icon: <History size={18} />,
            action: () => {
              emitter.emit('sider.tab.switch', tabKey);
              void navigate(`/conversation/${conv.id}`);
              onClose();
            },
            score,
            tabKey,
          });
        }
      });
    }

    // Sort by score and type
    return items.sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      // Prioritize conversations over files
      const typeOrder = { action: 0, setting: 1, conversation: 2, file: 3, skill: 4 };
      return typeOrder[a.type] - typeOrder[b.type];
    });
  }, [query, conversations, navigate, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selectedItem = filteredItems[activeIndex];
        if (selectedItem) {
          selectedItem.action();
          onClose();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    [activeIndex, filteredItems, onClose]
  );

  const renderIcon = (item: CommandPaletteItem) => {
    switch (item.type) {
      case 'conversation':
        return <History size={18} className='text-blue-500' />;
      case 'file':
        return <FileSuccess size={18} className='text-green-500' />;
      case 'skill':
        return <Star size={18} className='text-purple-500' />;
      case 'setting':
        return <Setting size={18} className='text-gray-500' />;
      default:
        return item.icon;
    }
  };

  if (!visible) return null;

  return (
    <div className='fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh] bg-black/50' onClick={onClose}>
      <div className='w-full max-w-[600px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]' onClick={(e) => e.stopPropagation()}>
        {/* Search Input */}
        <div className='flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700'>
          <Search size={20} className='text-gray-400 dark:text-gray-500 shrink-0' />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder='搜索会话...' className='flex-1 text-base bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500' autoComplete='off' autoCorrect='off' autoCapitalize='off' spellCheck='false' />
        </div>

        {/* Results */}
        <div ref={listRef} className='flex-1 overflow-y-auto p-2'>
          {filteredItems.length === 0 ? (
            <div className='text-center py-8 text-gray-400 dark:text-gray-500 text-sm'>{query ? '没有找到相关结果' : '输入关键词搜索会话...'}</div>
          ) : (
            <div className='space-y-1'>
              {filteredItems.map((item, index) => (
                <div
                  key={item.id}
                  data-index={index}
                  className={classNames('flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors', index === activeIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50')}
                  onClick={() => {
                    setActiveIndex(index);
                    item.action();
                    onClose();
                  }}
                >
                  <div className='shrink-0'>{renderIcon(item)}</div>
                  <div className='flex-1 min-w-0'>
                    <div className='font-medium text-sm text-gray-900 dark:text-gray-100 truncate'>{item.title}</div>
                    {item.subtitle && <div className='text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5'>{item.subtitle}</div>}
                  </div>
                  {item.type === 'conversation' && <div className='text-xs text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded'>Enter</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 flex items-center justify-between'>
          <div className='flex items-center gap-4'>
            <span className='flex items-center gap-1'>
              <kbd className='px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]'>↑↓</kbd>
              <span>选择</span>
            </span>
            <span className='flex items-center gap-1'>
              <kbd className='px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]'>Enter</kbd>
              <span>打开</span>
            </span>
            <span className='flex items-center gap-1'>
              <kbd className='px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]'>Esc</kbd>
              <span>关闭</span>
            </span>
          </div>
          <span>{filteredItems.length} 结果</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
