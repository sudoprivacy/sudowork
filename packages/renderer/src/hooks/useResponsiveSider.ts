import { useEffect, useState } from 'react';

const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';

/** Keep the composer usable on narrow screens, including after navigation. */
export function useResponsiveSider(pathname: string) {
  const [isCollapsed, setIsCollapsed] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(NARROW_VIEWPORT_QUERY).matches));

  useEffect(() => {
    const query = window.matchMedia?.(NARROW_VIEWPORT_QUERY);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsCollapsed(true);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (window.matchMedia?.(NARROW_VIEWPORT_QUERY).matches) setIsCollapsed(true);
  }, [pathname]);

  return { isCollapsed, setIsCollapsed };
}
