/**
 * Blacklist Types
 *
 * Re-export types from main app for hook usage.
 * These must match the types in src/common/safetyTypes.ts
 */

/** Risk level classifications */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Pattern matching type for blacklist rules */
export type BlacklistMatchType = 'exact' | 'wildcard';

/** Single blacklist rule */
export interface BlacklistRule {
  /** Unique identifier */
  id: string;
  /** Whether this rule is active */
  enabled: boolean;
  /** Rule type: network (domain/IP) or file (path) */
  type: 'network' | 'file';
  /** Pattern to match (domain, IP, or file path) */
  pattern: string;
  /** How to interpret the pattern */
  matchType: BlacklistMatchType;
  /** Risk level when matched */
  riskLevel: RiskLevel;
  /** Optional description */
  description?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/** Blacklist configuration */
export interface BlacklistConfig {
  /** List of blacklist rules */
  rules: BlacklistRule[];
}