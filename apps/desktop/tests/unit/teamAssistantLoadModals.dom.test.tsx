import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamCreateModal from '../../src/renderer/pages/team/components/TeamCreateModal';
import TeamAddMemberModal from '../../src/renderer/pages/team/components/TeamAddMemberModal';

const mocks = vi.hoisted(() => ({
  listAssistants: vi.fn(),
  messageError: vi.fn(),
}));

// t must be referentially stable: the modals' load effect lists t in its deps, and a fresh t per
// render × setSelectedMembers([]) (new array identity each run) would re-fire the effect forever.
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

// Arco is stubbed entirely (not importActual): these tests exercise the load-failure data flow,
// not the UI — and rendering the real Modal/Form tree deadlocks in this jsdom setup.
vi.mock('@arco-design/web-react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const children = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children ?? null);
  return {
    Button: (props: { children?: React.ReactNode; onClick?: () => void }) => React.createElement('button', { onClick: props.onClick }, props.children ?? null),
    Form: children,
    Input: (props: { value?: string; onChange?: (v: string) => void; placeholder?: string }) => React.createElement('input', { value: props.value, placeholder: props.placeholder }),
    Message: { error: (...args: unknown[]) => mocks.messageError(...args) },
    Modal: children,
    Spin: children,
  };
});

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  team: {
    listAssistants: { invoke: (...args: unknown[]) => mocks.listAssistants(...args) },
  },
}));

// Stub the candidate card (svg/asset deps are irrelevant to the load-failure tests), but keep
// useFilteredCandidates/getCandidateDescription/renderCandidateIcon — the modals import them
// from the same module. setSearch is module-stable so the load effect does not re-fire per render.
vi.mock('../../src/renderer/pages/team/components/TeamAssistantCandidateCard', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const setSearch = vi.fn();
  return {
    default: () => React.createElement('div', { 'data-testid': 'candidate-card' }),
    getCandidateDescription: () => '',
    renderCandidateIcon: () => null,
    useFilteredCandidates: (list: unknown[]) => ({ search: '', setSearch, filtered: list }),
  };
});

beforeEach(() => {
  mocks.listAssistants.mockReset();
  mocks.messageError.mockReset();
});

describe('assistant-list load failure toasts (M7)', () => {
  it('TeamCreateModal surfaces a load-failed toast instead of an unhandled rejection', async () => {
    mocks.listAssistants.mockRejectedValue(new Error('assistant rpc down'));

    render(<TeamCreateModal isVisible onClose={() => undefined} onCreated={() => undefined} />);

    await waitFor(() => {
      expect(mocks.messageError).toHaveBeenCalledWith('team.create.loadAssistantsFailed');
    });
  });

  it('TeamAddMemberModal surfaces a load-failed toast instead of an unhandled rejection', async () => {
    mocks.listAssistants.mockRejectedValue(new Error('assistant rpc down'));

    render(<TeamAddMemberModal isVisible onClose={() => undefined} onAdded={() => undefined} />);

    await waitFor(() => {
      expect(mocks.messageError).toHaveBeenCalledWith('team.create.loadAssistantsFailed');
    });
  });

  it('a successful load stays silent (empty list renders the empty state)', async () => {
    mocks.listAssistants.mockResolvedValue([]);

    render(<TeamAddMemberModal isVisible onClose={() => undefined} onAdded={() => undefined} />);

    await waitFor(() => {
      expect(mocks.listAssistants).toHaveBeenCalled();
    });
    expect(mocks.messageError).not.toHaveBeenCalled();
  });
});
