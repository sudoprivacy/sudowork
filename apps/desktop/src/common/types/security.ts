/** Risk level classifications */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Event type from counterparty */
export type EventType = 'network' | 'file' | 'process';

export interface INetworkEventData {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface IFileEventData {
  path: string;
  flags: string[];
}

export interface IProcessEventData {
  command: string;
  args: string[];
}

export type IEventData = INetworkEventData | IFileEventData | IProcessEventData;

export interface IEventFileData {
  type: EventType;
  data: IEventData;
}

export interface IActionFileData {
  allow?: boolean;
  reason?: string;
}

export interface ISafetyStatus {
  level: RiskLevel;
  eventType?: EventType;
  eventUuid?: string;
  details?: {
    code: string;
    message: string;
    detectedAt: number;
    networkData?: INetworkEventData;
    fileData?: IFileEventData;
    processData?: IProcessEventData;
    metadata?: Record<string, unknown>;
  };
}

export type ISafetyConfirmationAction = 'allow' | 'deny';

export type IBlacklistMatchType = 'exact' | 'wildcard';

export interface IBlacklistRule {
  id: string;
  enabled: boolean;
  type: 'network' | 'file' | 'process';
  pattern: string;
  matchType: IBlacklistMatchType;
  riskLevel: RiskLevel;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IBlacklistConfig {
  rules: IBlacklistRule[];
}
