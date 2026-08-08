import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { TChatConversation } from '@/common/storage';

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { getFileMetadata: { invoke: vi.fn() } },
    shell: { openFile: { invoke: vi.fn() } },
  },
}));

vi.mock('@/renderer/hooks/useTerminalActiveCount', () => ({
  useTerminalActiveCount: () => 0,
}));

vi.mock('@/renderer/pages/cron/components/CronStatusIcon', () => ({
  default: () => null,
}));

vi.mock('@/renderer/utils/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({}),
}));

vi.mock('@/renderer/pages/conversation/grouped-history/utils/groupingHelpers', () => ({
  isConversationPinned: () => false,
}));

vi.mock('@/renderer/components/FlexFullContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(
    ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
      <div data-testid='conversation-menu' style={style}>
        {children}
      </div>
    ),
    {
      Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }
  );
  return {
    Checkbox: () => null,
    Dropdown: ({ droplist, children }: { droplist: React.ReactNode; children: React.ReactNode }) => (
      <>
        {children}
        {droplist}
      </>
    ),
    Menu,
    Message: { error: vi.fn() },
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('lucide-react', () => ({
  FolderOpen: () => null,
  LoaderCircle: () => null,
  MessageCircleMore: () => null,
  Pencil: () => null,
  Pin: () => null,
  Trash2: () => null,
  Upload: () => null,
}));

import ConversationRow from '@/renderer/pages/conversation/grouped-history/ConversationRow';

const conversation = {
  id: 'conversation-1',
  name: 'Scode conversation',
  type: 'acp',
  createTime: 1,
  modifyTime: 1,
  extra: {
    backend: 'scode',
    workspace: '/tmp/scode-temp-1',
  },
} as TChatConversation;

describe('ConversationRow diagnostics', () => {
  it('shows Scode workspace diagnostic folders in the conversation menu', () => {
    render(
      <ConversationRow
        conversation={conversation}
        collapsed={false}
        tooltipEnabled={false}
        batchMode={false}
        checked={false}
        selected={false}
        menuVisible
        onToggleChecked={vi.fn()}
        onConversationClick={vi.fn()}
        onOpenMenu={vi.fn()}
        onMenuVisibleChange={vi.fn()}
        onEditStart={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onTogglePin={vi.fn()}
        getJobStatus={() => 'none' as never}
      />
    );

    expect(screen.getByText('conversation.history.openWorkspace')).toBeInTheDocument();
    expect(screen.getByText('conversation.history.openWorkspaceParent')).toBeInTheDocument();
    expect(screen.getByText('conversation.history.openDrafts')).toBeInTheDocument();
    expect(screen.getByText('conversation.history.openScodeSessions')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-menu')).toHaveStyle({ maxHeight: 'none', overflow: 'visible' });
  });
});
