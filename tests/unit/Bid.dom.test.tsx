import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import BidPage from '@renderer/pages/bid';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.siderMenu.bidGeneration': 'Bid generation',
        'common.comingSoon': 'Coming soon',
      })[key] || key,
  }),
}));
vi.mock('@renderer/components/base/EmptyState', () => ({
  default: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

describe('BidPage', () => {
  it('shows the coming soon state', () => {
    render(<BidPage />);

    expect(screen.getByRole('heading', { name: 'Bid generation' })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
