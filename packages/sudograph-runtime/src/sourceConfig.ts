/** Private worker connection parameters, independent of a host's connector UI. */
export interface ISudographSourceConnector {
  /** The provider accepts postgresql or mysql; unsupported values fail closed. */
  sourceType: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  params?: Record<string, string | number | boolean | null>;
}
