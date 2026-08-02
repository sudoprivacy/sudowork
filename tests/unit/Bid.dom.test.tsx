import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import BidPage from '@renderer/pages/bid';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.siderMenu.bidGeneration': 'Bid generation',
        'common.bid.status': 'In development',
        'common.bid.headline': 'Turn complex bid requirements into a polished response',
        'common.bid.description': 'Import tender documents and draft a complete bid.',
        'common.bid.workflowTitle': 'Planned workflow',
        'common.bid.importTitle': 'Import tender files',
        'common.bid.importDescription': 'Identify key requirements.',
        'common.bid.outlineTitle': 'Plan the structure',
        'common.bid.outlineDescription': 'Build a clear response outline.',
        'common.bid.generateTitle': 'Draft with AI',
        'common.bid.generateDescription': 'Draft content and check for gaps.',
        'common.bid.capabilities': 'Planned capabilities',
        'common.bid.requirementExtraction': 'Requirement extraction',
        'common.bid.outlinePlanning': 'Outline planning',
        'common.bid.riskReview': 'Risk review',
        'common.bid.documentExport': 'Document export',
      })[key] || key,
  }),
}));

describe('BidPage', () => {
  it('previews the planned bid workflow', () => {
    render(<BidPage />);

    expect(screen.getByRole('heading', { name: 'Bid generation' })).toBeInTheDocument();
    expect(screen.getByText('In development')).toBeInTheDocument();
    expect(screen.getByText('Turn complex bid requirements into a polished response')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planned workflow' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planned capabilities' })).toBeInTheDocument();
    expect(screen.getByText('Import tender files')).toBeInTheDocument();
    expect(screen.getByText('Plan the structure')).toBeInTheDocument();
    expect(screen.getByText('Draft with AI')).toBeInTheDocument();
  });
});
