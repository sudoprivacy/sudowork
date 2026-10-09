import { describe, expect, it } from 'vitest';
import { isOntologyConversation, ontologyConversationPath } from '@sudowork/common/conversationPurpose';

describe('ontology conversation ownership', () => {
  it('keeps business purpose independent of the backend', () => {
    expect(isOntologyConversation({ extra: { backend: 'scode' } })).toBe(false);
    expect(isOntologyConversation({ extra: { purpose: 'general', ontologyId: 'x' } })).toBe(false);
    expect(isOntologyConversation({ extra: { purpose: 'ontology', ontologyId: 'x' } })).toBe(true);
  });
  it('routes conversations inside their owning ontology', () => {
    expect(ontologyConversationPath({ id: 'chat/1', extra: { purpose: 'ontology', ontologyId: 'customer/a' } })).toBe('/app/ontology/customer%2Fa/model?sessionId=chat%2F1');
    expect(ontologyConversationPath({ id: 'ordinary', extra: {} })).toBeUndefined();
  });
});
