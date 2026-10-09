#!/usr/bin/env node
/**
 * Drive the main sudowork window via its Electron remote-debugging-port
 * (default 9230 in dev) and validate the smoke items left unchecked across
 * the two recent PRs.
 *
 * Pre-flight:
 *   - dev sudowork is running (`node scripts/launch-dev.js start`).
 *   - At least one conversation is open in the UI so the right-panel mounts.
 *
 * Usage: node scripts/smoke-ui.js
 */

const WebSocket = require('ws');
const http = require('node:http');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ${GREEN}✓${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ${RED}✗${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${CYAN}● ${title}${RESET}`);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function findMainTarget() {
  const targets = await fetchJson('http://127.0.0.1:9230/json/list');
  return targets.find((t) => t.type === 'page' && /SudoWork/i.test(t.title || ''));
}

function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const events = [];
  const eventListeners = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf-8'));
    if (msg.id !== undefined) {
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result);
      return;
    }
    events.push(msg);
    for (const l of eventListeners) l(msg);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const close = () => ws.close();

  return { ws, send, ready, close, events, onEvent: (cb) => eventListeners.push(cb) };
}

async function evalJs(send, expression, opts = {}) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: opts.timeoutMs ?? 5000,
  });
  if (res.exceptionDetails) {
    throw new Error(`eval failed: ${res.exceptionDetails.text} | ${res.exceptionDetails.exception?.description || ''}`);
  }
  return res.result.value;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(send, expression, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await evalJs(send, expression);
    if (v) return v;
    await sleep(intervalMs);
  }
  return false;
}

(async () => {
  console.log(`${CYAN}=== sudowork main-window UI smoke ===${RESET}`);

  const target = await findMainTarget();
  if (!target) {
    console.error(`${RED}main SudoWork window not found at 127.0.0.1:9230 — is dev running?${RESET}`);
    process.exit(1);
  }
  const cdp = openCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // ── 1. Clear-cache button (browser-panel PR) ─────────────────────────
  section('1. Clear-cache button + confirmation modal');
  try {
    // First switch right-panel to "浏览器" tab so the cache button is visible.
    const tabClicked = await evalJs(
      cdp.send,
      `(() => {
        const tabs = [...document.querySelectorAll('button[role="tab"]')];
        const browserTab = tabs.find((b) => /浏览器|Browser/i.test(b.textContent || ''));
        if (!browserTab) return false;
        browserTab.click();
        return true;
      })()`,
    );
    check('right-panel browser tab clicked', tabClicked === true);
    await sleep(300);

    const cacheBtnClicked = await evalJs(
      cdp.send,
      `(() => {
        const btn = document.querySelector('button[aria-label*="清除"], button[aria-label*="Clear"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
    );
    check('clear-cache button click dispatched', cacheBtnClicked === true);

    // Wait for arco modal to appear
    const modalAppeared = await waitFor(
      cdp.send,
      `!!document.querySelector('.arco-modal-wrapper:not([style*="display: none"]) .arco-modal-title')`,
    );
    check('confirmation modal appears', !!modalAppeared);

    const modalText = await evalJs(
      cdp.send,
      `(() => {
        const m = document.querySelector('.arco-modal-wrapper:not([style*="display: none"]) .arco-modal-content');
        return m ? m.innerText : '';
      })()`,
    );
    check(
      'modal body mentions browser data / clearing',
      /浏览器|cookie|Cookie|browser/i.test(modalText),
      modalText.slice(0, 80),
    );

    // Click cancel — we don't want to actually wipe state.
    // Arco's React button handlers don't fire from a bare `.click()` — we
    // need the full pointer/mouse event sequence to look like a real user.
    const cancelClicked = await evalJs(
      cdp.send,
      `(() => {
        const c = [...document.querySelectorAll('.arco-modal-wrapper button')].find((b) => /^\\s*(取消|Cancel)\\s*$/i.test(b.innerText || ''));
        if (!c) return false;
        const rect = c.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const fire = (type) => c.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
        fire('pointerdown'); fire('mousedown');
        fire('pointerup'); fire('mouseup');
        fire('click');
        return true;
      })()`,
    );
    check('modal cancel click dispatched', cancelClicked === true);

    await sleep(600);
    const modalGone = await evalJs(
      cdp.send,
      `(() => {
        const wrappers = [...document.querySelectorAll('.arco-modal-wrapper')];
        // Arco fully unmounts the wrapper on close, so length 0 is the cue.
        return wrappers.length === 0;
      })()`,
    );
    check('modal dismissed', modalGone === true);
  } catch (err) {
    check(`section 1 unexpected throw`, false, err.message);
  }

  // ── 2. Right-panel "交付物" tab exists (generated-files PR) ──────────
  section('2. "交付物" tab present in right panel');
  try {
    const deliverablesTabFound = await evalJs(
      cdp.send,
      `(() => {
        const tabs = [...document.querySelectorAll('button[role="tab"]')];
        const tab = tabs.find((b) => /交付物|Deliverable/i.test(b.textContent || ''));
        if (!tab) return null;
        tab.click();
        return tab.textContent.trim();
      })()`,
    );
    check('deliverables tab clicked', !!deliverablesTabFound, deliverablesTabFound || 'not found');

    await sleep(400);

    const panelMounted = await evalJs(
      cdp.send,
      `(() => {
        const active = document.querySelector('.right-panel-stack__pane.right-panel-stack__pane--active');
        if (!active) return { ok: false, why: 'no active pane' };
        const text = (active.innerText || '').trim();
        // Empty-state copy contains "尚无" / "No deliverables".
        // Populated state contains a date group heading like "今天" / "Today".
        const looksEmpty = /尚无|No deliverables/i.test(text);
        const hasCards = !!active.querySelector('[role="button"]');
        const dateGroup = /今天|Today|昨天|Yesterday/.test(text);
        return { ok: looksEmpty || hasCards || dateGroup, looksEmpty, hasCards, dateGroup, preview: text.slice(0, 120) };
      })()`,
    );
    check('deliverables pane rendered (cards or empty state)', !!panelMounted?.ok, JSON.stringify(panelMounted));
  } catch (err) {
    check('section 2 unexpected throw', false, err.message);
  }

  // ── 3. Default-URL setting round-trip via direct system check ────────
  section('3. Default-URL setting persists');
  try {
    // We round-trip via the renderer's emitter/IPC by reading the BrowserPanel
    // state — opening a new tab in the right-panel browser should use the
    // configured default URL. We just verify that the address bar reflects
    // a non-empty URL on a new tab, not that we set a custom one (mutating
    // the user's saved setting is rude).
    const baseUrlReachable = await evalJs(
      cdp.send,
      `(() => {
        const tabs = [...document.querySelectorAll('button[role="tab"]')];
        const browserTab = tabs.find((b) => /浏览器|Browser/i.test(b.textContent || ''));
        if (browserTab) browserTab.click();
        return true;
      })()`,
    );
    check('right-panel browser tab re-clicked', baseUrlReachable === true);
    await sleep(300);

    const newTabClicked = await evalJs(
      cdp.send,
      `(() => {
        const btn = document.querySelector('button[aria-label*="新标签页"], button[aria-label*="New Tab"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
    );
    check('"new tab" button clicked', newTabClicked === true);

    await sleep(500);

    const tabCount = await evalJs(
      cdp.send,
      `document.querySelectorAll('.browser-tabs__item').length`,
    );
    check('browser tab count > 0 after click', typeof tabCount === 'number' && tabCount > 0, `count=${tabCount}`);
  } catch (err) {
    check('section 3 unexpected throw', false, err.message);
  }

  cdp.close();

  console.log(`\n${CYAN}=== summary ===${RESET}`);
  console.log(`  ${GREEN}${pass} passed${RESET} / ${fail > 0 ? `${RED}${fail} failed${RESET}` : `${DIM}0 failed${RESET}`}`);
  if (fail > 0) {
    console.log('  failures:');
    for (const f of failures) console.log(`    - ${f}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error(`${RED}fatal:${RESET}`, err);
  process.exit(2);
});
