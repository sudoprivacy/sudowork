/// <reference types="vite/client" />
/**
 * Renderer-side dev-mode debug triggers, attached at
 * `window.__sudoworkDebug`. Gated by Vite's `import.meta.env.DEV` so the
 * production renderer bundle ships zero of this code — the entire
 * module body lives behind a build-time conditional that the bundler
 * eliminates when DEV is `false`.
 *
 * ## Why this lives in the renderer
 *
 * The supervisor PR's first e2e attempt tried to test FUSE-T install
 * from outside the renderer process (CDP `Runtime.evaluate`). The
 * `bridge.buildProvider` SSOT requires a `subscribe-` emit + a
 * correlated `subscribe.callback-` listener to round-trip — fine for
 * the platform's own `.invoke()` wrapper (which renderer TS uses
 * happily) but hard to drive correctly from outside that wrapper.
 *
 * Two paths were rejected before landing this one:
 *
 *   * A raw IPC bypass handler in the main bridge + a matching
 *     preload helper — every channel was a second route to the same
 *     provider, bypassing `bridge.buildProvider`. Boundary leak. The
 *     integration test `fuseT.integration.test.ts` (the
 *     no-dev-IPC-bypass-channels case) exists exactly to catch this
 *     regression (PR #916 added it the first time the pattern landed +
 *     had to be ripped out).
 *
 *   * A renderer UI button — clean but UX-coupled; CDP wants a
 *     promise-returning entry point, not a click target.
 *
 * This shim is the third option: stay inside the renderer namespace,
 * delegate to the OFFICIAL `ipcBridge.fuseT.*.invoke()` wrappers (which
 * already round-trip through `bridge.buildProvider` correctly), and
 * publish a typed Promise-returning handle on `window.__sudoworkDebug`.
 *
 * Net contract:
 *   - No new IPC channel.
 *   - No raw electron-renderer / electron-main API imports here.
 *   - No preload edit.
 *   - No raw subscribe-channel string literals — those stay hidden
 *     inside the platform library where they belong.
 *   - Tree-shaken to zero bytes in the production renderer bundle.
 *
 * ## Scoping
 *
 * Covers the three FUSE-T providers the supervisor PR introduced
 * (`runLazyInstallProbe`, `checkInstalled`, `getInstallState`) because
 * that's the loop Mac e2e drives today. Adding a new debug trigger
 * for a different provider means appending to the literal below;
 * never reach for the rejected paths above as a "faster" workaround.
 */

import { ipcBridge } from '@/common';

declare global {
  interface Window {
    /**
     * Renderer-side debug shim populated only when Vite's `DEV` flag
     * is on. `undefined` in production builds because the assignment
     * is dead-code-eliminated.
     */
    __sudoworkDebug?: {
      fuseT: {
        runLazyInstallProbe: () => ReturnType<typeof ipcBridge.fuseT.runLazyInstallProbe.invoke>;
        checkInstalled: () => ReturnType<typeof ipcBridge.fuseT.checkInstalled.invoke>;
        getInstallState: () => ReturnType<typeof ipcBridge.fuseT.getInstallState.invoke>;
      };
    };
  }
}

if (import.meta.env.DEV) {
  window.__sudoworkDebug = {
    fuseT: {
      runLazyInstallProbe: () => ipcBridge.fuseT.runLazyInstallProbe.invoke(),
      checkInstalled: () => ipcBridge.fuseT.checkInstalled.invoke(),
      getInstallState: () => ipcBridge.fuseT.getInstallState.invoke(),
    },
  };
}

export {};
