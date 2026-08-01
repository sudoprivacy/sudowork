import { useCallback, useState } from 'react';
import type { Layout, LayoutChangedMeta } from 'react-resizable-panels';

export function useStoredPanelLayout({ storageKey, primaryPanelId, secondaryPanelId, defaultRatio, minRatio = 0, maxRatio = 100 }: IUseStoredPanelLayoutOptions) {
  const [defaultLayout] = useState<Layout>(() => {
    let ratio = defaultRatio;

    try {
      const storedValue = localStorage.getItem(storageKey);
      const storedRatio = storedValue === null ? NaN : Number(storedValue);
      if (Number.isFinite(storedRatio) && storedRatio >= minRatio && storedRatio <= maxRatio) {
        ratio = storedRatio;
      }
    } catch {
      // Ignore unavailable storage.
    }

    return { [primaryPanelId]: ratio, [secondaryPanelId]: 100 - ratio };
  });

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) {
        return;
      }

      const ratio = layout[primaryPanelId];
      if (!Number.isFinite(ratio) || ratio < minRatio || ratio > maxRatio) {
        return;
      }

      try {
        localStorage.setItem(storageKey, String(ratio));
      } catch {
        // Ignore unavailable storage.
      }
    },
    [maxRatio, minRatio, primaryPanelId, storageKey]
  );

  return { defaultLayout, onLayoutChanged };
}

interface IUseStoredPanelLayoutOptions {
  storageKey: string;
  primaryPanelId: string;
  secondaryPanelId: string;
  defaultRatio: number;
  minRatio?: number;
  maxRatio?: number;
}
