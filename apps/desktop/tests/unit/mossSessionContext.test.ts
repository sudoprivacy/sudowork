import { describe, expect, it } from 'vitest';
import { getMossSessionAgentContext } from '@sudowork/common/mossSessionContext';

const session = {
  userId: 'alice',
  source: 'lark',
  assistantName: 'moss-agent:operator:verified-organization-owner',
  clientMetadata: {
    agent_manager_actor_id: 'alice',
    agent_manager_agent_name: 'moss-native-owner-identity',
    agent_manager_display_name: 'Moss',
    agent_manager_owner_name: 'Alice',
    secret: 'never-project',
  },
};

describe('Moss Session Agent presentation', () => {
  it('projects an owner Moss Session without changing the actual source or owner', () => {
    expect(getMossSessionAgentContext(session)).toEqual({
      ownerId: 'alice',
      ownerName: 'Alice',
      agentName: 'moss-native-owner-identity',
      displayName: 'Moss',
    });
    expect(session.source).toBe('lark');
    expect(session.userId).toBe('alice');
  });

  it('preserves the existing managed Agent presentation with a different initiating actor', () => {
    expect(getMossSessionAgentContext({ ...session, source: 'agent-manager', assistantName: 'ordinary-native-agent', clientMetadata: { ...session.clientMetadata, agent_manager_actor_id: 'admin' } })).toMatchObject({ ownerId: 'alice' });
  });

  it.each([
    { userId: undefined },
    { assistantName: 'moss-agent:user:alice' },
    { assistantName: 'template' },
    { clientMetadata: undefined },
    { clientMetadata: { ...session.clientMetadata, agent_manager_actor_id: 'other' } },
    { clientMetadata: { ...session.clientMetadata, agent_manager_agent_name: '' } },
    { clientMetadata: { ...session.clientMetadata, agent_manager_display_name: 7 } },
    { clientMetadata: { ...session.clientMetadata, agent_manager_owner_name: ' ' } },
  ])('does not reinterpret ordinary or incomplete records: %j', (fields) => {
    expect(getMossSessionAgentContext({ ...session, ...fields })).toBeNull();
  });
});
