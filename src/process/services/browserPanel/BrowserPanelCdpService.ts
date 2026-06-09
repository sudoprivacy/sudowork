/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, session } from 'electron';
import { BROWSER_PANEL_PARTITION } from '@/common/browserPanelUrl';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * BrowserPanelCdpService — attaches a Chrome DevTools Protocol debugger to the
 * right-panel `<webview>` in the renderer and maintains ring buffers of network
 * responses and console messages so that:
 *
 *  (1) the in-process `/browser` slash command handler (added in a later commit
 *      in this PR) can read the current page's network and console state, and
 *  (2) the bundled MCP server subprocess (also a later commit) can expose those
 *      readings to the AI through tool calls.
 *
 * Commit 3 only ships the *skeleton*: attach/detach lifecycle, ring buffers,
 * and internal `listNetworkRequests` / `listConsoleMessages` methods. There is
 * intentionally no IPC bridge or external caller yet — Commit 4 wires it up.
 *
 * Design notes:
 *  - One singleton, registered at module load. `app.on('web-contents-created')`
 *    is filtered by partition so we only ever attach to right-panel webviews.
 *  - The CDP `debugger` API is part of Electron's `webContents` namespace and
 *    speaks the real Chrome DevTools Protocol — same primitive used by
 *    Puppeteer / Playwright / chrome-devtools-mcp. Verified end-to-end via the
 *    spike before this commit landed (Network.responseReceived,
 *    Runtime.evaluate, Page.captureScreenshot all worked in Electron 40).
 *  - Ring buffers use a fixed-size array + write index for O(1) eviction. They
 *    are keyed by webContentsId so each open tab has its own history.
 */

const NETWORK_BUFFER_CAPACITY = 300;
const CONSOLE_BUFFER_CAPACITY = 500;

export type NetworkResourceType = 'Document' | 'Stylesheet' | 'Image' | 'Media' | 'Font' | 'Script' | 'XHR' | 'Fetch' | 'EventSource' | 'WebSocket' | 'Other' | string;

export interface NetworkRecord {
  requestId: string;
  url: string;
  method?: string;
  type?: NetworkResourceType;
  status?: number;
  statusText?: string;
  mimeType?: string;
  /** ms since attach */
  startedAt: number;
  /** populated by loadingFinished */
  durationMs?: number;
  /** populated by loadingFailed */
  failed?: boolean;
  errorText?: string;
  canceled?: boolean;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose' | 'other';

export interface ConsoleRecord {
  level: ConsoleLevel;
  text: string;
  url?: string;
  lineNumber?: number;
  /** ms since epoch (CDP gives seconds-since-epoch — we normalize to ms) */
  at: number;
  /** primitive args, when CDP gave us return-by-value. JSON-serialized for safety. */
  args?: string[];
}

export interface TabInfo {
  webContentsId: number;
  url: string;
  title: string;
  attached: boolean;
  /** Conversation that owns this tab, or undefined for the global bucket. */
  conversationId?: string;
}

export interface EvaluateResult {
  ok: boolean;
  /** Present when ok=true. JSON-safe value returned by Runtime.evaluate (returnByValue:true). */
  value?: unknown;
  /** Set when CDP returned a description but no serializable value (e.g. functions). */
  description?: string;
  /** Set when ok=false. Concise error text from CDP. */
  errorText?: string;
  /** Set when ok=false. Stringified exception detail when available. */
  errorDetail?: string;
}

export interface ScreenshotResult {
  format: 'png' | 'jpeg';
  /** Base64-encoded image data — caller decides whether to save, return, or stream. */
  base64: string;
}

export interface NavigateResult {
  ok: boolean;
  finalUrl?: string;
  errorText?: string;
}

export interface DomSnapshotResult {
  snapshot: string | null;
}

interface NetworkFilter {
  method?: string;
  urlContains?: string;
  statusGte?: number;
  statusLt?: number;
  type?: NetworkResourceType;
}

/**
 * Tiny fixed-capacity ring buffer that overwrites the oldest entry on push.
 * O(1) push, O(n) snapshot (n ≤ capacity).
 *
 * Exported for unit testing — not part of the service's public API.
 */
export class RingBuffer<T> {
  private readonly storage: (T | undefined)[];
  private writeIndex = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.storage = new Array<T | undefined>(capacity);
  }

  push(value: T): void {
    this.storage[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** In-place update: scan from newest to oldest, replace the first match. */
  updateLatest(predicate: (value: T) => boolean, updater: (value: T) => T): boolean {
    for (let offset = 0; offset < this.size; offset += 1) {
      const idx = (this.writeIndex - 1 - offset + this.capacity) % this.capacity;
      const current = this.storage[idx];
      if (current !== undefined && predicate(current)) {
        this.storage[idx] = updater(current);
        return true;
      }
    }
    return false;
  }

  /** Snapshot from oldest to newest. */
  snapshot(): T[] {
    if (this.size < this.capacity) {
      return this.storage.slice(0, this.size) as T[];
    }
    return [...this.storage.slice(this.writeIndex), ...this.storage.slice(0, this.writeIndex)] as T[];
  }

  clear(): void {
    this.storage.fill(undefined);
    this.writeIndex = 0;
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}

interface TabState {
  webContentsId: number;
  contents: Electron.WebContents;
  network: RingBuffer<NetworkRecord>;
  consoleEntries: RingBuffer<ConsoleRecord>;
  attached: boolean;
  /** epoch (ms) when CDP attach completed; used as time origin for network startedAt */
  attachOriginMs: number;
  /**
   * Conversation that owns this tab, set when the renderer reports
   * registerTab. Used to drive per-conversation cleanup (close-by-conv on
   * conversation delete) and per-conv tab-list responses. Empty/absent
   * means the tab belongs to the global bucket (e.g. opened via the
   * sudowork-browser MCP child's /tab/open path, which doesn't know
   * which conversation triggered it).
   */
  conversationId?: string;
}

class BrowserPanelCdpService {
  private tabs = new Map<number, TabState>();
  private installed = false;
  /** Maps React-side BrowserPanel tab id (`browser-tab-...`) to webContentsId. */
  private tabIdRegistry = new Map<string, number>();
  /** webContentsId of the tab the renderer reports as active in the BrowserPanel. */
  private activeWebContentsId: number | null = null;
  /**
   * setActiveTab can arrive before the matching <webview> has fired dom-ready
   * (so registerTab hasn't been called yet). Remember the pending React tabId
   * and reconcile when registerTab finally resolves the mapping.
   */
  private pendingActiveTabId: string | null = null;

  /** Idempotent — safe to call multiple times during startup. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    app.on('web-contents-created', (_event, contents) => {
      if (!this.isRightPanelWebview(contents)) return;
      this.registerWebContents(contents);
    });
  }

  private isRightPanelWebview(contents: Electron.WebContents): boolean {
    if (contents.getType() !== 'webview') return false;
    try {
      return contents.session === session.fromPartition(BROWSER_PANEL_PARTITION);
    } catch {
      return false;
    }
  }

  private registerWebContents(contents: Electron.WebContents): void {
    const webContentsId = contents.id;
    if (this.tabs.has(webContentsId)) return;

    const state: TabState = {
      webContentsId,
      contents,
      network: new RingBuffer<NetworkRecord>(NETWORK_BUFFER_CAPACITY),
      consoleEntries: new RingBuffer<ConsoleRecord>(CONSOLE_BUFFER_CAPACITY),
      attached: false,
      attachOriginMs: 0,
    };
    this.tabs.set(webContentsId, state);
    mainLog('BrowserPanelCDP', `webview registered (id=${webContentsId})`);

    contents.once('did-finish-load', () => {
      this.attachDebugger(state).catch((err) => {
        mainError('BrowserPanelCDP', `attach failed for id=${webContentsId}: ${String(err)}`);
      });
    });

    contents.once('destroyed', () => {
      this.tabs.delete(webContentsId);
      // Drop any React tab-id rows pointing at this webContents
      for (const [tabId, mappedId] of this.tabIdRegistry) {
        if (mappedId === webContentsId) this.tabIdRegistry.delete(tabId);
      }
      if (this.activeWebContentsId === webContentsId) this.activeWebContentsId = null;
      mainLog('BrowserPanelCDP', `webview destroyed (id=${webContentsId})`);
    });

    // Render process crash: clear buffers, mark detached. Will reattach when
    // the contents reload-fires `did-finish-load` again.
    contents.on('render-process-gone', (_event, details) => {
      mainWarn('BrowserPanelCDP', `render-process-gone (id=${webContentsId}): reason=${details.reason} exitCode=${details.exitCode}`);
      state.attached = false;
      state.network.clear();
      state.consoleEntries.clear();
    });
  }

  private async attachDebugger(state: TabState): Promise<void> {
    const contents = state.contents;
    if (contents.isDestroyed()) return;
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach('1.3');
    }
    state.attached = true;
    state.attachOriginMs = Date.now();

    // CDP debugger.detach (e.g. user opens DevTools, which steals the debugger):
    // mark as detached. We don't try to fight DevTools — re-attaching while the
    // user is using DevTools would cause a loop. The next page navigation will
    // fire did-finish-load again and we'll try once more.
    contents.debugger.once('detach', (_event, reason) => {
      mainLog('BrowserPanelCDP', `debugger detached (id=${state.webContentsId}): reason=${reason}`);
      state.attached = false;
    });

    contents.debugger.on('message', (_event, method, params) => {
      this.handleCdpMessage(state, method, params);
    });

    await Promise.all([contents.debugger.sendCommand('Network.enable'), contents.debugger.sendCommand('Runtime.enable'), contents.debugger.sendCommand('Page.enable'), contents.debugger.sendCommand('Log.enable')]);

    mainLog('BrowserPanelCDP', `attached (id=${state.webContentsId}) — Network/Runtime/Page/Log enabled`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CDP event routing
  // ─────────────────────────────────────────────────────────────────────────

  private handleCdpMessage(state: TabState, method: string, params: unknown): void {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.onRequestWillBeSent(state, params as CdpRequestWillBeSent);
        break;
      case 'Network.responseReceived':
        this.onResponseReceived(state, params as CdpResponseReceived);
        break;
      case 'Network.loadingFinished':
        this.onLoadingFinished(state, params as CdpLoadingFinished);
        break;
      case 'Network.loadingFailed':
        this.onLoadingFailed(state, params as CdpLoadingFailed);
        break;
      case 'Runtime.consoleAPICalled':
        this.onConsoleApiCalled(state, params as CdpConsoleApiCalled);
        break;
      case 'Log.entryAdded':
        this.onLogEntryAdded(state, params as CdpLogEntryAdded);
        break;
      default:
        // Other CDP events (DOM.*, Page.*, etc.) are ignored at this stage.
        break;
    }
  }

  private elapsedMs(state: TabState): number {
    return Date.now() - state.attachOriginMs;
  }

  private onRequestWillBeSent(state: TabState, params: CdpRequestWillBeSent): void {
    state.network.push({
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      startedAt: this.elapsedMs(state),
    });
  }

  private onResponseReceived(state: TabState, params: CdpResponseReceived): void {
    const matched = state.network.updateLatest(
      (r) => r.requestId === params.requestId,
      (r) => ({
        ...r,
        type: params.type ?? r.type,
        status: params.response.status,
        statusText: params.response.statusText,
        mimeType: params.response.mimeType,
      }),
    );
    if (!matched) {
      // Some sub-frame and ServiceWorker flows can emit `responseReceived`
      // without a preceding `requestWillBeSent` we observed. Record it anyway
      // so we don't lose the status code.
      state.network.push({
        requestId: params.requestId,
        url: params.response.url,
        type: params.type,
        status: params.response.status,
        statusText: params.response.statusText,
        mimeType: params.response.mimeType,
        startedAt: this.elapsedMs(state),
      });
    }
  }

  private onLoadingFinished(state: TabState, params: CdpLoadingFinished): void {
    state.network.updateLatest(
      (r) => r.requestId === params.requestId,
      (r) => ({ ...r, durationMs: this.elapsedMs(state) - r.startedAt }),
    );
  }

  private onLoadingFailed(state: TabState, params: CdpLoadingFailed): void {
    state.network.updateLatest(
      (r) => r.requestId === params.requestId,
      (r) => ({ ...r, failed: true, errorText: params.errorText, canceled: params.canceled, durationMs: this.elapsedMs(state) - r.startedAt }),
    );
  }

  private onConsoleApiCalled(state: TabState, params: CdpConsoleApiCalled): void {
    const level = normalizeConsoleLevel(params.type);
    const text = formatConsoleArgs(params.args ?? []);
    state.consoleEntries.push({
      level,
      text,
      at: typeof params.timestamp === 'number' ? params.timestamp : Date.now(),
      args: (params.args ?? []).map(stringifyArg),
    });
  }

  private onLogEntryAdded(state: TabState, params: CdpLogEntryAdded): void {
    const entry = params.entry;
    state.consoleEntries.push({
      level: normalizeConsoleLevel(entry.level),
      text: entry.text,
      url: entry.url,
      lineNumber: entry.lineNumber,
      at: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read API — used by IPC bridge / slash commands / MCP server
  // ─────────────────────────────────────────────────────────────────────────

  hasTab(webContentsId: number): boolean {
    return this.tabs.has(webContentsId);
  }

  listTabs(): TabInfo[] {
    return [...this.tabs.values()].map((state) => ({
      webContentsId: state.webContentsId,
      url: state.contents.isDestroyed() ? '' : state.contents.getURL(),
      title: state.contents.isDestroyed() ? '' : state.contents.getTitle(),
      attached: state.attached,
      conversationId: state.conversationId,
    }));
  }

  listNetworkRequests(webContentsId: number, opts: { filter?: NetworkFilter; limit?: number } = {}): NetworkRecord[] {
    const state = this.tabs.get(webContentsId);
    if (!state) return [];
    const filter = opts.filter;
    const limit = opts.limit ?? 50;

    let view = state.network.snapshot();
    if (filter) {
      view = view.filter((r) => {
        if (filter.method && r.method !== filter.method) return false;
        if (filter.urlContains && !r.url.includes(filter.urlContains)) return false;
        if (filter.statusGte !== undefined && (r.status ?? -1) < filter.statusGte) return false;
        if (filter.statusLt !== undefined && (r.status ?? Number.POSITIVE_INFINITY) >= filter.statusLt) return false;
        if (filter.type && r.type !== filter.type) return false;
        return true;
      });
    }
    if (view.length > limit) view = view.slice(view.length - limit);
    return view;
  }

  listConsoleMessages(webContentsId: number, opts: { levels?: ConsoleLevel[]; limit?: number } = {}): ConsoleRecord[] {
    const state = this.tabs.get(webContentsId);
    if (!state) return [];
    const levels = opts.levels && opts.levels.length > 0 ? new Set(opts.levels) : null;
    const limit = opts.limit ?? 100;

    let view = state.consoleEntries.snapshot();
    if (levels) view = view.filter((r) => levels.has(r.level));
    if (view.length > limit) view = view.slice(view.length - limit);
    return view;
  }

  clearBuffers(webContentsId: number): void {
    const state = this.tabs.get(webContentsId);
    if (!state) return;
    state.network.clear();
    state.consoleEntries.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Tab registry (renderer → main)
  //
  //  The React-side BrowserPanel keeps its own `tabId` string for each <webview>.
  //  Main has the `webContentsId` once the contents are created. The renderer
  //  bridges the two by calling registerTab on dom-ready and setActiveTab when
  //  the user switches tabs. Without this mapping the agent tools cannot know
  //  which webview to target.
  // ─────────────────────────────────────────────────────────────────────────

  registerTab(tabId: string, webContentsId: number, conversationId?: string): void {
    this.tabIdRegistry.set(tabId, webContentsId);
    // Attach ownership to the corresponding TabState, used by
    // closeTabsByConversation when the conversation is deleted.
    const state = this.tabs.get(webContentsId);
    if (state && conversationId) {
      state.conversationId = conversationId;
    }
    // Reconcile a pending active-tab set that arrived before this dom-ready.
    if (this.pendingActiveTabId === tabId) {
      this.activeWebContentsId = webContentsId;
      this.pendingActiveTabId = null;
    } else if (this.activeWebContentsId === null) {
      // No active tab yet at all — use this one as a sensible default.
      this.activeWebContentsId = webContentsId;
    }
  }

  /**
   * Close every BrowserPanel tab that belongs to a conversation. Called by
   * conversationBridge.ts when a conversation is deleted, so the agent's
   * webview teardown happens alongside the rest of the conversation cleanup
   * (mirrors closeTerminalsByConversation in terminalBridge).
   *
   * Returns the number of tabs that were closed. Best-effort: a tab whose
   * underlying webContents is already destroyed is skipped; the
   * `'destroyed'` listener registered in registerWebContents handles the
   * map cleanup either way.
   */
  closeTabsByConversation(conversationId: string): number {
    if (!conversationId) return 0;
    let closed = 0;
    for (const [webContentsId, state] of this.tabs) {
      if (state.conversationId !== conversationId) continue;
      try {
        if (!state.contents.isDestroyed()) {
          state.contents.close();
          closed += 1;
        }
      } catch (err) {
        mainWarn('BrowserPanelCDP', `closeTabsByConversation: webContents.close failed for id=${webContentsId}: ${String(err)}`);
      }
    }
    return closed;
  }

  unregisterTab(tabId: string): void {
    this.tabIdRegistry.delete(tabId);
    if (this.pendingActiveTabId === tabId) this.pendingActiveTabId = null;
  }

  setActiveTab(tabId: string): void {
    const webContentsId = this.tabIdRegistry.get(tabId);
    if (webContentsId === undefined) {
      // Tab not registered yet (race on dom-ready). Remember it so registerTab
      // can apply it when the webview finishes loading.
      this.pendingActiveTabId = tabId;
      return;
    }
    this.activeWebContentsId = webContentsId;
    this.pendingActiveTabId = null;
  }

  /**
   * Resolve a webContentsId for an incoming tool call.
   *  - explicit `tabId` (renderer tab id string) wins
   *  - otherwise the most recently set active tab
   *  - otherwise any attached tab (multi-tab convenience, prefers the most
   *    recently registered one). Returns null only when no tab is open.
   */
  resolveWebContentsId(explicitTabId?: string): number | null {
    if (explicitTabId) {
      const mapped = this.tabIdRegistry.get(explicitTabId);
      if (mapped !== undefined && this.tabs.has(mapped)) return mapped;
    }
    if (this.activeWebContentsId !== null && this.tabs.has(this.activeWebContentsId)) {
      return this.activeWebContentsId;
    }
    // Fall back to any attached tab. Map iteration is insertion order — the
    // last item is the most recently registered.
    let lastAttached: number | null = null;
    for (const [id, state] of this.tabs) {
      if (state.attached) lastAttached = id;
    }
    return lastAttached ?? (this.tabs.size > 0 ? (this.tabs.keys().next().value as number) : null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Action API (later commits expose these to AI via slash + MCP)
  // ─────────────────────────────────────────────────────────────────────────

  async evaluateScript(webContentsId: number, opts: { expression: string; timeoutMs?: number }): Promise<EvaluateResult> {
    const state = this.requireAttached(webContentsId);
    const timeout = opts.timeoutMs ?? 10_000;
    const result = (await state.contents.debugger.sendCommand('Runtime.evaluate', {
      expression: opts.expression,
      returnByValue: true,
      awaitPromise: true,
      timeout,
    })) as { result?: CdpRemoteObject; exceptionDetails?: { text: string; exception?: CdpRemoteObject } };

    if (result.exceptionDetails) {
      return {
        ok: false,
        errorText: result.exceptionDetails.text,
        errorDetail: result.exceptionDetails.exception ? stringifyArg(result.exceptionDetails.exception) : undefined,
      };
    }
    return { ok: true, value: result.result?.value, description: result.result?.description };
  }

  async takeScreenshot(webContentsId: number, opts: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean } = {}): Promise<ScreenshotResult> {
    const state = this.requireAttached(webContentsId);
    const format = opts.format ?? 'png';
    const params: Record<string, unknown> = { format, captureBeyondViewport: opts.fullPage ?? false };
    if (format === 'jpeg' && typeof opts.quality === 'number') params.quality = Math.max(0, Math.min(100, opts.quality));
    const result = (await state.contents.debugger.sendCommand('Page.captureScreenshot', params)) as { data: string };
    return { format, base64: result.data };
  }

  async navigate(webContentsId: number, opts: { url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<NavigateResult> {
    const state = this.requireAttached(webContentsId);
    const result = (await state.contents.debugger.sendCommand('Page.navigate', { url: opts.url })) as { frameId?: string; loaderId?: string; errorText?: string };
    if (result.errorText) return { ok: false, errorText: result.errorText };

    // Best-effort wait. CDP doesn't expose a canonical "wait until" primitive;
    // we use Electron's webContents events because they're cheaper than CDP
    // polling and live in the same process.
    if (opts.waitUntil) {
      await waitForNavigation(state.contents, opts.waitUntil);
    }

    return { ok: true, finalUrl: state.contents.getURL() };
  }

  async getDomSnapshot(webContentsId: number, opts: { selector?: string; format: 'outerHTML' | 'innerText' }): Promise<DomSnapshotResult> {
    const state = this.requireAttached(webContentsId);
    const selectorJson = JSON.stringify(opts.selector ?? null);
    const expression = `(() => { const sel = ${selectorJson}; const root = sel ? document.querySelector(sel) : document.documentElement; if (!root) return null; return ${opts.format === 'innerText' ? '(root.innerText ?? root.textContent ?? null)' : '(root.outerHTML ?? null)'}; })()`;
    const result = (await state.contents.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true })) as { result?: CdpRemoteObject };
    const value = result.result?.value;
    if (typeof value !== 'string') return { snapshot: null };
    return { snapshot: value };
  }

  private requireAttached(webContentsId: number): TabState {
    const state = this.tabs.get(webContentsId);
    if (!state) throw new Error(`No registered webview for id=${webContentsId}`);
    if (!state.attached) throw new Error(`Debugger not attached for id=${webContentsId} (page may still be loading or DevTools is open)`);
    if (state.contents.isDestroyed()) throw new Error(`webContents destroyed (id=${webContentsId})`);
    return state;
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ───────────────────────────────────────────────────────────────────────────

function normalizeConsoleLevel(raw: string | undefined): ConsoleLevel {
  switch (raw) {
    case 'log':
    case 'info':
    case 'warn':
    case 'error':
    case 'debug':
    case 'verbose':
      return raw;
    case 'warning':
      return 'warn';
    default:
      return 'other';
  }
}

interface CdpRemoteObject {
  type: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
}

function stringifyArg(arg: CdpRemoteObject): string {
  if (arg === null || arg === undefined) return String(arg);
  if (arg.value !== undefined) {
    try {
      return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  return arg.description ?? arg.unserializableValue ?? `[${arg.type}]`;
}

function formatConsoleArgs(args: CdpRemoteObject[]): string {
  return args.map(stringifyArg).join(' ');
}

/**
 * Best-effort navigation wait. CDP's official primitive (Page.lifecycleEvent)
 * is verbose; for the simple "wait for load / domcontentloaded" semantic we
 * use Electron's own webContents events because they fire in-process.
 */
function waitForNavigation(contents: Electron.WebContents, waitUntil: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // networkidle: extra 500ms grace after did-finish-load. Cheap approximation
      // since Electron doesn't surface a real Network.lifecycleEvent here.
      if (waitUntil === 'networkidle') setTimeout(resolve, 500);
      else resolve();
    };
    const timeout = setTimeout(finish, 30_000);
    if (waitUntil === 'domcontentloaded') {
      contents.once('dom-ready', finish);
    } else {
      contents.once('did-finish-load', finish);
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  CDP payload type shapes (kept minimal — full spec not needed here)
// ───────────────────────────────────────────────────────────────────────────

interface CdpRequestWillBeSent {
  requestId: string;
  request: { url: string; method: string };
  type?: NetworkResourceType;
}

interface CdpResponseReceived {
  requestId: string;
  type?: NetworkResourceType;
  response: { url: string; status: number; statusText: string; mimeType: string };
}

interface CdpLoadingFinished {
  requestId: string;
}

interface CdpLoadingFailed {
  requestId: string;
  errorText: string;
  canceled?: boolean;
}

interface CdpConsoleApiCalled {
  type: string;
  args?: CdpRemoteObject[];
  timestamp?: number;
}

interface CdpLogEntryAdded {
  entry: {
    level: string;
    text: string;
    url?: string;
    lineNumber?: number;
    timestamp?: number;
  };
}

export const browserPanelCdpService = new BrowserPanelCdpService();
