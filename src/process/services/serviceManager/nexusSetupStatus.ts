import type { InitStepStatus } from '../initStatus';
import type { NexusSetupStage, NexusSetupStatus } from '../nexus/DynamicNexusService';

export type NexusSetupLogSnapshot = {
  stage: NexusSetupStage;
  progressBucket?: number;
  message: string;
};

function clamp(percent: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, percent));
}

function getProgressBucket(status: NexusSetupStatus): number | undefined {
  if ((status.stage === 'installing' || status.stage === 'downloading') && typeof status.percent === 'number') {
    return Math.floor(clamp(status.percent, 0, 100) / 10);
  }

  return undefined;
}

export function createNexusSetupLogSnapshot(status: NexusSetupStatus): NexusSetupLogSnapshot {
  return {
    stage: status.stage,
    progressBucket: getProgressBucket(status),
    message: status.message,
  };
}

export function shouldLogNexusSetupStatus(previous: NexusSetupLogSnapshot | null, status: NexusSetupStatus): boolean {
  if (!previous) {
    return true;
  }

  const currentBucket = getProgressBucket(status);

  if (status.stage !== previous.stage) {
    return true;
  }

  if (currentBucket !== undefined) {
    return currentBucket !== previous.progressBucket;
  }

  return status.message !== previous.message;
}

export function getNexusStepStateFromSetupStatus(status: NexusSetupStatus): InitStepStatus {
  if (status.stage === 'ready') {
    return 'done';
  }

  if (status.stage === 'error') {
    return 'error';
  }

  return 'active';
}

export function getNexusStepProgressFromSetupStatus(status: NexusSetupStatus, previousProgress = 0): number {
  switch (status.stage) {
    case 'ready':
      return 100;
    case 'starting':
      return Math.max(previousProgress, 92);
    case 'idle':
      return Math.max(previousProgress, 88);
    case 'installing':
      return Math.max(previousProgress, clamp(status.percent ?? 50, 0, 88));
    case 'checking':
      return Math.max(previousProgress, clamp(status.percent ?? 5, 0, 88));
    case 'downloading':
      return Math.max(previousProgress, clamp(status.percent ?? 0, 0, 88));
    case 'error':
      return Math.max(previousProgress, clamp(status.percent ?? previousProgress, 0, 100));
    default:
      return previousProgress;
  }
}
