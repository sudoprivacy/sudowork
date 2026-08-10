import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import AssetLibrarySkeleton from '@renderer/pages/asset-library/components/AssetLibrarySkeleton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Loading' }),
}));

describe('AssetLibrarySkeleton', () => {
  it('renders loading placeholders matching the asset grid', () => {
    render(<AssetLibrarySkeleton />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getAllByTestId('asset-library-skeleton-item')).toHaveLength(6);
  });
});
