import { ipcBridge } from '@/common';
import { useAuth } from '@/renderer/context/AuthContext';
import { useCallback, useState } from 'react';

interface ModelUsageData {
  date: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number | null;
}

interface ModelUsageStatsResponse {
  success: boolean;
  data: ModelUsageData[];
}

interface UseModelUsageStatsResult {
  data: ModelUsageData[];
  loading: boolean;
  error: string | null;
  fetchStats: (startDate: string, endDate: string) => Promise<void>;
}

export function useModelUsageStats(): UseModelUsageStatsResult {
  const { user: currentUser, ensureValidToken } = useAuth();
  const [data, setData] = useState<ModelUsageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(
    async (startDate: string, endDate: string) => {
      if (!currentUser?.token) return;

      setLoading(true);
      setError(null);

      try {
        const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
        const token = await ensureValidToken();
        if (!token) {
          setError('NO_TOKEN');
          setLoading(false);
          return;
        }

        const response = await fetch(`${serverConfig.baseUrl}/api/v1/user/model-usage-stats?start_date=${startDate}&end_date=${endDate}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const result: ModelUsageStatsResponse = await response.json();

        if (result.success) {
          setData(result.data);
        } else {
          setError(result.success ? null : 'Failed to fetch data');
        }
      } catch (err) {
        console.error('Failed to fetch model usage stats:', err);
        setError('Failed to fetch model usage stats');
      } finally {
        setLoading(false);
      }
    },
    [currentUser?.token, ensureValidToken]
  );

  return { data, loading, error, fetchStats };
}
