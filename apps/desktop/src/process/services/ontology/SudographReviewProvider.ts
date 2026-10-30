import { app, net } from 'electron';
import path from 'node:path';
import { userInfo } from 'node:os';
import { ProcessConfig } from '@process/initStorage';
import { getShareoneApiKeyEnterprise, saveShareoneApiKeyEnterprise } from '../shareoneCli/shareoneCredentials';
import type { OntologyStudioDatabase } from './OntologyStudioDatabase';
import type { ISudographReviewHostOptions } from './SudographReviewHost';
import { ShareoneReviewAssets } from './ShareoneReviewAssets';
import { SudographReviewComments } from './SudographReviewComments';

export interface IReviewProviderDependencies {
  database: OntologyStudioDatabase;
  authorize: ISudographReviewHostOptions['authorize'];
  // Desktop's account-scoped provider also reads heads outside a browser grant.
  read: (workspaceId: string, request: Record<string, unknown>) => Promise<unknown>;
  own: (comments: SudographReviewComments) => void;
}

/** Production opens a complete review; only isolated transport fixtures omit it. */
export async function createSudographReviewProvider(options: IReviewProviderDependencies): Promise<ISudographReviewHostOptions['comments']> {
  const directory = app.isPackaged ? path.join(process.resourcesPath, 'shareone-review') : process.env.SUDOWORK_SHAREONE_REVIEW_ASSETS || path.resolve(__dirname, '../../resources/shareone-review');
  const assets = new ShareoneReviewAssets();
  await assets.load(directory);
  const account = () => ProcessConfig.getSync('eeclaw.accountScope') || 'local:' + userInfo().username;
  const comments = new SudographReviewComments({
    database: options.database,
    baseUrl: process.env.SUDOWORK_SHAREONE_ORIGIN || 'https://shareone.vip',
    currentAccount: account,
    getKey: async () => (ProcessConfig.getSync('eeclaw.accountScope') ? getShareoneApiKeyEnterprise({ isRequired: true }) : options.database.getHostSecret('shareone:' + account())),
    fetcher: net.fetch.bind(net),
    setKey: async (key) => {
      if (ProcessConfig.getSync('eeclaw.accountScope')) {
        if (!(await saveShareoneApiKeyEnterprise(key))) throw new Error('ShareOne account pairing is unavailable.');
      } else options.database.setHostSecret('shareone:' + account(), key);
    },
    authorize: async (binding) => {
      await options.authorize(binding);
    },
    head: (workspaceId) => options.read(workspaceId, { operation: 'head' }) as Promise<{ revision: string; context_digest: string }>,
    messageExists: async (conversationId, messageId) => {
      // The existing message store, not a second chat transcript, proves admission.
      const { getDatabase } = await import('@process/database');
      return !!getDatabase().getMessageByMsgId(conversationId, messageId, 'text').data;
    },
    deliver: async (input, hooks) => {
      const { sendConversationInput } = await import('@process/bridge/conversationBridge');
      return sendConversationInput(
        { conversation_id: input.conversationId, input: input.content, msg_id: input.messageId },
        {
          agentContent: input.agentContent,
          onStarted: hooks.onStarted,
          onCompleted: hooks.onCompleted,
        }
      );
    },
  });
  options.own(comments);
  return {
    assets,
    prepare: (binding) => comments.prepare(binding.workspaceId, binding.conversationId),
    proxy: (binding, route, method, body) => comments.proxy(binding, route, method, body),
    status: (binding) => comments.status(binding.workspaceId, binding.conversationId),
  };
}
