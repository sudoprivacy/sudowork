import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiderFooter from '@renderer/layouts/components/SiderFooter';

const mocks = vi.hoisted(() => ({
  isGuest: false,
  navigate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@renderer/context/AuthContext', () => ({
  useAuth: () => ({
    isGuest: mocks.isGuest,
    logout: mocks.logout,
    user: { nickname: 'Tester', phone: '13800138000' },
  }),
}));
vi.mock('@renderer/utils', () => ({ maskPhone: () => '138****8000' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.ariaLabel.accountMenu': 'Account menu',
        'common.backToMain': 'Back to Main',
        'common.settings': 'Settings',
        'login.logout': 'Log out',
        'settings.userProfile.defaultNickname': 'User',
      })[key] || key,
  }),
}));
vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(
    ({ children, onClickMenuItem }: { children: React.ReactNode; onClickMenuItem: (key: string) => void }) => (
      <div>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>, {
                onClick: () => onClickMenuItem(String(child.key)),
              })
            : child
        )}
      </div>
    ),
    { Item: ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }
  );
  return {
    Button: ({ children, long: _long, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { long?: boolean }) => <button {...props}>{children}</button>,
    Dropdown: ({ children, droplist }: { children: React.ReactNode; droplist: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Menu,
    Message: { success: vi.fn() },
  };
});

describe('SiderFooter', () => {
  beforeEach(() => {
    mocks.isGuest = false;
    mocks.navigate.mockReset();
    mocks.logout.mockReset();
  });

  it('puts Settings inside the account menu on normal pages', () => {
    render(<SiderFooter isSettings={false} onBackToMain={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/profile');
    expect(screen.queryByRole('button', { name: 'Back to Main' })).not.toBeInTheDocument();
  });

  it('replaces account information with Back to Main on settings pages', () => {
    const onBackToMain = vi.fn();
    render(<SiderFooter isSettings onBackToMain={onBackToMain} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to Main' }));
    expect(onBackToMain).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Settings/ })).not.toBeInTheDocument();
  });
});
