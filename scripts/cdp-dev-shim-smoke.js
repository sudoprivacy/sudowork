#!/usr/bin/env node
/**
 * CDP-driven smoke for the renderer dev-trigger shim
 * (`src/renderer/bootstrap/devTriggers.ts`, landed in PR #921).
 *
 * Connects to a running Electron dev instance's CDP, finds the renderer
 * page target, waits for the shim to install on `window.__sudoworkDebug`,
 * then exercises two FUSE-T entry points:
 *
 *   1. `runLazyInstallProbe()` — must return the platform-expected
 *      outcome (`platform-unsupported` on non-darwin CI runners).
 *   2. `getInstallState()` — must return `{installing: false}`
 *      immediately after (1) resolves. Pins the regression fix from
 *      the Win cold-start smoke (the previous bridge `setTimeout(..., 0)`
 *      pattern leaked `installing: true` into the same-tick read).
 *
 * Pure CI infra: no boundary leak, no new IPC channel, no source
 * changes. Drives the existing official `ipcBridge.fuseT.*.invoke()`
 * wrappers through the shim.
 *
 * Usage:
 *   node scripts/cdp-dev-shim-smoke.js \
 *     [--cdp-port 9230] \
 *     [--expect-outcome platform-unsupported] \
 *     [--wait-seconds 180]
 */

const http = require('http');
const WebSocket = require('ws');

function parseArgs(argv) {
  const out = {
    cdpPort: parseInt(process.env.NEXUS_CDP_PORT || '9230', 10),
    expectOutcome: 'platform-unsupported',
    waitSeconds: 180,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cdp-port') out.cdpPort = parseInt(argv[++i], 10);
    else if (a === '--expect-outcome') out.expectOutcome = argv[++i];
    else if (a === '--wait-seconds') out.waitSeconds = parseInt(argv[++i], 10);
  }
  return out;
}

function httpGet(url, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('http timeout'));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll /json/list until a renderer page target appears. Skip
// devtools:// entries (DevTools self-targets) and chrome-error://
// frames (sometimes show up during early renderer init).
async function findPageTarget(cdpPort, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  let lastErr = null;
  let portReady = false;
  while (Date.now() < deadline) {
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${cdpPort}/json/list`));
      portReady = true;
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://') && !t.url.startsWith('chrome-error://'));
      if (page) return page;
    } catch (err) {
      lastErr = err;
    }
    await sleep(1000);
  }
  const detail = portReady ? 'CDP port responded but no renderer page target appeared' : `CDP port :${cdpPort} never responded (Electron failed to start?)`;
  throw new Error(`${detail} within ${waitSeconds}s${lastErr ? ` — last error: ${lastErr.message}` : ''}`);
}

// One-shot Runtime.evaluate. Opens a fresh WS so call N+1 doesn't
// inherit half-handled callbacks from call N — CDP is happy with this
// and the cost is negligible compared to the renderer evaluation.
function evaluateInRendererOnce(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      reject(new Error('Runtime.evaluate timed out after 60s'));
    }, 60000);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`CDP returned non-JSON frame: ${err.message}`));
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timeout);
      ws.close();
      if (msg.error) {
        const err = new Error(`CDP error: ${JSON.stringify(msg.error)}`);
        err.cdpError = msg.error;
        reject(err);
      } else if (msg.result?.exceptionDetails) {
        reject(new Error(`Renderer threw: ${JSON.stringify(msg.result.exceptionDetails)}`));
      } else {
        resolve(msg.result);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Retry on transient CDP errors that mean "the page reloaded under us".
// Vite triggers a renderer reload when it discovers new
// optimizable deps on first navigation, which destroys the execution
// context partway through an evaluate. Up to N attempts with brief
// pauses; refetch the page target each time in case the URL changed
// (HMR keeps the same target id, but a hard reload may not).
async function evaluateInRendererResilient(cdpPort, expression, attempts = 5) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const page = await findPageTarget(cdpPort, 30);
      return await evaluateInRendererOnce(page.webSocketDebuggerUrl, expression);
    } catch (err) {
      lastErr = err;
      const transient = /Execution context was destroyed|Target closed|No target with given id|Cannot find context with specified id/i.test(err.message);
      if (!transient || i === attempts - 1) throw err;
      console.log(`[cdp-dev-shim-smoke] transient CDP error (attempt ${i + 1}/${attempts}): ${err.message}; retrying`);
      await sleep(2000);
    }
  }
  throw lastErr;
}

// Wrap the renderer-side call in a try/catch that JSON-stringifies the
// result. Avoids depending on returnByValue's handling of nested
// promises and gives us a uniform parse path on the node side.
//
// EACH probe self-waits for the shim. A previous version did one
// up-front "is shim ready?" check then called the probe — but Vite/HMR
// can reload the renderer in the window between the two evaluates,
// wiping `window.__sudoworkDebug` and surfacing as
// `TypeError: Cannot read properties of undefined (reading 'fuseT')`
// (observed PR #937 round 1 on dev tip). Self-waiting in every probe
// means a mid-eval reload either gets caught by the resilient retry
// loop (Execution context destroyed) OR by the inner wait (shim missing
// post-reload).
function wrap(jsExpr) {
  return `(async () => {
    try {
      const start = Date.now();
      while (!window.__sudoworkDebug?.fuseT && Date.now() - start < 30000) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!window.__sudoworkDebug?.fuseT) {
        return JSON.stringify({ ok: false, error: 'window.__sudoworkDebug.fuseT missing after 30s wait — devTriggers.ts may not be loaded, or this is a production build' });
      }
      return JSON.stringify({ ok: true, data: await ${jsExpr} });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.stack || e) }); }
  })()`;
}

async function main() {
  const { cdpPort, expectOutcome, waitSeconds } = parseArgs(process.argv.slice(2));
  console.log(`[cdp-dev-shim-smoke] waiting for CDP page target on :${cdpPort} (up to ${waitSeconds}s)`);
  const initialPage = await findPageTarget(cdpPort, waitSeconds);
  console.log(`[cdp-dev-shim-smoke] initial CDP target: ${initialPage.url}`);

  // Each probe expression self-waits for `window.__sudoworkDebug.fuseT`
  // (see wrap()). No need for a separate up-front check — that's the
  // race condition that PR #937 round 1 hit (Vite reloaded between the
  // up-front check and the probe call, wiping the shim).

  // Probe 1: runLazyInstallProbe.
  const probeRes = await evaluateInRendererResilient(cdpPort, wrap('window.__sudoworkDebug.fuseT.runLazyInstallProbe()'));
  const probeParsed = JSON.parse(probeRes?.result?.value || '{}');
  console.log(`[cdp-dev-shim-smoke] runLazyInstallProbe: ${JSON.stringify(probeParsed)}`);
  if (!probeParsed.ok) throw new Error(`runLazyInstallProbe threw: ${probeParsed.error}`);
  // Bridge wraps supervisor's result in {success, data: <supervisor result>}.
  const bridgeResp = probeParsed.data;
  if (!bridgeResp?.success) {
    throw new Error(`Bridge reported failure: ${JSON.stringify(bridgeResp)}`);
  }
  const outcome = bridgeResp.data?.outcome;
  if (outcome !== expectOutcome) {
    throw new Error(`Outcome mismatch: got ${outcome}, expected ${expectOutcome}. Full response: ${JSON.stringify(bridgeResp)}`);
  }

  // Probe 2: getInstallState — back-to-back with probe 1 because that's
  // the timing window that exposed the Win bug. The synchronous-reset
  // fix in fuseTBridge.ts must hold here.
  const stateRes = await evaluateInRendererResilient(cdpPort, wrap('window.__sudoworkDebug.fuseT.getInstallState()'));
  const stateParsed = JSON.parse(stateRes?.result?.value || '{}');
  console.log(`[cdp-dev-shim-smoke] getInstallState: ${JSON.stringify(stateParsed)}`);
  if (!stateParsed.ok) throw new Error(`getInstallState threw: ${stateParsed.error}`);
  const stateBridge = stateParsed.data;
  if (!stateBridge?.success) {
    throw new Error(`getInstallState bridge failure: ${JSON.stringify(stateBridge)}`);
  }
  const installing = stateBridge.data?.installing;
  if (installing !== false) {
    throw new Error(`Regression: getInstallState reports installing=${installing} immediately after a ${expectOutcome} probe. Expected false. Full: ${JSON.stringify(stateBridge)}`);
  }

  console.log(`[cdp-dev-shim-smoke] PASS — outcome=${outcome}, installing=false`);

  // Probe 3: Hub empty-state differentiation. CI runs sudowork in a
  // clean dev profile — no skillhub token provisioned — so the
  // skill-store route's fetchSkills naturally returns TOKEN_MISSING.
  // This pins the observability bug class where pre-PR users saw
  // silent "未找到技能" without any indication the cause was missing
  // login / token provisioning. With the fix, HubEmptyState renders
  // a `data-testid="hub-empty-state-token_missing"` marker — assert
  // that element exists post-navigation.
  console.log('[cdp-dev-shim-smoke] navigating to /skill-store to verify HubEmptyState');
  await navigateAndAssertHubEmptyState(cdpPort);
  console.log('[cdp-dev-shim-smoke] PASS — hub empty-state differentiation working');
}

// Drive renderer to skill-store route + wait for HubEmptyState marker.
// Two-step: hash-nav (sudowork uses HashRouter) then poll for the
// data-testid that HubEmptyState renders when error.code is TOKEN_MISSING.
async function navigateAndAssertHubEmptyState(cdpPort) {
  const navExpr = `(async () => {
    try {
      // Click the sidebar 技能商店 button — its React click handler
      // both navigates AND mounts the SkillModalContent panel. Plain
      // hash-mutation only does the URL change, not the panel mount.
      // First wait for the sidebar to render (post-cold-start), then
      // click.
      const sidebarStart = Date.now();
      let skillStoreBtn = null;
      while (Date.now() - sidebarStart < 30000) {
        skillStoreBtn = [...document.querySelectorAll('a, button, div')].find((el) => el.innerText && el.innerText.trim() === '技能商店');
        if (skillStoreBtn) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!skillStoreBtn) {
        return JSON.stringify({ ok: false, error: '技能商店 sidebar button never appeared (30s)' });
      }
      skillStoreBtn.click();
      // Wait for the empty-state marker (renderer fetches hub →
      // bridge returns TOKEN_MISSING in CI's clean-profile state →
      // HubEmptyState mounts with the testid).
      const start = Date.now();
      while (Date.now() - start < 25000) {
        const el = document.querySelector('[data-testid="hub-empty-state-token_missing"]');
        if (el) return JSON.stringify({ ok: true, code: 'TOKEN_MISSING', text: el.innerText.slice(0, 200) });
        // Fallback: accept FETCH_FAILED — if CI sudowork-server is
        // reachable but credentials fetch errors (e.g. tenant
        // misconfigured), the differentiation goal is still met.
        const fallback = document.querySelector('[data-testid="hub-empty-state-fetch_failed"]');
        if (fallback) return JSON.stringify({ ok: true, code: 'FETCH_FAILED', text: fallback.innerText.slice(0, 200) });
        await new Promise((r) => setTimeout(r, 500));
      }
      // Snapshot some diagnostics for the failure message — what
      // tabs are visible, where in the rendering cycle we got stuck.
      const tabsVisible = [...document.querySelectorAll('div, button')].filter((e) => ['技能库', '专属技能', '我的技能'].includes(e.innerText?.trim())).map((e) => e.innerText.trim());
      const allTestids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).slice(0, 10);
      return JSON.stringify({ ok: false, error: 'HubEmptyState data-testid not found within 25s', tabsVisible, allTestids, bodyTextSlice: document.body.innerText.slice(0, 400) });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.stack || e) }); }
  })()`;
  const res = await evaluateInRendererResilient(cdpPort, navExpr);
  const parsed = JSON.parse(res?.result?.value || '{}');
  console.log(`[cdp-dev-shim-smoke] HubEmptyState assert: ${JSON.stringify(parsed)}`);
  if (!parsed.ok) {
    throw new Error(`HubEmptyState assertion failed: ${parsed.error}`);
  }
}

main().catch((err) => {
  console.error(`[cdp-dev-shim-smoke] FAIL: ${err.message}`);
  process.exit(1);
});
