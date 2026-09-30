import { buildNamespace } from '@sudowork/common/nexus/namespace';
import { MossSecretClient } from '@sudowork/common/nexus/moss-secret-client';
import { getMossServerUrl, getUserId, isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/** Resolve the current enterprise user's ShareOne credential without caching plaintext. */
export async function getShareoneApiKeyEnterprise(): Promise<string | null> {
  if (!isEnterpriseMode()) return null;

  const userId = getUserId();
  const serverUrl = getMossServerUrl();
  if (!userId || !serverUrl) return null;

  try {
    const { getValidToken } = await import('@process/bridge/eeclawBridge');
    const authToken = await getValidToken();
    const client = new MossSecretClient(serverUrl, authToken, userId);
    const namespace = buildNamespace('shareone', userId);

    for (const key of ['shareone_key', 'api_key', 'X-API-Key']) {
      const apiKey = (await client.getSecret(namespace, key))?.trim();
      // A login switch while fetching must not pass the previous user's key to a new session.
      if (!isEnterpriseMode() || getUserId() !== userId || getMossServerUrl() !== serverUrl) return null;
      if (apiKey) {
        mainLog('ShareOne', 'Loaded current user API key from Moss');
        return apiKey;
      }
    }
    return null;
  } catch {
    mainWarn('ShareOne', 'Could not load current user API key from Moss');
    return null;
  }
}
