/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import { CronJobStatusEnums } from '@/renderer/utils/enum';

/**
 * Common cron job actions
 */
interface CronJobActionsResult {
  pauseJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  updateJob: (jobId: string, updates: Partial<ICronJob>) => Promise<ICronJob>;
}

/**
 * Creates common cron job action handlers
 */
/**
 * The cron bridge providers return an `{ __error: string }` envelope instead of
 * rejecting, because the underlying IPC library has no rejection path (see
 * src/process/bridge/cronBridge.ts). This helper unwraps the envelope and
 * throws a real Error so callers can use normal try/catch.
 */
function unwrapCronResult<T>(result: T): T {
  const envelope = result as { __error?: unknown } | null | undefined;
  if (envelope && typeof envelope === 'object' && typeof envelope.__error === 'string') {
    throw new Error(envelope.__error);
  }
  return result;
}

function useCronJobActions(onJobUpdated?: (jobId: string, job: ICronJob) => void, onJobDeleted?: (jobId: string) => void): CronJobActionsResult {
  const pauseJob = useCallback(
    async (jobId: string) => {
      const updated = unwrapCronResult(await ipcBridge.cron.updateJob.invoke({ jobId, updates: { enabled: false } }));
      onJobUpdated?.(jobId, updated);
    },
    [onJobUpdated]
  );

  const resumeJob = useCallback(
    async (jobId: string) => {
      const updated = unwrapCronResult(await ipcBridge.cron.updateJob.invoke({ jobId, updates: { enabled: true } }));
      onJobUpdated?.(jobId, updated);
    },
    [onJobUpdated]
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      unwrapCronResult(await ipcBridge.cron.removeJob.invoke({ jobId }));
      onJobDeleted?.(jobId);
    },
    [onJobDeleted]
  );

  const updateJob = useCallback(
    async (jobId: string, updates: Partial<ICronJob>) => {
      const updated = unwrapCronResult(await ipcBridge.cron.updateJob.invoke({ jobId, updates }));
      onJobUpdated?.(jobId, updated);
      return updated;
    },
    [onJobUpdated]
  );

  return { pauseJob, resumeJob, deleteJob, updateJob };
}

/**
 * Event handlers for cron job subscription
 */
interface CronJobEventHandlers {
  onJobCreated: (job: ICronJob) => void;
  onJobUpdated: (job: ICronJob) => void;
  onJobRemoved: (data: { jobId: string }) => void;
}

/**
 * Subscribe to cron job events with unified cleanup
 */
function useCronJobSubscription(handlers: CronJobEventHandlers) {
  useEffect(() => {
    const unsubCreate = ipcBridge.cron.onJobCreated.on(handlers.onJobCreated);
    const unsubUpdate = ipcBridge.cron.onJobUpdated.on(handlers.onJobUpdated);
    const unsubRemove = ipcBridge.cron.onJobRemoved.on(handlers.onJobRemoved);

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubRemove();
    };
  }, [handlers.onJobCreated, handlers.onJobUpdated, handlers.onJobRemoved]);
}

/**
 * Hook for managing cron jobs for a specific conversation
 * @param conversationId - The conversation ID to fetch jobs for
 */
export function useCronJobs(conversationId?: string) {
  const [jobs, setJobs] = useState<ICronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch jobs for the conversation
  const fetchJobs = useCallback(async () => {
    if (!conversationId) {
      setJobs([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await ipcBridge.cron.listJobsByConversation.invoke({ conversationId });
      setJobs(unwrapCronResult(result) || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch cron jobs'));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Initial fetch
  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Event handlers
  const eventHandlers = useMemo<CronJobEventHandlers>(
    () => ({
      onJobCreated: (job: ICronJob) => {
        if (job.metadata.conversationId === conversationId) {
          setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
        }
      },
      onJobUpdated: (job: ICronJob) => {
        if (job.metadata.conversationId === conversationId) {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
        }
      },
      onJobRemoved: ({ jobId }: { jobId: string }) => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      },
    }),
    [conversationId]
  );

  useCronJobSubscription(eventHandlers);

  // Actions (without local state updates, rely on events)
  const actions = useCronJobActions();

  // Computed values
  const hasJobs = jobs.length > 0;
  const activeJobsCount = jobs.filter((j) => j.enabled).length;
  const hasError = jobs.some((j) => j.state.lastStatus === 'error');

  return {
    jobs,
    loading,
    error,
    hasJobs,
    activeJobsCount,
    hasError,
    refetch: fetchJobs,
    ...actions,
  };
}

/**
 * Hook for managing all cron jobs across all conversations
 * Supports sessionMode change triggering refetch for enterprise mode
 */
export function useAllCronJobs() {
  const [jobs, setJobs] = useState<ICronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isEnterprise } = useAppMode();

  // Fetch all jobs
  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allJobs = await ipcBridge.cron.listJobs.invoke();
      // Handle error envelope
      const envelope = allJobs as { __error?: unknown } | null | undefined;
      if (envelope && typeof envelope === 'object' && typeof envelope.__error === 'string') {
        setError(new Error(envelope.__error));
        setJobs([]);
      } else {
        setJobs(allJobs || []);
      }
    } catch (err) {
      console.error('[useAllCronJobs] Failed to fetch jobs:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch'));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Listen for sessionMode changes (enterprise mode) to trigger refetch
  useEffect(() => {
    if (!isEnterprise) return;

    const handleSessionModeChanged = () => {
      void fetchJobs();
    };

    return addEventListener('sessionMode.changed', handleSessionModeChanged);
  }, [isEnterprise, fetchJobs]);

  // Event handlers
  const eventHandlers = useMemo<CronJobEventHandlers>(
    () => ({
      onJobCreated: (job: ICronJob) => {
        setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
      },
      onJobUpdated: (job: ICronJob) => {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      },
      onJobRemoved: ({ jobId }: { jobId: string }) => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      },
    }),
    []
  );

  useCronJobSubscription(eventHandlers);

  // Actions with local state updates
  const handleJobUpdated = useCallback((jobId: string, job: ICronJob) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? job : j)));
  }, []);

  const handleJobDeleted = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const actions = useCronJobActions(handleJobUpdated, handleJobDeleted);

  // Computed values
  const activeCount = useMemo(() => jobs.filter((j) => j.enabled).length, [jobs]);
  const hasError = useMemo(() => jobs.some((j) => j.state.lastStatus === CronJobStatusEnums.Error), [jobs]);

  return {
    jobs,
    loading,
    error,
    activeCount,
    hasError,
    refetch: fetchJobs,
    ...actions,
  };
}

/**
 * Hook for refreshing conversation list when cron jobs run.
 * No longer tracks job status per-conversation — conversation icons are unchanged by scheduled tasks.
 */
export function useCronJobsMap() {
  // Emit chat.history.refresh when jobs are created or updated so the list re-sorts
  useEffect(() => {
    const onCreated = () => emitter.emit('chat.history.refresh');
    const onUpdated = () => emitter.emit('chat.history.refresh');
    const unsubCreate = ipcBridge.cron.onJobCreated.on(onCreated);
    const unsubUpdate = ipcBridge.cron.onJobUpdated.on(onUpdated);
    return () => {
      unsubCreate();
      unsubUpdate();
    };
  }, []);

  // Stubs kept for call-site compatibility
  const getJobStatus = useCallback((_conversationId: string): CronJobStatusEnums => CronJobStatusEnums.None, []);
  const markAsRead = useCallback((_conversationId: string) => {}, []);
  const setActiveConversation = useCallback((_conversationId: string) => {}, []);
  const hasUnread = useCallback((_conversationId: string) => false, []);

  return useMemo(() => ({ getJobStatus, markAsRead, setActiveConversation, hasUnread }), [getJobStatus, markAsRead, setActiveConversation, hasUnread]);
}

export default useCronJobs;
