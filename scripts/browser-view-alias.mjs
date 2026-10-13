import { fileURLToPath } from 'node:url';

// Bundle the public adapter once per host without pulling vendor JS into
// renderer declaration output, which would change workspace export paths.
export const browserPageViewAlias = {
  find: '@ai-dev-browser/remote-page',
  replacement: fileURLToPath(new URL('../vendor/ai-dev-browser/ai_dev_browser/remote/page_view.js', import.meta.url)),
};
