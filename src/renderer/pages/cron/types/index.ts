/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

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
