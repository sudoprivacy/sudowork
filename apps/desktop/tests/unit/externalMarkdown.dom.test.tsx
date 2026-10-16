import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MarkdownView from '@renderer/components/Markdown';

const boundary = vi.hoisted(() => ({ localImage: vi.fn(), workspaceLink: vi.fn(), open: vi.fn() }));
vi.mock('@renderer/context/ConversationContext', () => ({ useConversationContextSafe: () => ({ workspace: '/private/workspace' }) }));
vi.mock('@renderer/components/WorkspaceFileLink', () => ({ default: boundary.workspaceLink }));
vi.mock('@renderer/components/LocalImageView', () => ({ default: boundary.localImage }));
vi.mock('@renderer/utils/platform', () => ({ openExternalUrl: boundary.open }));
vi.mock('@renderer/utils/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it('shares code and math rendering while blocking external HTML, local files and image loads', async () => {
  const content = '<img src="https://tracker.test/html">\n\n![remote](https://tracker.test/image)\n\n![local](file:///private/secret.png)\n\n[local file](file:///private/secret.txt)\n\n[website](https://example.com)\n\n```js\nconst answer = 42;\n```\n\n$x^2$';
  const { container } = render(
    <MarkdownView isExternalContent allowHtml>
      {content}
    </MarkdownView>
  );
  await waitFor(() => expect(container.querySelector('.markdown-shadow')?.shadowRoot?.querySelector('.katex')).toBeTruthy());
  const shadow = container.querySelector('.markdown-shadow')!.shadowRoot!;
  expect(shadow.querySelector('img')).toBeNull();
  expect(shadow.querySelector('a[href^="file:"]')).toBeNull();
  expect(shadow.querySelector('a[href="https://example.com"]')?.getAttribute('rel')).toContain('noopener');
  expect(shadow.textContent).toContain('const answer = 42;');
  expect(boundary.localImage).not.toHaveBeenCalled();
  expect(boundary.workspaceLink).not.toHaveBeenCalled();
  expect(boundary.open).not.toHaveBeenCalled();
});
