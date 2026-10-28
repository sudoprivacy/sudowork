import React, { createContext, useContext, useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';

const ShareoneCliStatusContext = createContext(false);

/** Keep CLI discovery outside virtualized message footers. */
export function ShareoneCliStatusProvider({ children }: IShareoneCliStatusProviderProps) {
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    let isClosed = false;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const result = await ipcBridge.shareoneCli.checkInstalled.invoke();
        if (!isClosed && current === generation) setIsInstalled(Boolean(result?.success && result.data?.installed));
      } catch {
        if (!isClosed && current === generation) setIsInstalled(false);
      }
    };
    void refresh();
    const unsubscribe = ipcBridge.shareoneCli.installResult.on(() => void refresh());
    return () => {
      isClosed = true;
      unsubscribe();
    };
  }, []);

  return <ShareoneCliStatusContext.Provider value={isInstalled}>{children}</ShareoneCliStatusContext.Provider>;
}

export function useShareoneCliInstalled(): boolean {
  return useContext(ShareoneCliStatusContext);
}

interface IShareoneCliStatusProviderProps {
  children: React.ReactNode;
}
