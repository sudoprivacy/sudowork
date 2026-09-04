/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@sudowork/host-bridge/ipcBridge';

export type FrequencyPreset = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly';

export interface IFrequencyScheduleOptions {
  hour?: number;
  minute?: number;
  weekday?: string;
}

export interface IScheduleFrequency {
  preset: FrequencyPreset;
  hour: number;
  minute: number;
  weekday: string;
}

export interface ICronJobActionsResult {
  pauseJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  updateJob: (jobId: string, updates: Partial<ICronJob>) => Promise<ICronJob>;
}

export interface ICronJobEventHandlers {
  onJobCreated: (job: ICronJob) => void;
  onJobUpdated: (job: ICronJob) => void;
  onJobRemoved: (data: { jobId: string }) => void;
}
