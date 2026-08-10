import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import AssetLibraryPage from '@renderer/pages/asset-library';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Asset Library' }),
}));

describe('AssetLibraryPage', () => {
  it('renders the page title', () => {
    render(<AssetLibraryPage />);
    expect(screen.getByRole('heading', { name: 'Asset Library' })).toBeInTheDocument();
  });
});
