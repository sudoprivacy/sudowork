/** Remove connection secrets before snapshots cross a process boundary. */
export function redactOntologySecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactOntologySecrets(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const isConnector = typeof record.sourceType === 'string' && typeof record.probeStatus === 'string';
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      if (isConnector && ['password', 'credential', 'headers'].includes(key)) return [];
      if (isConnector && key === 'credentialRef') return item ? [[key, 'stored']] : [];
      return [[key, redactOntologySecrets(item)]];
    })
  ) as T;
}
