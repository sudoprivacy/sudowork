/** Risk level classifications */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Event type from counterparty */
export type EventType = 'network' | 'file' | 'process';

export interface NetworkEventData {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface FileEventData {
  path: string;
  flags: string[];
}

export interface ProcessEventData {
  command: string;
  args: string[];
}

export type EventData = NetworkEventData | FileEventData | ProcessEventData;

export interface EventFileData {
  type: EventType;
  data: EventData;
}

export interface ActionFileData {
  allow?: boolean;
  reason?: string;
}

export interface SafetyStatus {
  level: RiskLevel;
  eventType?: EventType;
  eventUuid?: string;
  details?: {
    code: string;
    message: string;
    detectedAt: number;
    networkData?: NetworkEventData;
    fileData?: FileEventData;
    processData?: ProcessEventData;
    metadata?: Record<string, unknown>;
  };
}

export type SafetyConfirmationAction = 'allow' | 'deny';

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

// Alias for backward compatibility
export type BlacklistRule = IBlacklistRule;
