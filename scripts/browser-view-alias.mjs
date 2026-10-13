import { fileURLToPath } from 'node:url';

// Bundle the public adapter once per host without pulling vendor JS into
// renderer declaration output, which would change workspace export paths.
export const browserPageViewAlias = {
  find: '@ai-dev-browser/remote-page',
  replacement: fileURLToPath(new URL('../vendor/ai-dev-browser/ai_dev_browser/remote/page_view.js', import.meta.url)),
};

// Desktop main and both renderers resolve this runtime contract from source,
// including clean checkouts that have no workspace declaration build yet.
export const browserSessionContractAlias = {
  find: '@sudowork/contracts/browser-session',
  replacement: fileURLToPath(new URL('../packages/contracts/src/browserSession.ts', import.meta.url)),
};
