import { describe, expect, it } from 'vitest';
import { isDesktopOnlyRoute } from '@renderer/utils/platform';

describe('desktop service route boundaries', () => {
  it.each(['/app/local-kb', '/app/ontology', '/app/ontology/graph-1', '/app/ontology/graph-1/data', '/app/security', '/settings/security'])('requires the desktop host for %s', (path) => {
    expect(isDesktopOnlyRoute(path)).toBe(true);
  });

  it.each(['/guid', '/app/agent', '/app/skills', '/app/ontology-other', '/app/local-kb-other', '/settings/profile'])('keeps shared routes available: %s', (path) => {
    expect(isDesktopOnlyRoute(path)).toBe(false);
  });
});
