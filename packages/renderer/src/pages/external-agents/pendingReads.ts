// Share concurrent reads across mounted directory/history consumers, never across identities.
const pending = new Map<string, Promise<unknown>>();

export function sharedExternalRead<T>(identity: string, resource: string, read: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([identity, resource]);
  const active = pending.get(key);
  if (active) return active as Promise<T>;
  const result = Promise.resolve()
    .then(read)
    .finally(() => {
      if (pending.get(key) === result) pending.delete(key);
    });
  pending.set(key, result);
  return result;
}
