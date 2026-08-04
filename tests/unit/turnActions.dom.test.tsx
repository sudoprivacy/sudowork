import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const { mockCheckInstalled } = vi.hoisted(() => ({
  mockCheckInstalled: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    document: { saveAsDocx: { invoke: vi.fn() } },
    shareoneCli: {
      checkInstalled: { invoke: mockCheckInstalled },
      publishTurn: { invoke: vi.fn() },
    },
    shell: { showItemInFolder: { invoke: vi.fn() } },
  },
}));

vi.mock('@/renderer/utils/shareNotify', () => ({
  showShareLoading: vi.fn(),
  updateShareError: vi.fn(),
  updateShareSuccess: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { error: vi.fn(), success: vi.fn() },
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
  Copy: () => <span data-testid='copy-action' />,
  FileText: () => <span data-testid='word-action' />,
  Share2: () => <span data-testid='shareone-action' />,
}));

import TurnActions from '@/renderer/messages/TurnActions';

describe('TurnActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides ShareOne and skips its CLI check when disabled by brand', () => {
    render(<TurnActions turnTexts={['response']} turnTextsRaw={['response']} />);

    expect(screen.getByTestId('copy-action')).toBeInTheDocument();
    expect(screen.queryByTestId('shareone-action')).not.toBeInTheDocument();
    expect(mockCheckInstalled).not.toHaveBeenCalled();
  });
});
