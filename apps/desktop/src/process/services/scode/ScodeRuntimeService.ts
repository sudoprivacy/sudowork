import { configureScodeService, getScodeServiceClient } from '@/common/scode/serviceClient';
import { getScodePath } from './ScodeInstallService';

export type NexusVfsStage = 'idle' | 'checking' | 'downloading' | 'installing' | 'starting' | 'ready' | 'error';

export interface NexusVfsStatus {
  stage: NexusVfsStage;
  message: string;
  percent?: number;
}

export type NexusVfsUnsubscribe = () => void;

interface IServiceStatus {
  running: boolean;
  version: string;
  zone_id?: string;
  nexusPid?: number;
  supervisorPid?: number;
}

/** Desktop status adapter. Runtime ownership belongs to Sudocode. */
class ScodeRuntimeService {
  private stage: NexusVfsStage = 'idle';
  private status: IServiceStatus | null = null;
  private readonly callbacks = new Set<(status: NexusVfsStatus) => void>();

  constructor() {
    configureScodeService(() => {
      const executable = getScodePath();
      if (!executable) throw new Error('Sudocode is not installed');
      return executable;
    });
  }

  get isRunning(): boolean {
    return this.status?.running === true;
  }

  get setupStage(): NexusVfsStage {
    return this.stage;
  }

  getBundledVersion(): string {
    return this.status?.version ?? '';
  }

  onSetupStatus(onStatus: (status: NexusVfsStatus) => void): NexusVfsUnsubscribe {
    this.callbacks.add(onStatus);
    return () => this.callbacks.delete(onStatus);
  }

  private emit(stage: NexusVfsStage, message: string, percent?: number): void {
    this.stage = stage;
    for (const onStatus of this.callbacks) onStatus({ stage, message, percent });
  }

  async checkInstalled(): Promise<boolean> {
    if (!getScodePath()) return false;
    const result = await getScodeServiceClient().request<{ installed: boolean; version: string }>('service.checkInstalled');
    this.status = { running: this.isRunning, version: result.version };
    return result.installed;
  }

  async install(): Promise<void> {
    this.emit('installing', 'Installing Sudocode services');
    try {
      const result = await getScodeServiceClient().request<{ installed: boolean; version: string }>('service.install', {}, 600_000);
      this.status = { running: this.isRunning, version: result.version };
      this.emit('idle', 'Sudocode services installed', 100);
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async start(): Promise<void> {
    this.emit('starting', 'Connecting to Sudocode services');
    this.status = await getScodeServiceClient().request<IServiceStatus>('service.start');
    this.emit('ready', 'Sudocode services ready', 100);
  }

  async stop(): Promise<void> {
    getScodeServiceClient().close();
    this.status = null;
    this.emit('idle', 'Sudocode service connection closed');
  }

  async restart(): Promise<void> {
    this.status = await getScodeServiceClient().request<IServiceStatus>('service.restart', {}, 120_000);
    this.emit('ready', 'Sudocode services ready', 100);
  }

  async checkActualRunning(): Promise<boolean> {
    if (!getScodePath()) return false;
    this.status = await getScodeServiceClient().request<IServiceStatus>('service.status');
    return this.status.running;
  }

  getStartCommandPreview(): { command: string; args: string[] } {
    return { command: getScodePath() ?? 'scode', args: ['service', 'stdio'] };
  }
}

export const scodeRuntimeService = new ScodeRuntimeService();
