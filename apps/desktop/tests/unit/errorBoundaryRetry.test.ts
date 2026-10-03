import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';

afterEach(() => vi.unstubAllGlobals());

describe('error boundary retry', () => {
  it.each([new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/old.js'), new TypeError('Importing a module script failed.'), Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' })])(
    'reloads after a rejected lazy import so React can load it again: %s',
    (error) => {
      const reload = vi.fn();
      vi.stubGlobal('window', { location: { reload } });
      const onRetry = vi.fn();
      const boundary = new ErrorBoundary({ children: null, onRetry });
      boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(error) };
      const reset = vi.spyOn(boundary, 'setState');
      boundary.onRetry();
      expect(reload).toHaveBeenCalledOnce();
      expect(onRetry).toHaveBeenCalledOnce();
      expect(reset).not.toHaveBeenCalled();
    }
  );

  it('keeps ordinary render-error retries in the current page', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const onRetry = vi.fn();
    const boundary = new ErrorBoundary({ children: null, onRetry });
    boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(new Error('Temporary render failure')) };
    const reset = vi.spyOn(boundary, 'setState').mockImplementation(() => {});
    boundary.onRetry();
    expect(reload).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({ hasError: false, error: null, errorInfo: null });
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
