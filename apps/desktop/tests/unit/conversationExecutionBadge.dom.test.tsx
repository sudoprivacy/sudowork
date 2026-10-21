import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import ConversationExecutionBadge from '@renderer/pages/conversation/components/ConversationExecutionBadge';

afterEach(cleanup);

describe('conversation execution badge', () => {
  it.each([
    ['local', 'conversation.welcome.execution.local', 'conversation.header.localExecutionHint'],
    ['remote', 'conversation.welcome.execution.cloud', 'conversation.header.remoteExecutionHint'],
  ] as const)('shows an explicit %s execution label and accessible explanation', (target, label, hint) => {
    render(<ConversationExecutionBadge target={target} />);

    const badge = screen.getByTestId('conversation-execution-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('aria-label', `${label}：${hint}`);
    expect(badge).toHaveClass(`conversation-execution-badge--${target}`);
  });
});
