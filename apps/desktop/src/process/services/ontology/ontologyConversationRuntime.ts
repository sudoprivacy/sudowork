import { ontologyService } from './OntologyService';
import { prepareOntologyProject } from './ontologyProjectRuntime';
import type { ISudographContext } from './SudographModelClient';

export interface IOntologyConversationContext {
  purpose?: string;
  ontologyId?: string;
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
    const project = await prepareOntologyProject(input.ontologyId);
    const context =
      ontologyService.getModelAuthority(input.ontologyId) === 'sudograph'
        ? (await ontologyService.invokeSudograph<ISudographContext>(input.ontologyId, { operation: 'read', product: 'context' })).text
        : 'You are the ontology construction assistant for workspace ' + input.ontologyId + '. Verify changes and explain unresolved business definitions in the user language.';
    return { presetContext: context + '\n\n' + project.instructions, extraMcpConfigs };
  }
  const runtime = await ontologyService.getRegisteredAgentRuntime(input.presetAssistantId!);
  if (!runtime) throw new Error('ontology.studio.agentErrors.notFound');
  return { presetContext: runtime.presetContext, extraMcpConfigs };
}
