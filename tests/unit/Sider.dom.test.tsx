import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sider from '@renderer/layouts/components/Sider';

const mocks = vi.hoisted(() => ({
  pathname: '/guid',
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mocks.pathname, search: '', hash: '' }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.siderMenu.newConversation': 'New conversation',
        'common.siderMenu.bidGeneration': 'Bid generation',
        'common.siderMenu.assetLibrary': 'Asset Library',
      })[key] || key,
  }),
}));
vi.mock('@renderer/pages/conversation/WorkspaceGroupedHistory', () => ({ default: () => <div>History</div> }));
vi.mock('@renderer/layouts/components/SettingsSider', () => ({ default: () => <div>Settings</div> }));
vi.mock('@renderer/layouts/components/SiderFooter', () => ({ default: () => <div>Footer</div> }));

describe('Sider main menu', () => {
  beforeEach(() => {
    mocks.pathname = '/guid';
    mocks.navigate.mockReset();
  });

  it('renders new conversation as a menu item', () => {
    const onNewConversation = vi.fn();
    render(<Sider onNewConversation={onNewConversation} />);

    const newConversation = screen.getByRole('button', { name: 'New conversation' });
    fireEvent.click(newConversation);
    expect(onNewConversation).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('navigates to the bid page', () => {
    mocks.pathname = '/bid';
    render(<Sider onNewConversation={vi.fn()} />);

    const bid = screen.getByRole('button', { name: 'Bid generation' });
    fireEvent.click(bid);
    expect(mocks.navigate).toHaveBeenCalledWith('/bid');
  });

  it('navigates to the asset library page', () => {
    render(<Sider onNewConversation={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Asset Library' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/asset-library');
  });
});
