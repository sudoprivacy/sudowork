/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { CronMessageMeta, TMessage } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import { getDatabase } from '@process/database';
import { ProcessConfig } from '@process/initStorage';
import { addMessage } from '@process/message';
import { DEFAULT_PRESET_AGENT_TYPE, resolvePresetAgentBackend, type AcpBackendAll } from '@/types/acpTypes';
import { powerSaveBlocker, app } from 'electron';
import { Cron } from 'croner';
import WorkerManage from '../../WorkerManage';
import { copyFilesToDirectory } from '../../utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { readAssistantResource, ruleFilePattern, skillFilePattern } from '@process/utils/assistantResources';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { assistantManager } from '@/process/AssistantManager';
import { setupChannelResponseRouting } from '@/channels/agent/ChannelResponseRouter';
import { cronBusyGuard } from './CronBusyGuard';
import { cronStore, type CronJob, type CronSchedule } from './CronStore';
import { createConversation } from '../conversationService';

/**
 * Parameters for creating a new cron job
 */
export interface CreateCronJobParams {
  name: string;
  schedule: CronSchedule;
  message: string;
  conversationId: string;
  conversationTitle?: string;
  agentType: AcpBackendAll;
  createdBy: 'user' | 'agent';
  conversationMode?: 'new' | 'reuse';
  workspace?: string;
  presetAssistantId?: string | null;
}

/**
 * CronService - Core scheduling service for AionUI
 *
 * Manages scheduled tasks that send messages to conversations at specified times.
 * Handles conflicts when conversation is busy.
 */
class CronService {
  private timers: Map<string, Cron | NodeJS.Timeout> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private initialized = false;
  private powerSaveBlockerId: number | null = null;

  /**
   * Initialize the cron service
   * Load all enabled jobs from database and start their timers
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const jobs = cronStore.listEnabled();

      for (const job of jobs) {
        this.startTimer(job);
      }

      this.initialized = true;
      this.updatePowerBlocker();
    } catch (error) {
      mainError('CronService', 'Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Add a new cron job. Multiple jobs may bind the same conversation.
   */
  async addJob(params: CreateCronJobParams): Promise<CronJob> {
    // Multiple scheduled tasks are allowed to bind the same conversation — each
    // job appears as its own group in the sidebar, and a shared conversation
    // shows up under every group it is bound to.
    const now = Date.now();
    const jobId = `cron_${uuid()}`;

    const job: CronJob = {
      id: jobId,
      name: params.name,
      enabled: true,
      schedule: params.schedule,
      target: {
        payload: { kind: 'message', text: params.message },
      },
      metadata: {
        conversationId: params.conversationId,
        conversationTitle: params.conversationTitle,
        agentType: params.agentType,
        createdBy: params.createdBy,
        createdAt: now,
        updatedAt: now,
        conversationMode: params.conversationMode ?? 'new',
        workspace: params.workspace,
        presetAssistantId: params.presetAssistantId ?? undefined,
      },
      state: {
        runCount: 0,
        retryCount: 0,
        maxRetries: 3,
      },
    };

    // Calculate next run time
    this.updateNextRunTime(job);

    // Save to database
    cronStore.insert(job);

    // Update conversation modifyTime so it appears at the top of the list
    if (params.conversationId) {
      try {
        const db = getDatabase();
        db.updateConversation(params.conversationId, { modifyTime: now });
      } catch (err) {
        mainWarn('CronService', 'Failed to update conversation modifyTime:', err);
      }
    }

    // Start timer
    this.startTimer(job);
    this.updatePowerBlocker();

    return job;
  }

  /**
   * Update an existing cron job
   */
  async updateJob(jobId: string, updates: Partial<CronJob>): Promise<CronJob> {
    const existing = cronStore.getById(jobId);
    if (!existing) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Stop existing timer
    this.stopTimer(jobId);

    // Normalize: JSON IPC strips `undefined`, so callers pass `null` to explicitly
    // clear `presetAssistantId`. Convert it to `undefined` here so the spread merge
    // in CronStore.update overwrites the existing value.
    if (updates.metadata && updates.metadata.presetAssistantId === null) {
      updates = {
        ...updates,
        metadata: { ...updates.metadata, presetAssistantId: undefined },
      };
    }

    // Update in database
    cronStore.update(jobId, updates);

    // Get updated job
    const updated = cronStore.getById(jobId)!;

    // Recalculate next run time if schedule changed or job is being enabled
    if (updates.schedule || (updates.enabled === true && !existing.enabled)) {
      this.updateNextRunTime(updated);
      cronStore.update(jobId, { state: updated.state });
    }

    // Restart timer if enabled
    if (updated.enabled) {
      this.startTimer(updated);
    }

    this.updatePowerBlocker();
    return updated;
  }

  /**
   * Remove a cron job
   */
  async removeJob(jobId: string): Promise<void> {
    // Stop timer
    this.stopTimer(jobId);

    // Delete from database
    cronStore.delete(jobId);
    this.updatePowerBlocker();
  }

  /**
   * List all cron jobs
   */
  async listJobs(): Promise<CronJob[]> {
    return cronStore.listAll();
  }

  /**
   * List cron jobs by conversation
   */
  async listJobsByConversation(conversationId: string): Promise<CronJob[]> {
    return cronStore.listByConversation(conversationId);
  }

  /**
   * Get a specific job
   */
  async getJob(jobId: string): Promise<CronJob | null> {
    return cronStore.getById(jobId);
  }

  /**
   * Manually trigger a job to execute immediately.
   * Throws if the execution ultimately failed, so the IPC caller (Run Now
   * button) can show a toast instead of silently updating the job row.
   */
  async triggerJob(jobId: string): Promise<void> {
    const job = cronStore.getById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    await this.executeJob(job);
    const updated = cronStore.getById(jobId);
    if (updated?.state.lastStatus === 'error' && updated.state.lastError) {
      throw new Error(updated.state.lastError);
    }
  }

  /**
   * Start timer for a job
   */
  private startTimer(job: CronJob): void {
    // Stop existing timer if any
    this.stopTimer(job.id);

    const { schedule } = job;
    const jobId = job.id;

    // Always re-read the job from DB before execution so that state updated
    // in previous runs (e.g. lastConversationId for reuse mode) is fresh.
    const executeLatest = async () => {
      const latest = cronStore.getById(jobId);
      if (latest) {
        await this.executeJob(latest);
      }
    };

    switch (schedule.kind) {
      case 'cron': {
        const timer = new Cron(
          schedule.expr,
          {
            timezone: schedule.tz,
            paused: false,
          },
          () => {
            void executeLatest();
          }
        );
        this.timers.set(job.id, timer);

        // Sync nextRunAtMs with actual next run time and notify frontend
        const nextRun = timer.nextRun();
        job.state.nextRunAtMs = nextRun ? nextRun.getTime() : undefined;
        cronStore.update(job.id, { state: job.state });
        ipcBridge.cron.onJobUpdated.emit(job);
        break;
      }

      case 'every': {
        const timer = setInterval(() => {
          void executeLatest();
        }, schedule.everyMs);
        this.timers.set(job.id, timer);

        // Sync nextRunAtMs with actual timer start time and notify frontend
        job.state.nextRunAtMs = Date.now() + schedule.everyMs;
        cronStore.update(job.id, { state: job.state });
        ipcBridge.cron.onJobUpdated.emit(job);
        break;
      }

      case 'at': {
        const delay = schedule.atMs - Date.now();
        if (delay > 0) {
          const timer = setTimeout(() => {
            void executeLatest();
            // One-time job, disable after execution
            void this.updateJob(job.id, { enabled: false });
          }, delay);
          this.timers.set(job.id, timer);

          // Sync nextRunAtMs and notify frontend
          job.state.nextRunAtMs = schedule.atMs;
          cronStore.update(job.id, { state: job.state });
          ipcBridge.cron.onJobUpdated.emit(job);
        } else {
          // Past one-time job, mark as expired and disable
          job.state.nextRunAtMs = undefined;
          job.state.lastStatus = 'skipped';
          job.state.lastError = 'Scheduled time has passed';
          job.enabled = false;
          cronStore.update(job.id, { enabled: false, state: job.state });
          ipcBridge.cron.onJobUpdated.emit(job);
        }
        break;
      }
    }
  }

  /**
   * Stop timer for a job
   */
  private stopTimer(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      if (timer instanceof Cron) {
        timer.stop();
      } else {
        clearTimeout(timer);
        clearInterval(timer);
      }
      this.timers.delete(jobId);
    }

    // Also clear any retry timers
    const retryTimer = this.retryTimers.get(jobId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(jobId);
    }
  }

  /**
   * Execute a job - send message to conversation
   */
  private async executeJob(job: CronJob): Promise<void> {
    const { conversationId } = job.metadata;
    const conversationMode = job.metadata.conversationMode ?? 'new';

    // Check if conversation is busy (only relevant for reuse mode)
    if (conversationMode === 'reuse') {
      const isBusy = cronBusyGuard.isProcessing(conversationId);
      if (isBusy) {
        job.state.retryCount++;

        if (job.state.retryCount > (job.state.maxRetries || 3)) {
          // Max retries exceeded, skip this run
          job.state.lastStatus = 'skipped';
          job.state.lastError = `Conversation busy after ${job.state.maxRetries || 3} retries`;
          job.state.retryCount = 0; // Reset for next trigger
          this.updateNextRunTime(job);
          cronStore.update(job.id, { state: job.state });
          ipcBridge.cron.onJobUpdated.emit(job);
          return;
        }

        // Schedule retry in 30 seconds — re-read from DB for fresh state
        const retryTimer = setTimeout(() => {
          this.retryTimers.delete(job.id);
          const latest = cronStore.getById(job.id);
          if (latest) void this.executeJob(latest);
        }, 30000);
        this.retryTimers.set(job.id, retryTimer);
        return;
      }
    }

    // Update state before execution
    job.state.lastRunAtMs = Date.now();
    job.state.runCount++;
    mainLog('CronService', `executeJob START: id=${job.id} name="${job.name}" mode=${conversationMode} presetAssistantId=${job.metadata.presetAssistantId ?? 'none'} agentType=${job.metadata.agentType}`);

    try {
      const messageText = job.target.payload.text;
      const msgId = uuid();

      // Resolve preset assistant context if a preset is selected
      const presetAssistantId = job.metadata.presetAssistantId;
      let presetContext: string | undefined;
      let enabledSkills: string[] | undefined;
      let presetAgentName: string | undefined;
      let presetCliPath: string | undefined;
      // Normalize stored agentType — legacy jobs may have 'sudoclaw-gateway' or 'openclaw-gateway'
      const storedAgentType = job.metadata.agentType;
      const normalizedAgentType: AcpBackendAll = !storedAgentType || (storedAgentType as string) === 'sudoclaw-gateway' || (storedAgentType as string) === 'openclaw-gateway' ? 'scode' : storedAgentType;
      let resolvedAgentType: AcpBackendAll = normalizedAgentType;
      let convType: string = 'acp';

      if (presetAssistantId) {
        try {
          const appLocale = app.getLocale() || 'en-US';
          const localeKey = appLocale.startsWith('zh') ? 'zh-CN' : appLocale.startsWith('ja') ? 'ja-JP' : appLocale.startsWith('ko') ? 'ko-KR' : 'en-US';

          // Resolve rules file
          let rules = '';
          let skillsText = '';

          // 1. Try user-customized files first, then builtin fallback
          rules = await readAssistantResource('rules', presetAssistantId, localeKey, ruleFilePattern).catch(() => '');
          skillsText = await readAssistantResource('skills', presetAssistantId, localeKey, skillFilePattern).catch(() => '');

          presetContext = rules || undefined;

          // 3. Get enabledSkills + display info from AssistantManager (filesystem SSOT)
          const lookupId = presetAssistantId.startsWith('builtin-') ? presetAssistantId.slice('builtin-'.length) : presetAssistantId;
          const meta = await assistantManager.getAssistantMeta(lookupId);
          enabledSkills = meta?.enabledSkills ?? meta?.defaultEnabledSkills;
          presetAgentName = meta?.nameI18n?.['en-US'];

          // 4. Determine correct conversation type from presetAgentType
          const presetAgentType = meta?.presetAgentType || DEFAULT_PRESET_AGENT_TYPE;
          const presetBackend = resolvePresetAgentBackend(presetAgentType);

          // Check that the ACP backend CLI has actually been detected on this
          // machine. If not (e.g. Doctor wants 'claude' but Claude CLI isn't
          // installed), fall back to scode so the job still runs instead of
          // silently failing inside AcpAgent.initAgent.
          const detected = acpDetector.getDetectedAgents();
          const hasCli = detected.some((a) => a.backend === presetBackend && !!a.cliPath);
          if (hasCli) {
            resolvedAgentType = presetBackend as AcpBackendAll;
            convType = 'acp';
          } else {
            mainWarn('CronService', `Preset ${presetAssistantId} requested backend '${presetBackend}' but no CLI was detected; falling back to scode`);
            resolvedAgentType = 'scode';
            convType = 'acp';
          }
        } catch (err) {
          mainWarn('CronService', `Failed to resolve preset assistant resources for ${presetAssistantId}:`, err);
        }
      }

      if (resolvedAgentType === 'scode') {
        const hasScodeCli = acpDetector.getDetectedAgents().some((agent) => agent.backend === 'scode' && !!agent.cliPath);
        if (!hasScodeCli) {
          mainWarn('CronService', 'Scode is selected for cron execution but no CLI was detected');
        }
      }

      const agentType = resolvedAgentType;

      let task;
      let activeConversationId: string;

      if (conversationMode === 'new') {
        // ── NEW CONVERSATION PER RUN ──
        // Create a fresh conversation for each execution, named "Apr 6 – <JobName>"
        const runDate = new Date();
        const yyyy = runDate.getFullYear();
        const mm = String(runDate.getMonth() + 1).padStart(2, '0');
        const dd = String(runDate.getDate()).padStart(2, '0');
        const hh = String(runDate.getHours()).padStart(2, '0');
        const min = String(runDate.getMinutes()).padStart(2, '0');
        const convName = `${yyyy}/${mm}/${dd} ${hh}:${min} – ${job.name}`;

        mainLog('CronService', `Creating new conversation: name="${convName}" type="${convType}" agentType="${agentType}"`);
        const result = await createConversation({
          type: convType as any,
          name: convName,
          source: 'cron',
          model: { useModel: '', provider: '', baseUrl: '' } as any,
          extra: {
            backend: agentType,
            workspace: job.metadata.workspace,
            customWorkspace: !!job.metadata.workspace,
            cronJobId: job.id,
            cronJobName: job.name,
            ...(presetAssistantId && {
              presetAssistantId,
              customAgentId: presetAssistantId,
              agentName: presetAgentName,
              cliPath: presetCliPath,
              presetContext,
              enabledSkills,
            }),
          } as any,
        });

        mainLog('CronService', `createConversation result: success=${result.success} error=${result.error ?? 'none'} id=${result.conversation?.id ?? 'none'}`);
        if (!result.success || !result.conversation) {
          throw new Error(result.error || 'Failed to create conversation');
        }

        activeConversationId = result.conversation.id;
        job.state.lastConversationId = activeConversationId;

        mainLog('CronService', `Building task for conversationId=${activeConversationId}`);
        task = await WorkerManage.getTaskByIdRollbackBuild(activeConversationId, { yoloMode: true });
        mainLog('CronService', `Task built: ${task ? 'ok' : 'null'}`);
      } else {
        // ── REUSE EXISTING CONVERSATION ──
        // For reuse mode, determine which conversation to use:
        //   1. If job was created from Settings (no conversationId), use lastConversationId from previous runs
        //   2. If job was bound to a conversation, use that conversationId
        //   3. Auto-create on first run if neither exists
        const reuseConvId = job.state.lastConversationId || conversationId;
        activeConversationId = reuseConvId;

        if (reuseConvId) {
          try {
            const existingTask = WorkerManage.getTaskById(reuseConvId);
            if (existingTask) {
              const yoloEnabled = await existingTask.ensureYoloMode();
              if (yoloEnabled) {
                task = existingTask;
              } else {
                WorkerManage.kill(reuseConvId);
                task = await WorkerManage.getTaskByIdRollbackBuild(reuseConvId, { yoloMode: true });
              }
            } else {
              task = await WorkerManage.getTaskByIdRollbackBuild(reuseConvId, { yoloMode: true });
            }
          } catch (err) {
            mainWarn('CronService', `Failed to build task for conversation ${reuseConvId}, will auto-create: ${err}`);
            task = null;
          }
        }

        // Auto-create if no conversation exists yet (first run) or the bound one is gone
        if (!task) {
          mainLog('CronService', `Auto-creating reuse conversation for cron job ${job.id} (${job.name})`);
          const result = await createConversation({
            type: convType as any,
            name: job.name,
            source: 'cron',
            model: { useModel: '', provider: '', baseUrl: '' } as any,
            extra: {
              backend: agentType,
              workspace: job.metadata.workspace,
              customWorkspace: !!job.metadata.workspace,
              cronJobId: job.id,
              cronJobName: job.name,
              ...(presetAssistantId && {
                presetAssistantId,
                customAgentId: presetAssistantId,
                agentName: presetAgentName,
                cliPath: presetCliPath,
                presetContext,
                enabledSkills,
              }),
            } as any,
          });
          if (!result.success || !result.conversation) {
            throw new Error(result.error || 'Failed to create conversation');
          }
          activeConversationId = result.conversation.id;
          job.state.lastConversationId = activeConversationId;
          // Also update the bound conversationId so subsequent runs don't recreate
          if (!conversationId) {
            job.metadata.conversationId = activeConversationId;
            job.metadata.conversationTitle = job.name;
          }
          cronStore.update(job.id, { metadata: job.metadata, state: job.state });

          task = await WorkerManage.getTaskByIdRollbackBuild(activeConversationId, { yoloMode: true });
        }
        // NOTE: We do NOT tag the pre-bound conversation with cron metadata on `extra`.
        // The scheduled sidebar groups are built from the cron jobs table at render time
        // (see groupingHelpers.buildGroupedHistory), which correctly supports a single
        // conversation bound to multiple jobs.
      }

      if (!task) {
        throw new Error('Failed to initialize task');
      }

      // Set up channel response routing if conversation source is a channel type
      const db = getDatabase();
      const convResult = db.getConversation(activeConversationId);
      mainLog('CronService', `Setting up routing check for convId=${activeConversationId}, success=${convResult.success}, hasData=${!!convResult.data}`);
      if (convResult.success && convResult.data) {
        mainLog('CronService', `Conversation data: source=${convResult.data.source}, chatId=${convResult.data.channelChatId}`);
        setupChannelResponseRouting(convResult.data);
      }

      mainLog('CronService', `Sending message to conversationId=${activeConversationId}`);
      // Get workspace from task (all agent managers have this property)
      const workspace = (task as { workspace?: string }).workspace;
      const workspaceFiles = workspace ? await copyFilesToDirectory(workspace, [], false) : [];

      // Build cronMeta for message origin tracking
      const cronMeta: CronMessageMeta = {
        source: 'cron',
        cronJobId: job.id,
        cronJobName: job.name,
        triggeredAt: Date.now(),
      };

      await task.sendMessage({ content: messageText, msg_id: msgId, files: workspaceFiles, cronMeta });
      mainLog('CronService', `Message sent successfully`);

      // Success
      job.state.lastStatus = 'ok';
      job.state.lastError = undefined;
      job.state.retryCount = 0;

      // Update conversation modifyTime so it appears at the top of the list
      try {
        const db = getDatabase();
        db.updateConversation(activeConversationId, {});
      } catch (err) {
        mainWarn('CronService', 'Failed to update conversation modifyTime after execution:', err);
      }
    } catch (error) {
      job.state.lastStatus = 'error';
      job.state.lastError = error instanceof Error ? error.message : String(error);
      mainError('CronService', `Job ${job.id} failed:`, error);
    }

    // Update next run time
    this.updateNextRunTime(job);

    // Persist state and notify frontend
    cronStore.update(job.id, { state: job.state });
    const updatedJob = cronStore.getById(job.id);
    if (updatedJob) {
      ipcBridge.cron.onJobUpdated.emit(updatedJob);
    }
  }

  /**
   * Update the next run time for a job
   */
  private updateNextRunTime(job: CronJob): void {
    const { schedule } = job;

    switch (schedule.kind) {
      case 'cron': {
        try {
          const cron = new Cron(schedule.expr, { timezone: schedule.tz });
          const next = cron.nextRun();
          job.state.nextRunAtMs = next ? next.getTime() : undefined;
        } catch {
          job.state.nextRunAtMs = undefined;
        }
        break;
      }

      case 'every': {
        job.state.nextRunAtMs = Date.now() + schedule.everyMs;
        break;
      }

      case 'at': {
        job.state.nextRunAtMs = schedule.atMs > Date.now() ? schedule.atMs : undefined;
        break;
      }
    }
  }

  /**
   * Handle system resume from sleep/hibernate.
   * Detects missed jobs, inserts notification messages into their conversations,
   * and restarts all timers with fresh schedules.
   */
  async handleSystemResume(): Promise<void> {
    if (!this.initialized) return;

    mainLog('CronService', 'System resumed, checking for missed jobs...');
    const now = Date.now();
    const jobs = cronStore.listEnabled();

    for (const job of jobs) {
      // Stop stale timer (it was paused during sleep and may be in invalid state)
      this.stopTimer(job.id);

      // Check if job was missed during sleep
      const nextRunAt = job.state.nextRunAtMs;
      if (nextRunAt && nextRunAt <= now) {
        mainLog('CronService', `Missed job "${job.name}" (was due at ${new Date(nextRunAt).toISOString()})`);

        // Update job state to reflect missed execution
        job.state.lastStatus = 'missed';
        job.state.lastError = `Task missed during system sleep (scheduled at ${new Date(nextRunAt).toLocaleString()})`;
        this.updateNextRunTime(job);
        cronStore.update(job.id, { state: job.state });
        ipcBridge.cron.onJobUpdated.emit(job);

        // Insert a notification message into the conversation
        this.insertMissedJobMessage(job, nextRunAt);
      }

      // Restart timer with fresh schedule
      const latestJob = cronStore.getById(job.id);
      if (latestJob && latestJob.enabled) {
        this.startTimer(latestJob);
      }
    }
  }

  /**
   * Insert a notification message into the conversation to inform the user
   * about a missed scheduled task execution.
   */
  private insertMissedJobMessage(job: CronJob, scheduledAtMs: number): void {
    const { conversationId } = job.metadata;
    const scheduledTime = new Date(scheduledAtMs).toLocaleString();
    const msgId = uuid();

    const content = `⏰ Scheduled task "${job.name}" was not executed during system sleep.\nScheduled time: ${scheduledTime}\nThe timer has been restarted and will run at the next scheduled time.`;

    // Persist message to database
    const message: TMessage = {
      id: msgId,
      msg_id: msgId,
      type: 'tips',
      position: 'center',
      conversation_id: conversationId,
      content: { content, type: 'warning' as const },
      createdAt: Date.now(),
      status: 'finish',
    };
    addMessage(conversationId, message);

    // Emit to frontend so it shows immediately if conversation is open
    ipcBridge.conversation.responseStream.emit({
      type: 'tips',
      conversation_id: conversationId,
      msg_id: msgId,
      data: { content, type: 'warning' },
    });
  }

  /**
   * Returns whether the powerSaveBlocker is currently active
   */
  getPowerSaveActive(): boolean {
    return this.powerSaveBlockerId !== null;
  }

  /**
   * Manually enable or disable the powerSaveBlocker (user preference)
   */
  setPowerSave(enabled: boolean): void {
    if (enabled && this.powerSaveBlockerId === null) {
      try {
        this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
        mainLog('CronService', 'PowerSaveBlocker manually started');
      } catch (error) {
        mainWarn('CronService', 'Failed to start powerSaveBlocker:', error);
      }
    } else if (!enabled && this.powerSaveBlockerId !== null) {
      try {
        powerSaveBlocker.stop(this.powerSaveBlockerId);
        mainLog('CronService', 'PowerSaveBlocker manually stopped');
      } catch (error) {
        mainWarn('CronService', 'Failed to stop powerSaveBlocker:', error);
      }
      this.powerSaveBlockerId = null;
    }
  }

  /**
   * Manage powerSaveBlocker to keep the app alive while cron jobs are active.
   * Uses 'prevent-app-suspension' mode which prevents the app from being suspended
   * but does not prevent the display from sleeping.
   */
  private updatePowerBlocker(): void {
    const hasEnabledJobs = cronStore.listEnabled().length > 0;

    if (hasEnabledJobs && this.powerSaveBlockerId === null) {
      try {
        this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
        mainLog('CronService', 'PowerSaveBlocker started (prevent-app-suspension)');
      } catch (error) {
        mainWarn('CronService', 'Failed to start powerSaveBlocker:', error);
      }
    } else if (!hasEnabledJobs && this.powerSaveBlockerId !== null) {
      try {
        powerSaveBlocker.stop(this.powerSaveBlockerId);
        mainLog('CronService', 'PowerSaveBlocker stopped (no active jobs)');
      } catch (error) {
        mainWarn('CronService', 'Failed to stop powerSaveBlocker:', error);
      }
      this.powerSaveBlockerId = null;
    }
  }

  /**
   * Cleanup - stop all timers and release power blocker
   */
  cleanup(): void {
    for (const jobId of this.timers.keys()) {
      this.stopTimer(jobId);
    }
    this.timers.clear();
    this.retryTimers.clear();
    this.initialized = false;

    // Release power save blocker
    if (this.powerSaveBlockerId !== null) {
      try {
        powerSaveBlocker.stop(this.powerSaveBlockerId);
      } catch {
        // Ignore errors during cleanup
      }
      this.powerSaveBlockerId = null;
    }
  }
}

// Singleton instance
export const cronService = new CronService();

// Re-export types
export type { CronJob, CronSchedule } from './CronStore';
