/**
 * Auth Proxy Rule type definitions.
 *
 * Shared between main process (Auth Proxy Server, configItemsLoader)
 * and common layer (IPC bridge definitions).
 */

export interface AuthProxyRuleEntry {
  configKey: string;
  name: string;
  required: boolean;
}

export interface AuthProxyRule {
  configItemId: number;
  name: string;
  urlPattern: string | null;
  scheme: string | null;
  bearerPrefix: string | null;
  secretNamespace: string;
  entries: AuthProxyRuleEntry[];
}
