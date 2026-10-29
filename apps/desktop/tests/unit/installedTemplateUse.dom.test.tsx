import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InstalledAssistantCard from '@renderer/pages/agents/components/InstalledAssistantCard';
import type { AssistantListItem } from '@renderer/pages/agents/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => false }));

afterEach(cleanup);

const assistant: AssistantListItem = {
  id: 'moss-agent:template:recruiter-id',
  name: 'Recruiter template',
  enabled: true,
  _isHubInstalled: true,
};

describe('installed template Use entry', () => {
  it('offers an accessible Use action and keeps its click separate from opening the template editor', () => {
    const onUse = vi.fn();
    const onClick = vi.fn();
    render(<InstalledAssistantCard assistant={assistant} isExtension={false} localeKey='en-US' onClick={onClick} onUse={onUse} onToggleEnabled={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.mossCatalog.use' }));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disables Use for a disabled installed template', () => {
    render(<InstalledAssistantCard assistant={{ ...assistant, enabled: false }} isExtension={false} localeKey='en-US' onClick={vi.fn()} onUse={vi.fn()} onToggleEnabled={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()} canManage={false} />);
    expect((screen.getByRole('button', { name: 'settings.mossCatalog.use' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the template viewer available when no launch callback is supplied', () => {
    const onClick = vi.fn();
    render(<InstalledAssistantCard assistant={assistant} isExtension={false} localeKey='en-US' onClick={onClick} onToggleEnabled={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()} canManage={false} />);
    expect(screen.queryByRole('button', { name: 'settings.mossCatalog.use' })).toBeNull();
    fireEvent.click(screen.getByTitle('Recruiter template'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
