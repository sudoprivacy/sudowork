import EventEmitter from 'eventemitter3';
import type { DependencyList } from 'react';
import { useEffect } from 'react';
import type { FileOrFolderItem } from '@/renderer/types/files';
import type { PreviewContentType } from '@/common/types/preview';

interface EventTypes {
  'gemini.selected.file': [Array<string | FileOrFolderItem>];
  'gemini.selected.file.append': [Array<string | FileOrFolderItem>];
  'gemini.selected.file.clear': void;
  'gemini.workspace.refresh': void;
  'acp.selected.file': [Array<string | FileOrFolderItem>];
  'acp.selected.file.append': [Array<string | FileOrFolderItem>];
  'acp.selected.file.clear': void;
  'acp.workspace.refresh': void;
  'codex.selected.file': [Array<string | FileOrFolderItem>];
  'codex.selected.file.append': [Array<string | FileOrFolderItem>];
  'codex.selected.file.clear': void;
  'codex.workspace.refresh': void;
  'remote-agent.selected.file': [string, Array<string | FileOrFolderItem>]; // typed for shared workspace listeners; remote workspace does not emit selected file refs
  'remote-agent.selected.file.clear': void;
  'remote-agent.workspace.refresh': void;
  'nanobot.selected.file': [Array<string | FileOrFolderItem>];
  'nanobot.selected.file.append': [Array<string | FileOrFolderItem>];
  'nanobot.selected.file.clear': void;
  'nanobot.workspace.refresh': void;
  'chat.history.refresh': void;
  'conversation.remote.sync': [string]; // conversationId
  'conversation.messages.refresh': [string]; // conversationId
  'sessionMode.changed': ['remote' | 'local'];
  // 会话删除事件 / Conversation deletion event
  'conversation.deleted': [string]; // conversationId
  // 预览面板事件 / Preview panel events
  'preview.open': [
    {
      content: string;
      contentType: PreviewContentType;
      metadata?: { title?: string; fileName?: string; filePath?: string; workspace?: string; language?: string; editable?: boolean };
    },
  ];
  // 填充输入框事件 / Fill sendbox input event
  'sendbox.fill': [string]; // prompt text to fill
  'agent.connection.status': [string, string]; // [conversationId, status]
  'staroffice.install.request': [{ conversationId: string; text: string; detectedUrl?: string | null }];
  'staroffice.install.finished': [{ conversationId: string }];
  // 技能列表变更事件 / Skills list changed event (install, uninstall, update, import, toggle)
  'skills.changed': void;
  // Assistants list/meta changed event (create, update, delete, toggle)
  'assistants.changed': void;
  // Guide 页面重置事件 / Guide page reset event (triggered by "New Conversation")
  'guid.reset': void;
  // Command palette events
  'commandPalette.open': void;
  'commandPalette.close': void;
  // Sidebar tab switch event (from command palette to switch sider tab)
  'sider.tab.switch': ['timeline' | 'scheduled'];
  // Open a URL in the right-panel BrowserPanel — fired when the AI writes an
  // HTML file or when slash / MCP tools request opening a URL there.
  'right-panel.browser.open': [{ url: string; switchTab?: boolean }];
  // Cron job list refresh (e.g. after delete from detail page)
  'cron.jobs.refresh': void;
}

export const emitter = new EventEmitter<EventTypes>();

export const addEventListener = <T extends EventEmitter.EventNames<EventTypes>>(event: T, fn: EventEmitter.EventListener<EventTypes, T>) => {
  emitter.on(event, fn);
  return () => {
    emitter.off(event, fn);
  };
};

export const useAddEventListener = <T extends EventEmitter.EventNames<EventTypes>>(event: T, fn: EventEmitter.EventListener<EventTypes, T>, deps?: DependencyList) => {
  useEffect(() => {
    return addEventListener(event, fn);
  }, deps || []);
};
