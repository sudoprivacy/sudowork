import { useCallback } from 'react';
import useSWR from 'swr';
import { getSudoworkServerBaseUrl } from '@sudowork/common/sudoworkServer';
import { useAuth } from '@renderer/context/AuthContext';
import { createModelBillingClient, type ModelAccount } from './client';

export function useModelAccount() {
  const { user, authFetch } = useAuth();
  const request = useCallback(
    async <T>(path: string, method = 'GET', body?: unknown, reference?: string): Promise<T> => {
      return createModelBillingClient(getSudoworkServerBaseUrl, authFetch)<T>(path, method, body, reference);
    },
    [authFetch]
  );
  const { data, error, isLoading, mutate } = useSWR(user?.token ? ['model-account', user.id, user.token] : null, () => request<ModelAccount>('model-account'), { revalidateOnFocus: true, shouldRetryOnError: false });
  return { identityKey: JSON.stringify([user?.id, user?.token]), account: data, error: error as Error | undefined, isLoading, refresh: mutate, request };
}
