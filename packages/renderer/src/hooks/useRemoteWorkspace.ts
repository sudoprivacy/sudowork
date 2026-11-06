import { useCallback, useEffect } from 'react';
import useSWR, { unstable_serialize, useSWRConfig } from 'swr';
import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { parseGeneratedFilesMarker } from '@sudowork/common/generatedFiles';
import { emitter } from '@renderer/utils/emitter';

interface WorkspaceSnapshot {
  files?: IDirOrFile[];
  error?: Error;
}

interface WorkspaceSubscription {
  read: (path?: string, search?: string) => Promise<IDirOrFile[]>;
  refresh: () => Promise<IDirOrFile[]>;
  retain: () => () => void;
}

const subscriptions = new WeakMap<object, Map<string, WorkspaceSubscription>>();

function registryFor(cache: object): Map<string, WorkspaceSubscription> {
  let registry = subscriptions.get(cache);
  if (!registry) {
    registry = new Map();
    subscriptions.set(cache, registry);
  }
  return registry;
}

function workspaceKey(id: string) {
  return ['remote-workspace', id] as const;
}

/** Share the root image and its invalidation subscription across workspace views. */
export function useRemoteWorkspace(conversationId: string | undefined) {
  const { cache, mutate } = useSWRConfig();
  const registry = registryFor(cache);
  const { data } = useSWR<WorkspaceSnapshot>(conversationId ? workspaceKey(conversationId) : null, null, { keepPreviousData: false });

  useEffect(() => {
    if (!conversationId) return;
    const existing = registry.get(conversationId);
    if (existing) return existing.retain();

    const id = conversationId;
    const key = workspaceKey(id);
    let users = 0;
    let isDisposed = false;
    let isDirty = false;
    let pending: Promise<IDirOrFile[]> | undefined;
    const requests = new Map<string, Promise<IDirOrFile[]>>();
    const publish = (update: (current: WorkspaceSnapshot | undefined) => WorkspaceSnapshot) => {
      // The target belongs to this subscription, even when its first view changes sessions.
      void mutate<WorkspaceSnapshot>(key, update, { revalidate: false }).catch((error) => {
        if (!isDisposed) console.warn('Failed to publish remote workspace', error);
      });
    };
    const read = (path?: string, search?: string): Promise<IDirOrFile[]> => {
      if (isDisposed) return Promise.reject(new Error('Remote workspace subscription is closed'));
      const requestKey = JSON.stringify([path || '', search || '']);
      const existingRequest = requests.get(requestKey);
      if (existingRequest) return existingRequest;
      const request = ipcBridge.conversation.getRemoteWorkspace
        .invoke({ conversation_id: id, path, search })
        .then((response) => {
          if (!response?.success) throw new Error(response?.msg || 'Failed to load remote workspace');
          return response.data?.files ?? [];
        })
        .finally(() => requests.delete(requestKey));
      requests.set(requestKey, request);
      return request;
    };

    const refresh = (): Promise<IDirOrFile[]> => {
      isDirty = true;
      if (pending) return pending;
      pending = Promise.resolve().then(async () => {
        let files: IDirOrFile[] = [];
        try {
          while (isDirty && !isDisposed) {
            isDirty = false;
            try {
              files = await read();
              if (!isDisposed) publish(() => ({ files }));
            } catch (error) {
              const failure = error instanceof Error ? error : new Error(String(error));
              if (!isDisposed) publish((current) => ({ ...current, error: failure }));
              // An invalidation received during this read still needs its own read.
              if (!isDirty || isDisposed) throw error;
            }
          }
          return files;
        } finally {
          pending = undefined;
        }
      });
      return pending;
    };
    const invalidate = () => {
      // Errors are published through the shared snapshot to both views.
      void refresh().catch((): void => undefined);
    };
    const unsubscribe = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== id) return;
      if (message.type === 'finish') {
        invalidate();
      } else if (message.type === 'content') {
        if (typeof message.data === 'string' && parseGeneratedFilesMarker(message.data).ok) invalidate();
      } else if (message.type === 'agent_status') {
        if ((message.data as { status?: string } | undefined)?.status === 'session_active') invalidate();
      } else if (message.type === 'acp_tool_call') {
        const status = (message.data as { update?: { status?: string } } | undefined)?.update?.status;
        if (status === 'completed' || status === 'failed') invalidate();
      }
    });
    const subscription: WorkspaceSubscription = {
      read,
      refresh,
      retain: () => {
        users++;
        return () => {
          if (--users) return;
          isDisposed = true;
          unsubscribe();
          emitter.off('remote-agent.workspace.refresh', invalidate);
          registry.delete(id);
          // No consumer remains; discard its private image before a subsequent mount.
          cache.delete(unstable_serialize(key));
        };
      },
    };
    registry.set(id, subscription);
    emitter.on('remote-agent.workspace.refresh', invalidate);
    invalidate();
    return subscription.retain();
  }, [cache, conversationId, mutate, registry]);

  const refresh = useCallback(() => {
    const subscription = conversationId ? registry.get(conversationId) : undefined;
    if (!subscription) return Promise.reject(new Error('Remote workspace subscription is unavailable'));
    return subscription.refresh();
  }, [conversationId, registry]);
  const read = useCallback(
    (path?: string, search?: string) => {
      const subscription = conversationId ? registry.get(conversationId) : undefined;
      if (!subscription) return Promise.reject(new Error('Remote workspace subscription is unavailable'));
      return subscription.read(path, search);
    },
    [conversationId, registry]
  );
  return { files: data?.files, error: data?.error, read, refresh };
}
