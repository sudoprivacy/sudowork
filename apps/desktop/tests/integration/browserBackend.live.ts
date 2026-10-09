import { exec, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { AdbResultSidechannel } from '../../src/process/services/sudoclaw/AdbResultSidechannel';

// Only the Electron logger is replaced. HTTP, wrappers, both backends and Chrome are real.
vi.mock('@process/utils/mainLogger', () => ({ mainLog: () => {}, mainWarn: () => {}, mainError: () => {} }));

const runFile = promisify(execFile);
const runShell = promisify(exec);
const root = path.resolve(__dirname, '../../../..');
const wrappers = path.join(root, 'apps/desktop/resources/sudoclaw-bin');
const python = process.env.BROWSER_TEST_PYTHON ?? 'python';
const output = path.join(root, '.tmp/browser-migration', `wrapper-${Date.now()}`);
const html = `<!doctype html><html><meta charset="utf-8"><title>Browser migration reservation</title>
<style>body{font:20px sans-serif;max-width:720px;margin:60px auto;background:#eef5ff}input,button{font:inherit;padding:12px}#receipt{padding:24px;background:white;margin-top:24px}</style>
<h1>Reserve a migration review</h1><form><label>Attendee <input aria-label="Attendee" required></label>
<button id="reserve-now">Reserve one seat</button></form><div id="receipt">No reservation yet</div>
<script>
async function refresh(){const state=await (await fetch('/state')).json();document.querySelector('#receipt').textContent=state.receipts.length?'Reserved: '+state.receipts[0].name+' / '+state.receipts[0].id:'No reservation yet';}
document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();await fetch('/reserve',{method:'POST',body:JSON.stringify({name:document.querySelector('input').value,trusted:e.isTrusted})});await refresh();};refresh();
</script></html>`;

describe('real browser wrapper migration', () => {
  it.each(['ai-dev-browser', 'sudohand'])('%s: discover → reserve → capture → reload, with correlated results', async (backend) => {
    expect(process.env.SUDOWORK_SUDOHAND_PATH, 'Set SUDOWORK_SUDOHAND_PATH to the pinned suh binary').toBeTruthy();
    const receipts: { name: string; trusted: boolean; id: string }[] = [];
    const fixture = createServer((req, res) => {
      if (req.url === '/reserve' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          receipts.push({ ...JSON.parse(body), id: randomUUID() });
          res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(receipts.at(-1)));
        });
      } else if (req.url === '/state') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ receipts }));
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
      }
    });
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;
    const sidechannel = new AdbResultSidechannel();
    await sidechannel.start();
    const artifacts = path.join(output, backend);
    const installedWrappers = path.join(artifacts, 'bin');
    await mkdir(installedWrappers, { recursive: true });
    for (const name of ['browser', 'browser.cmd', 'browser_helper.py']) {
      await copyFile(path.join(wrappers, name), path.join(installedWrappers, name));
    }
    // Production installation makes the resource executable on Unix.
    if (process.platform !== 'win32') await chmod(path.join(installedWrappers, 'browser'), 0o755);
    const env = {
      ...process.env,
      PATH: `${path.dirname(python)}${path.delimiter}${process.env.PATH}`,
      PYTHONPATH: path.join(root, 'vendor/ai-dev-browser'),
      PYTHONUTF8: '1',
      SUDOWORK_BROWSER_BACKEND: backend,
      AI_DEV_BROWSER_TRANSPORT: 'cdp',
      AI_DEV_BROWSER_OS_CLICK: 'false',
      AI_DEV_BROWSER_HEADLESS: 'new',
      AI_DEV_BROWSER_OUTPUT_DIR: artifacts,
      AI_DEV_BROWSER_SIDECHANNEL_URL: sidechannel.getEndpoint(),
      AI_DEV_BROWSER_SIDECHANNEL_SECRET: sidechannel.getSecret(),
    };
    for (const key of ['AI_DEV_BROWSER_PORT', 'AI_DEV_BROWSER_TAB_URL', 'AI_DEV_BROWSER_REDIRECT', 'AI_DEV_BROWSER_VIEWPORT']) delete env[key as keyof typeof env];
    if (backend === 'ai-dev-browser') delete env.SUDOWORK_BROWSER_BACKEND;
    const calls: unknown[] = [];
    async function call(argv: string[], overrides: NodeJS.ProcessEnv = {}, isShim = false) {
      const callId = randomUUID();
      const options = { env: { ...env, ...overrides, AI_DEV_BROWSER_CALL_ID: callId }, cwd: artifacts, timeout: 70_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' as const };
      let code = 0;
      let stdout = '';
      let stderr = '';
      try {
        const result = isShim ? await runShell(`"${path.join(installedWrappers, process.platform === 'win32' ? 'browser.cmd' : 'browser')}" --list`, options) : await runFile(python, [path.join(installedWrappers, 'browser_helper.py'), ...argv], options);
        ({ stdout, stderr } = result);
      } catch (error) {
        const failure = error as { code: number; stdout: string; stderr: string; killed?: boolean };
        expect(failure.killed, 'wrapper timed out').not.toBe(true);
        expect(typeof failure.code).toBe('number');
        code = failure.code;
        stdout = failure.stdout;
        stderr = failure.stderr;
      }
      // Python's console stream uses CRLF on Windows; the JSON POST contains LF.
      const visible = (stdout.trim() ? stdout : stderr).replace(/\r\n/g, '\n');
      const received = sidechannel.takeByCallId(callId);
      const cmd = `browser ${argv.join(' ')}`.trim().replace(/\s+/g, ' ');
      expect(received, `${backend}: missing sidechannel result for ${argv[0]}`).not.toBeNull();
      expect(received).toMatchObject({ callId, argv, cmd, exitCode: code, stdoutRaw: visible, cmdHash: createHash('sha1').update(cmd).digest('hex') });
      expect(received!.finishedAt).toBeGreaterThanOrEqual(received!.startedAt);
      expect(await sidechannel.waitForCmd(received!.cmdHash, 20), 'duplicate result').toBeNull();
      calls.push({ argv, code, stdout, stderr });
      return { code, stdout, stderr, payload: () => JSON.parse(visible) };
    }
    let port: string | undefined;
    async function tool(name: string, ...args: string[]) {
      const result = await call([name, ...(port ? ['--port', port] : []), ...args]);
      expect(result.code, result.stderr || result.stdout).toBe(0);
      const payload = result.payload();
      expect(payload.error).toBeFalsy();
      return payload;
    }
    try {
      const listing = await call(['--list'], {}, true);
      expect(listing.code, listing.stderr).toBe(0);
      expect(listing.stdout).toContain('page_discover');
      expect(listing.stdout).toContain('type_by_ref');
      const help = await call(['type_by_ref', '--help']);
      expect(help.stdout).toContain('--ref');
      if (backend === 'sudohand') expect(help.stdout).toContain('Usage: browser type_by_ref');
      const started = await tool('browser_start', '--headless', 'new', '--temp');
      expect(started.reused).not.toBe(true);
      expect(started.pid).toBeGreaterThan(0);
      port = String(started.port);
      expect(Number(port)).toBeGreaterThan(0);
      await tool('page_goto', '--url', url);
      const discovered = await tool('page_discover');
      const elements = Array.isArray(discovered) ? discovered : discovered.elements;
      expect(Array.isArray(elements), JSON.stringify(discovered)).toBe(true);
      const field = elements.find((item: { name: string }) => item.name === 'Attendee');
      const button = elements.find((item: { name: string }) => item.name === 'Reserve one seat');
      expect(field?.ref).toBeTruthy();
      expect(button?.ref).toBeTruthy();
      await tool('type_by_ref', '--ref', field.ref, '--text', '迁移验收 Ada');
      await tool('click_by_ref', '--ref', button.ref);
      await expect.poll(() => receipts.length).toBe(1);
      expect(receipts[0]).toMatchObject({ name: '迁移验收 Ada', trusted: true });
      const receipt = receipts[0].id;
      const screenshot = path.join(artifacts, 'receipt 中文.png');
      const captured = await tool('page_screenshot', '--path', screenshot);
      expect(captured.path).toBe(screenshot);
      const png = await readFile(captured.path);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.length).toBeGreaterThan(2000);
      await tool('page_goto', '--url', url);
      const observed = await tool('js_evaluate', '--expression', 'document.querySelector("#receipt").textContent');
      expect(observed.result).toBe(`Reserved: 迁移验收 Ada / ${receipt}`);
      // A stale locator must not submit again. Recovery can discover the new target.
      const missing = await call(['click_by_html_id', '--port', port, '--html-id', 'retired-button']);
      if (backend === 'sudohand') {
        expect(missing.code).toBe(4);
        expect(missing.payload().error.retryable).toBe(false);
        const invalid = await call(['click_by_html_id', '--id', 'reserve-now']);
        expect(invalid.code).toBe(2);
        expect(invalid.payload().error.message).toContain('Usage: browser click_by_html_id');
        const absent = await call(['page_info', '--port', port], { SUDOWORK_SUDOHAND_PATH: path.join(artifacts, 'missing-suh') });
        expect(absent.code).toBe(127);
        expect(absent.payload().error.kind).toBe('backend_unavailable');
        const unsupported = await call(['missing_browser_action', '--port', port]);
        expect(unsupported.code).toBe(2);
        expect(unsupported.payload().error.kind).toBe('invalid_input');
        const invalidBackend = await call(['--list'], { SUDOWORK_BROWSER_BACKEND: 'unknown' });
        expect(invalidBackend.code).toBe(2);
        expect(invalidBackend.payload().error.hint).toContain('ai-dev-browser or sudohand');
        const redirected = await call(['page_info', '--port', port], { AI_DEV_BROWSER_REDIRECT: 'Use the embedded browser panel.' });
        expect(redirected.code).toBe(1);
        expect(redirected.payload().error.hint).toBe('Use the embedded browser panel.');
      }
      const recovered = await tool('page_discover');
      expect(JSON.stringify(recovered)).toContain('Reserve one seat');
      expect(receipts).toHaveLength(1);
    } finally {
      try {
        if (port) await tool('browser_stop');
      } finally {
        await writeFile(path.join(artifacts, 'calls.json'), JSON.stringify(calls, null, 2));
        await sidechannel.stop();
        await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())));
      }
    }
  });
});
