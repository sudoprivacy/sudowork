import { describe, expect, it } from 'vitest';
import { personalAgentConfigs } from '@renderer/pages/guid/utils/personalAgentSelection';

describe('personal Agent selection', () => {
  it('keeps different identities with the same display name and removes repeated references', () => {
    const first = { ref: 'moss-agent:own:first', displayName: 'Assistant', kind: 'own' as const };
    const second = { ...first, ref: 'moss-agent:own:second' };
    expect(personalAgentConfigs([first, second, first], false).map((agent) => agent.id)).toEqual([first.ref, second.ref]);
  });
  it.each([true, false])('uses the chosen engine location without changing identity (local=%s)', (isLocal) => {
    const ref = 'moss-agent:user:current-user';
    expect(personalAgentConfigs([{ ref, displayName: 'My Agent', kind: 'default' }], isLocal)).toEqual([expect.objectContaining({ id: ref, presetAgentType: isLocal ? 'scode' : 'remote-agent' })]);
  });
  it('keeps templates and unrecognized references out of personal selections', () => {
    expect(
      personalAgentConfigs(
        [
          { ref: 'template-name', displayName: 'Template', kind: 'template' },
          { ref: 'forged', displayName: 'Agent', kind: 'own' },
        ],
        false
      )
    ).toEqual([]);
  });
});
