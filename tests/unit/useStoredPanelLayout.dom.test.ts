import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Layout, LayoutChangedMeta } from 'react-resizable-panels';
import { useStoredPanelLayout } from '@renderer/hooks/useStoredPanelLayout';

describe('useStoredPanelLayout', () => {
  const storageKey = 'test-panel-layout';
  const primaryPanelId = 'primary';
  const secondaryPanelId = 'secondary';
  const defaultRatio = 50;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('restores valid stored ratio to {primary: ratio, secondary: 100-ratio}', () => {
    localStorage.setItem(storageKey, '30');

    const { result } = renderHook(() =>
      useStoredPanelLayout({
        storageKey,
        primaryPanelId,
        secondaryPanelId,
        defaultRatio,
      })
    );

    expect(result.current.defaultLayout).toEqual({
      [primaryPanelId]: 30,
      [secondaryPanelId]: 70,
    });
  });

  it('falls back to default when stored value is below minRatio', () => {
    localStorage.setItem(storageKey, '5');

    const { result } = renderHook(() =>
      useStoredPanelLayout({
        storageKey,
        primaryPanelId,
        secondaryPanelId,
        defaultRatio,
        minRatio: 10,
        maxRatio: 90,
      })
    );

    expect(result.current.defaultLayout).toEqual({
      [primaryPanelId]: 50,
      [secondaryPanelId]: 50,
    });
  });

  it('falls back to default when stored value is above maxRatio', () => {
    localStorage.setItem(storageKey, '95');

    const { result } = renderHook(() =>
      useStoredPanelLayout({
        storageKey,
        primaryPanelId,
        secondaryPanelId,
        defaultRatio,
        minRatio: 10,
        maxRatio: 90,
      })
    );

    expect(result.current.defaultLayout).toEqual({
      [primaryPanelId]: 50,
      [secondaryPanelId]: 50,
    });
  });

  it('falls back to default when stored value is not a finite number', () => {
    localStorage.setItem(storageKey, 'invalid');

    const { result } = renderHook(() =>
      useStoredPanelLayout({
        storageKey,
        primaryPanelId,
        secondaryPanelId,
        defaultRatio,
      })
    );

    expect(result.current.defaultLayout).toEqual({
      [primaryPanelId]: 50,
      [secondaryPanelId]: 50,
    });
  });

  it('saves layout when meta.isUserInteraction is true', () => {
    const { result } = renderHook(() =>
      useStoredPanelLayout({
        storageKey,
        primaryPanelId,
        secondaryPanelId,
        defaultRatio,
      })
    );

    const layout: Layout = { [primaryPanelId]: 40, [secondaryPanelId]: 60 };
    const meta: LayoutChangedMeta = { isUserInteraction: true };

    result.current.onLayoutChanged(layout, meta);

    expect(localStorage.getItem(storageKey)).toBe('40');
  });

  it('does not save layout when meta.isUserInteraction is false', () => {
    const { result } = renderHook(() =>
      useStoredPanelLayout({
        storageKey,
        primaryPanelId,
        secondaryPanelId,
        defaultRatio,
      })
    );

    const layout: Layout = { [primaryPanelId]: 40, [secondaryPanelId]: 60 };
    const meta: LayoutChangedMeta = { isUserInteraction: false };

    result.current.onLayoutChanged(layout, meta);

    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
