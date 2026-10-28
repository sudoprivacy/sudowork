import { z } from 'zod';
import type { IOntologyRuntimeBindings, IOntologyConnectorConfig } from '@sudowork/ontology-common';

export function ontologyConnectionBinding(connection: Partial<IOntologyConnectorConfig>): Partial<IOntologyConnectorConfig> {
  return Object.fromEntries(Object.entries(connection).filter(([key]) => ['sourceType', 'host', 'port', 'database', 'path', 'url', 'username', 'password', 'credential', 'params', 'headers', 'writable'].includes(key)));
}

const configValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const ontologyBindingsSchema = z
  .object({
    connections: z
      .record(
        z
          .object({
            sourceType: z.enum(['local_files', 'directory', 'sqlite', 'mysql', 'postgresql', 'oracle', 'sqlserver', 'openapi', 'rest', 'ftp', 'sftp', 'mq', 'kafka', 'oss', 's3']).optional(),
            host: z.string().optional(),
            port: z.number().int().min(1).max(65535).optional(),
            database: z.string().optional(),
            path: z.string().optional(),
            url: z.string().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
            credential: z.record(configValue).optional(),
            params: z.record(configValue).optional(),
            headers: z.record(z.string()).optional(),
            writable: z.boolean().optional(),
          })
          .strict()
      )
      .optional(),
    files: z.record(z.string()).optional(),
    actions: z.record(z.object({ url: z.string().optional(), headers: z.record(z.string()).optional(), command: z.string().optional(), args: z.array(z.string()).optional() }).strict()).optional(),
    secrets: z.record(z.unknown()).optional(),
    python: z.string().optional(),
    allowedActions: z.array(z.string()).optional(),
  })
  .strict();

export function mergeOntologyBindings(base: IOntologyRuntimeBindings, overrides: IOntologyRuntimeBindings): IOntologyRuntimeBindings {
  const merge = (previous: unknown, next: unknown): unknown => {
    if (next === '' || next === undefined) return previous;
    if (!next || typeof next !== 'object' || Array.isArray(next)) return structuredClone(next);
    const initial = previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {};
    return Object.fromEntries([...new Set([...Object.keys(initial), ...Object.keys(next)])].map((key) => [key, merge(initial[key], (next as Record<string, unknown>)[key])]));
  };
  return merge(base, overrides) as IOntologyRuntimeBindings;
}
