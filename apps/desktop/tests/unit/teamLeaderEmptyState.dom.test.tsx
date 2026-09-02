/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'team.detail.empty.subtitle': 'Describe your goal',
        'team.detail.empty.prompt.productDevQaOps': 'Ship a feature together',
        'team.detail.empty.prompt.growth': 'Plan growth together',
        'team.detail.empty.prompt.delivery': 'Deliver a project together',
      };
      return values[key] ?? key;
    },
  }),
}));

import TeamLeaderEmptyState from '../../src/renderer/pages/team/components/TeamLeaderEmptyState';

describe('TeamLeaderEmptyState', () => {
  it('renders assistant identity and team scenario prompts', () => {
    render(<TeamLeaderEmptyState assistantName='Sudo Code' assistantBackend='scode' onPromptClick={vi.fn()} />);

    expect(screen.getByText('Sudo Code')).toBeInTheDocument();
    expect(screen.getByText('Describe your goal')).toBeInTheDocument();
    expect(screen.getByText('Ship a feature together')).toBeInTheDocument();
    expect(screen.getByText('Plan growth together')).toBeInTheDocument();
    expect(screen.getByText('Deliver a project together')).toBeInTheDocument();
  });

  it('fills the selected prompt without sending', () => {
    const onPromptClick = vi.fn();
    render(<TeamLeaderEmptyState assistantName='Sudo Code' onPromptClick={onPromptClick} />);

    fireEvent.click(screen.getByText('Plan growth together'));

    expect(onPromptClick).toHaveBeenCalledTimes(1);
    expect(onPromptClick).toHaveBeenCalledWith('Plan growth together');
  });
});
