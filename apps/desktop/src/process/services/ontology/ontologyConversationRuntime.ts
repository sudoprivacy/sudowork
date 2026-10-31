import { ontologyService } from './OntologyService';
import { prepareOntologyProject } from './ontologyProjectRuntime';

export interface IOntologyConversationContext {
  purpose?: string;
  ontologyId?: string;
  conversation_id?: string;
  workspace?: string;
  acpSessionId?: string;
  presetAssistantId?: string;
  extraMcpConfigs?: Array<{ name: string; command: string; args?: string[]; env?: Array<{ name: string; value: string }> }>;
}

export function isOntologyConversation(input: IOntologyConversationContext): boolean {
  return input.purpose === 'ontology' || !!input.presetAssistantId?.startsWith('ontology-');
}

export async function prepareOntologyConversationRuntime(input: IOntologyConversationContext) {
  if (!isOntologyConversation(input)) return undefined;
  const extraMcpConfigs = (input.extraMcpConfigs || []).filter((server) => server.name !== 'ontology' && server.name !== 'ontology-builder');
  if (input.purpose === 'ontology') {
    if (!input.ontologyId) throw new Error('ontology.studio.errors.builderUnavailable');
    const workspaceId = input.ontologyId;
    const conversationId = input.conversation_id;
    const project = await prepareOntologyProject(workspaceId);
    const resolveContext = async () => {
      if (ontologyService.getModelAuthority(workspaceId) !== 'sudograph') throw new Error('The canonical model binding changed. Reopen the conversation before continuing.');
      if (!conversationId) throw new Error('Canonical context requires its owning conversation.');
      const context = await ontologyService.readStudioConversationContext({ workspaceId, conversationId });
      if (context?.format !== 'sudograph-agent-context/v1' || typeof context.revision !== 'string' || !context.revision.trim() || typeof context.context_digest !== 'string' || !context.context_digest.trim() || typeof context.text !== 'string' || !context.text.trim())
        throw new Error('The compiler returned an invalid agent context. No model turn was started.');
      return context.text + '\n\n' + project.instructions;
    };
    if (ontologyService.getModelAuthority(workspaceId) === 'sudograph') {
      return { presetContext: await resolveContext(), extraMcpConfigs, resolveContext };
    }
    const context = 'You are the ontology construction assistant for workspace ' + workspaceId + '. Verify changes and explain unresolved business definitions in the user language.';
    return { presetContext: context + '\n\n' + project.instructions, extraMcpConfigs };
  }
  const runtime = await ontologyService.getRegisteredAgentRuntime(input.presetAssistantId!);
  if (!runtime) throw new Error('ontology.studio.agentErrors.notFound');
  return { presetContext: runtime.presetContext, extraMcpConfigs };
}
