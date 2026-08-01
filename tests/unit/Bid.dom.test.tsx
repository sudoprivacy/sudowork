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

describe('BidPage', () => {
  it('shows the coming soon state', () => {
    render(<BidPage />);

    expect(screen.getByRole('heading', { name: 'Bid generation' })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
