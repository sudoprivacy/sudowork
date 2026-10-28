import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import SessionCompositionSelector from '@renderer/pages/guid/components/SessionCompositionSelector';
import HistoryViewSelector from '@renderer/pages/conversation/components/HistoryViewSelector';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

describe('shared session navigation', () => {
  it('opens both selectors with a real click and preserves independent choices', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [personalAgentRef, setPersonalAgentRef] = useState('moss-agent:own:alice');
      const [templateRef, setTemplateRef] = useState<string>();
      return (
        <SessionCompositionSelector
          agents={[
            { ref: 'moss-agent:own:alice', displayName: 'Alice', kind: 'own' },
            { ref: 'moss-agent:own:bob', displayName: 'Bob', kind: 'own' },
          ]}
          templates={[{ id: 'recruiter', name: 'Recruiter', enabled: true }]}
          personalAgentRef={personalAgentRef}
          templateRef={templateRef}
          onPersonalAgentChange={setPersonalAgentRef}
          onTemplateChange={setTemplateRef}
        />
      );
    }
    render(<Harness />);
    const agent = screen.getByRole('combobox', { name: 'guid.sessionComposition.agent' });
    const template = screen.getByRole('combobox', { name: 'guid.sessionComposition.template' });
    await user.click(agent);
    expect(agent.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(await screen.findByText('Bob'));
    await user.click(template);
    expect(template.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(await screen.findByText('Recruiter'));
    expect(agent.textContent).toContain('Bob');
    expect(template.textContent).toContain('Recruiter');
  });

  it('keeps both primary views visible and gives scheduled tasks an explicit button', () => {
    const onChange = vi.fn();
    render(<HistoryViewSelector value='agents' isCronVisible onChange={onChange} />);
    fireEvent.click(screen.getByText('conversation.sidebar.sessions'));
    expect(onChange).toHaveBeenCalledWith('timeline');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.history.scheduledTab' }));
    expect(onChange).toHaveBeenLastCalledWith('scheduled');
  });

  it('keeps the full radio names and native keyboard navigation in the compact selector', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<'agents' | 'timeline' | 'scheduled'>('agents');
      return <HistoryViewSelector value={value} isCronVisible onChange={setValue} />;
    }
    render(<Harness />);
    const agents = screen.getByRole('radio', { name: 'conversation.sidebar.agents' });
    const sessions = screen.getByRole('radio', { name: 'conversation.sidebar.sessions' });
    await user.click(agents);
    await user.keyboard('{ArrowRight}');
    expect(sessions).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'conversation.history.scheduledTab' }));
    expect(agents).not.toBeChecked();
    expect(sessions).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'conversation.history.scheduledTab' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(agents);
    expect(agents).toBeChecked();
  });

  it('keeps separate selectors independent and omits unavailable scheduled tasks', () => {
    render(
      <>
        <HistoryViewSelector value='agents' isCronVisible={false} onChange={vi.fn()} />
        <HistoryViewSelector value='timeline' isCronVisible={false} onChange={vi.fn()} />
      </>
    );
    const [first, second] = screen.getAllByRole('radio', { name: 'conversation.sidebar.agents' });
    expect(first.getAttribute('name')).not.toBe(second.getAttribute('name'));
    expect(screen.queryByRole('button', { name: 'conversation.history.scheduledTab' })).toBeNull();
  });

  it('keeps a personal identity selected when the task template changes', async () => {
    function Harness() {
      const [templateRef, setTemplateRef] = useState<string>();
      return (
        <>
          <SessionCompositionSelector
            agents={[
              { ref: 'moss-agent:own:alice', displayName: 'Alice', kind: 'own' },
              { ref: 'legacy-template', displayName: 'Legacy instance', kind: 'template' },
            ]}
            templates={[{ id: 'recruiter', name: 'Recruiter', enabled: true }]}
            personalAgentRef='moss-agent:own:alice'
            templateRef={templateRef}
            onPersonalAgentChange={vi.fn()}
            onTemplateChange={setTemplateRef}
          />
          <output>{templateRef || 'no-template'}</output>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Legacy instance')).toBeNull();
    fireEvent.click(screen.getByLabelText('guid.sessionComposition.template'));
    fireEvent.click(await screen.findByText('Recruiter'));
    expect(screen.getByRole('status').textContent).toBe('recruiter');
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows local preferred identities in the local execution selector', async () => {
    render(
      <SessionCompositionSelector
        sessionMode='local'
        agents={[
          { ref: 'moss-agent:own:server', displayName: 'Server', kind: 'own', executionType: 'server' },
          { ref: 'sudowork-agent:local:local', displayName: 'Local', kind: 'own', executionType: 'local' },
        ]}
        templates={[]}
        personalAgentRef='sudowork-agent:local:local'
        onPersonalAgentChange={vi.fn()}
        onTemplateChange={vi.fn()}
      />
    );
    const agent = screen.getByRole('combobox', { name: 'guid.sessionComposition.localAgent' });
    await userEvent.click(agent);
    expect(screen.getAllByText('Local')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: 'Server' })).toBeNull();
  });
});
