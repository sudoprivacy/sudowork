import { useCallback } from 'react';
import useSWR from 'swr';
import { getSudoworkServerBaseUrl } from '@sudowork/common/sudoworkServer';
import { useAuth } from '@renderer/context/AuthContext';
import { createModelBillingClient, type ModelAccount, type ModelAccountAccess } from './client';

export function useModelAccountAccess() {
  const { user, authFetch } = useAuth();
  const request = useCallback(
    async <T>(path: string, method = 'GET', body?: unknown, reference?: string): Promise<T> => {
      return createModelBillingClient(getSudoworkServerBaseUrl, authFetch)<T>(path, method, body, reference);
    },
    [authFetch]
  );
  const { data, error, isLoading, mutate } = useSWR(user?.token ? ['model-account-access', user.id, user.token] : null, () => request<ModelAccountAccess>('model-account/access'), { revalidateOnFocus: true, shouldRetryOnError: false });
  return { identityKey: JSON.stringify([user?.id, user?.token]), access: data, accessError: error as Error | undefined, isAccessLoading: isLoading, refreshAccess: mutate, request };
}

export function useModelAccount() {
  const access = useModelAccountAccess();
  const { user } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(user?.token ? ['model-account', user.id, user.token] : null, () => access.request<ModelAccount>('model-account'), { revalidateOnFocus: true, shouldRetryOnError: false });
  return { ...access, account: data, error: error as Error | undefined, isLoading, refresh: mutate };
}
