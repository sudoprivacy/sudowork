import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SkillSettings from '@renderer/pages/skills';

const state = vi.hoisted(() => ({ fetchSkills: vi.fn(), fetchCategories: vi.fn() }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true }) }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => false, isWebBridgeAvailable: () => true }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user', enterprise_code: 'org' }, isGuest: false }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  skillHub: {
    fetchSkills: { invoke: state.fetchSkills },
    fetchCategories: { invoke: state.fetchCategories },
    fetchSkillDetail: { invoke: async () => ({ success: true, data: { versions: [] } }) },
    changed: { on: () => () => undefined },
    getInstalledSkills: { invoke: async () => ({ success: true, data: [] }) },
  },
  eeclaw: {},
}));
vi.mock('@renderer/components/MossCatalogBrowser', () => ({ default: () => null }));
vi.mock('@renderer/pages/skills/components/SkillAuditReport', () => ({ SkillAuditDetailModal: () => null }));
vi.mock('@renderer/pages/skills/components/SkillAuditReportModal', () => ({ SkillAuditReportModal: () => null }));
vi.mock('@renderer/pages/skills/components/SkillDetailModal', () => ({ default: () => null }));
vi.mock('@renderer/pages/skills/components/InstalledSkillCard', () => ({ default: () => null }));
vi.mock('@renderer/pages/skills/components/SkillCard', () => ({
  default: function SkillCard({ skill }: ISkillCardProps) {
    return <div>{skill.name}</div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('loads the skill store for an online browser user instead of leaving the loading spinner', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ scopes: [] })))
  );
  state.fetchSkills.mockResolvedValue({ success: true, data: { skills: [{ id: 'writer', name: 'Published writer' }], has_more: false } });
  state.fetchCategories.mockResolvedValue({ success: true, data: ['Development'] });

  render(<SkillSettings />);

  expect(await screen.findByText('Published writer')).toBeTruthy();
  expect(screen.getByText('Development')).toBeTruthy();
  expect(state.fetchSkills).toHaveBeenCalledWith(expect.objectContaining({ limit: 40, category: '', query: '' }));
});

interface ISkillCardProps {
  skill: { name: string };
}
