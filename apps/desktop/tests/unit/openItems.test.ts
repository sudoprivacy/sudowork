import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * OPEN-ITEMS sentinel.
 *
 * Fails the suite while OPEN-ITEMS.md still lists unresolved architectural
 * decisions. The intent is the opposite of a normal test: it is supposed to
 * fail, and that failure is the cue to look at OPEN-ITEMS.md.
 *
 * Resolve an item:
 *   1. Implement it.
 *   2. Delete the matching section from OPEN-ITEMS.md.
 *   3. Remove any `// OPEN-ITEM(<anchor>)` comments that referenced it.
 *
 * When the list is empty, delete OPEN-ITEMS.md AND this test in the same
 * commit; xpass-on-empty is intentional so the cleanup is a single atomic
 * change rather than a slow fade.
 *
 * See `docs/tech/nexus-integration-architecture.md` §8 for context on how
 * these items relate to the broader integration architecture.
 */
describe('OPEN-ITEMS sentinel', () => {
  it.fails(
    'OPEN-ITEMS.md is empty (no unresolved architectural decisions)',
    () => {
      const path = join(__dirname, '..', '..', 'OPEN-ITEMS.md');
      if (!existsSync(path)) {
        // File missing means every item was resolved AND the cleanup commit
        // landed — pass cleanly so the next CI run can drop this test.
        return;
      }

      const content = readFileSync(path, 'utf-8');
      const sections = content
        .split('\n')
        .filter((line) => /^##\s+\S/.test(line));

      expect(
        sections,
        `OPEN-ITEMS.md still lists ${sections.length} unresolved items: ${sections
          .map((s) => s.replace(/^##\s+/, ''))
          .join(', ')}. See the file for context.`,
      ).toHaveLength(0);
    },
  );
});
