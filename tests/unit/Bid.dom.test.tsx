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
        'common.bid.headline': 'From procurement needs to a tender document, faster',
        'common.bid.description': 'Import procurement requirements and produce a tender document.',
        'common.bid.workflowTitle': 'Tender drafting workflow',
        'common.bid.importTitle': 'Import procurement requirements',
        'common.bid.importDescription': 'Identify the category and technical specs.',
        'common.bid.outlineTitle': 'Parameter compliance check',
        'common.bid.outlineDescription': 'Flag exclusionary or brand-locked clauses.',
        'common.bid.generateTitle': 'Produce the tender document',
        'common.bid.generateDescription': 'Generate a complete tender document from the requirements.',
        'common.bid.capabilities': 'Tender drafting capabilities',
        'common.bid.requirementExtraction': 'Requirement extraction',
        'common.bid.outlinePlanning': 'Structure planning',
        'common.bid.riskReview': 'Parameter compliance review',
        'common.bid.documentExport': 'Document export',
      })[key] || key,
  }),
}));

describe('BidPage', () => {
  it('previews the planned bid drafting workflow', () => {
    render(<BidPage />);

    expect(screen.getByRole('heading', { name: 'Bid generation' })).toBeInTheDocument();
    expect(screen.getByText('In development')).toBeInTheDocument();
    expect(screen.getByText('From procurement needs to a tender document, faster')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tender drafting workflow' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tender drafting capabilities' })).toBeInTheDocument();
    expect(screen.getByText('Import procurement requirements')).toBeInTheDocument();
    expect(screen.getByText('Parameter compliance check')).toBeInTheDocument();
    expect(screen.getByText('Produce the tender document')).toBeInTheDocument();
  });
});
