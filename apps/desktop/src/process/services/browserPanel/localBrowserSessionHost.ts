import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveAiDevBrowserPackageDir } from '@process/initStorage';
import { mainError } from '@process/utils/mainLogger';
import { getMcpScriptPath } from '../mcpServices/SudoworkBuiltinMcpRegistration';
import { getNodeBinaryPath } from '../claudeCli/NodeRuntimeService';
import { pythonRuntimeService } from '../python/PythonRuntimeService';
import { LocalBrowserSessions } from './LocalBrowserSessions';
import { localAgentToolControl } from './localToolControl';

let service: LocalBrowserSessions | undefined;

export function getLocalBrowserSessions(): LocalBrowserSessions {
  service ??= new LocalBrowserSessions({
    root: path.join(app.getPath('userData'), 'browser-sessions'),
    runtime: () => pythonRuntimeService.prepareBrowserWorkerRuntime(),
    tools: () => {
      const directory = resolveAiDevBrowserPackageDir();
      if (!directory) throw new Error('The bundled browser package is unavailable');
      return JSON.parse(readFileSync(path.join(directory, 'remote', 'mcp-tools.json'), 'utf8')) as unknown[];
    },
    control: localAgentToolControl,
    isConversationCurrent: async (conversationId) => {
      const { getDatabase } = await import('@process/database');
      const { isConversationInCurrentAccount } = await import('../mossExecutionContext');
      const conversation = getDatabase().getConversation(conversationId).data;
      return !!conversation && isConversationInCurrentAccount(conversation);
    },
    onReturn: async (conversationId, note, epoch) => {
      const { default: WorkerManage } = await import('../../WorkerManage');
      localAgentToolControl.assertCanPrompt(epoch);
      const task = await WorkerManage.getTaskByIdRollbackBuild(conversationId);
      localAgentToolControl.assertCanPrompt(epoch);
      if (!task || task.type !== 'acp') throw new Error('browser_return_notification_failed');
      const content =
        'The user has explicitly returned control of the shared browser. First call sudowork-browser browser_observe to read the current page and control epochs. Discard coordinates and pending inputs from before takeover. Cancelled jobs remain cancelled. Continue the original task from the current page when appropriate. ' +
        (note?.trim() ? `The user left this handoff note: ${note.trim().slice(0, 2000)}` : '');
      void task.sendMessage({ content, msg_id: randomUUID(), suppressUserBubble: true }).catch((error) => mainError('LocalBrowser', 'Browser returned; send a message if the continuation was not accepted', error));
    },
  });
  return service;
}

export async function closeLocalBrowserSessions(): Promise<void> {
  if (service) {
    await service.close();
    service = undefined;
  }
}

/** Called only after the account lifecycle has stopped its local engines. */
export async function retireLocalBrowserSessions(): Promise<void> {
  await localAgentToolControl.retireAfterShutdown(async () => {
    // Recover a persisted owner even when no UI has allocated a worker yet.
    if (localAgentToolControl.status().owner) getLocalBrowserSessions();
    await closeLocalBrowserSessions();
  });
}

/** User slash commands use the same authenticated MCP path as agent tools. */
export async function connectLocalBrowserMcp(conversationId: string): Promise<Client> {
  const config = await getLocalBrowserSessions().mcpConfig(conversationId);
  const client = new Client({ name: 'sudowork-browser-command', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: Object.fromEntries(config.headers.map(({ name, value }) => [name, value])) } }));
  return client;
}

export async function getLocalBrowserMcpConfig(conversationId: string, isHttp: boolean) {
  const http = await getLocalBrowserSessions().mcpConfig(conversationId);
  if (isHttp) return http;
  const candidate = getNodeBinaryPath();
  const node = existsSync(candidate) ? candidate : undefined;
  return {
    name: http.name,
    command: node || process.execPath,
    args: [getMcpScriptPath('shared')],
    env: [{ name: 'SUDOWORK_BROWSER_MCP_URL', value: http.url }, { name: 'SUDOWORK_BROWSER_MCP_TOKEN', value: http.headers[0].value.slice('Bearer '.length) }, ...(!node ? [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] : [])],
  };
}
