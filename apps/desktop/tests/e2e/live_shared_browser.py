"""Real AI and trusted UI input against a configured, isolated Desktop instance.

Start the built app with its normal model credentials and an isolated home, then:
  python tests/e2e/live_shared_browser.py --port <CDP port> --output <evidence dir>

Requires the pinned ai-dev-browser remote package and an actual model account.
No browser control, agent output, takeover acknowledgement, or model is mocked.
"""

import argparse
import asyncio
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from uuid import uuid4

import aiohttp


class UI:
    def __init__(self, session, target):
        self.session = session
        self.target = target
        self.sequence = 0
        self.trace = []

    async def command(self, method, params=None):
        # A short-lived connection avoids consuming another viewer's events.
        trace = {'method': method, 'acknowledged': False}
        self.trace.append(trace)
        async with asyncio.timeout(30):
            async with self.session.ws_connect(self.target['webSocketDebuggerUrl']) as ws:
                self.sequence += 1
                await ws.send_json({'id': self.sequence, 'method': method, 'params': params or {}})
                async for message in ws:
                    value = json.loads(message.data)
                    if value.get('id') == self.sequence:
                        if 'error' in value:
                            raise RuntimeError(value['error'])
                        trace['acknowledged'] = True
                        return value['result']

    async def read(self, expression):
        result = await self.command('Runtime.evaluate', {'expression': expression, 'returnByValue': True})
        if result.get('exceptionDetails'):
            raise RuntimeError('UI observation failed')
        return result['result'].get('value')

    async def text(self):
        # Markdown messages render in shadow roots, as documented by the
        # existing get_page_text E2E operation. Inspect those visible messages
        # too; the host element's innerText omits the model's actual answer.
        return await self.read("""(() => {
          const texts = [];
          function collect(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!['STYLE','SCRIPT'].includes(node.parentElement?.tagName)) texts.push(node.textContent);
            }
            root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) collect(e.shadowRoot); });
          }
          collect(document.body);
          return texts.join(' ');
        })()""")

    async def turn_finished(self):
        # The current renderer removes ThoughtDisplay after a completed turn.
        # The actual composer switches its stop button back to Send only when
        # isProcessing/isLoading are both false; no obsolete status text needed.
        return await self.read("[...document.querySelectorAll('button[aria-label]')].some(e => ['Send','发送'].includes(e.getAttribute('aria-label')) && e.getBoundingClientRect().height > 0)")

    async def assistant_messages(self):
        # Select actual assistant text bubbles, excluding the echoed prompt,
        # conversation title, thinking and tool results. Markdown is in shadow
        # roots, so innerText on the outer message would miss the real reply.
        return await self.read("""[...document.querySelectorAll('[data-message-id].text.justify-start')].map(message => {
          const texts = [];
          function collect(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!['STYLE','SCRIPT'].includes(node.parentElement?.tagName)) texts.push(node.textContent);
            }
            root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) collect(e.shadowRoot); });
          }
          collect(message);
          return texts.join(' ').trim();
        })""")

    async def click(self, x, y):
        if not await self.read('document.hasFocus()'):
            await self.command('Page.bringToFront')
        await self.command('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
        for kind in ['mousePressed', 'mouseReleased']:
            await self.command('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        await asyncio.sleep(.15)

    async def click_text(self, *labels):
        async def actionable():
            boxes = await self.read(f"[...document.querySelectorAll('body *')].filter(e=>{json.dumps(labels)}.includes(e.textContent.trim())).filter(e=>{{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !e.closest('button')?.disabled&&hit&&(hit===e||e.contains(hit))}}).map(e=>e.getBoundingClientRect().toJSON()).filter(r=>r.width>0&&r.height>0&&r.y>=0&&r.bottom<innerHeight).sort((a,b)=>a.width*a.height-b.width*b.height)")
            return boxes[0] if boxes else None
        box = await wait_for(actionable, 15, f'Visible control not found: {labels}')
        await self.click(box['x'] + box['width']/2, box['y'] + box['height']/2)

    async def key(self, key, code, number, modifiers=0):
        for kind in ['keyDown', 'keyUp']:
            await self.command('Input.dispatchKeyEvent', {'type': kind, 'key': key, 'code': code, 'windowsVirtualKeyCode': number, 'modifiers': modifiers})

    async def fill(self, selector, text):
        # Inactive conversation panels can retain full-size DOM rectangles.
        # Only the hit-tested, enabled field is actually available to the user.
        async def actionable():
            return await self.read(f"(()=>{{const e=[...document.querySelectorAll({json.dumps(selector)})].find(e=>{{const r=e.getBoundingClientRect();return !e.disabled&&r.height>10&&r.y>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+Math.min(50,r.width/2),r.y+r.height/2)===e}});return e?.getBoundingClientRect().toJSON()}})()")
        box = await wait_for(actionable, 15, f'Input missing: {selector}')
        await self.click(box['x'] + min(50, box['width']/2), box['y'] + box['height']/2)
        assert await self.read(f'document.activeElement?.matches({json.dumps(selector)})'), f'The visible input did not receive focus: {selector}'
        await self.key('a', 'KeyA', 65, 2)
        await self.command('Input.insertText', {'text': text})
        await asyncio.sleep(.2)
        actual = await self.read('document.activeElement?.value')
        assert actual == text, f'The visible input did not accept the user text: {selector}'

    async def wheel(self, delta, x=500, y=400):
        await self.command('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': x, 'y': y, 'deltaX': 0, 'deltaY': delta})
        await asyncio.sleep(.15)

    async def screenshot(self, path):
        shot = await self.command('Page.captureScreenshot', {'format': 'png'})
        path.write_bytes(base64.b64decode(shot['data']))

    async def page_click(self, x, y):
        frame = await self.read("(()=>{const e=document.querySelector('[data-testid=browser-session-panel] img'); if(!e||!e.naturalWidth)return null;return {box:e.getBoundingClientRect().toJSON(),width:e.naturalWidth,height:e.naturalHeight}})()")
        assert frame and frame['width'] > 0, 'The real shared browser frame is missing'
        box = frame['box']
        await self.click(box['x'] + x*box['width']/frame['width'], box['y'] + y*box['height']/frame['height'])


async def wait_for(probe, timeout, description):
    deadline = time.monotonic() + timeout
    while True:
        value = await probe()
        if value:
            return value
        assert time.monotonic() < deadline, description
        await asyncio.sleep(.25)


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--controls-window', action='store_true', help='Take and return control from the compact native window while BrowserPanel is hidden')
    parser.add_argument('--windows-evidence', type=Path, help='Optional isolated Electron bootstrap window metadata')
    parser.add_argument('--existing-profile', action='store_true', help='Explicitly connect an isolated already-running extension Chrome instead of launching a managed browser')
    parser.add_argument('--offline-entry', action='store_true', help='Choose the ordinary local Desktop entry on a fresh login screen')
    parser.add_argument('--model-config', type=Path, help='Private model configuration to save through the ordinary Desktop settings editor after offline entry')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    nonce = uuid4().hex[:10]
    human = f'HUMAN_{nonce} 中文'
    ready = f'READY_{nonce}'
    status = f'SAVED_{nonce}'
    receipts = []
    prefills = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            html = f'''<!doctype html><meta charset="utf-8"><style>body{{font:22px sans-serif;margin:0}}h1{{position:absolute;left:40px;top:10px}}label{{position:absolute;left:40px;top:80px}}input{{position:absolute;left:40px;top:110px;width:300px;height:40px;font:22px sans-serif}}button{{position:absolute;left:40px;top:170px;width:300px;height:40px;font:22px sans-serif}}p{{position:absolute;left:40px;top:230px}}</style><h1>Browser handoff {nonce}</h1><label for="handoff">Handoff value</label><input id="handoff"><button id="submit">Submit once</button><p id="status">Awaiting user</p><script>submit.onclick=event=>fetch('/receipt',{{method:'POST',body:JSON.stringify({{value:handoff.value,trusted:event.isTrusted}})}}).then(()=>{{document.cookie='handoff={nonce}; Path=/';document.querySelector('#status').textContent='{status}'}});</script>'''
            html += """<script>const field=document.querySelector('#handoff');field.addEventListener('input',event=>fetch('/prefill',{method:'POST',body:JSON.stringify({value:field.value,trusted:event.isTrusted})}));</script>"""
            body = html.encode()
            self.send_response(200)
            self.send_header('content-type', 'text/html; charset=utf-8')
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            assert self.path in ('/receipt', '/prefill')
            value = json.loads(self.rfile.read(int(self.headers['content-length'])))
            (receipts if self.path == '/receipt' else prefills).append(value)
            self.send_response(200)
            self.send_header('content-length', '2')
            self.end_headers()
            self.wfile.write(b'{}')

    fixture = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=fixture.serve_forever, daemon=True)
    thread.start()
    evidence = {'nonce': nonce, 'passed': False}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
        async def targets():
            async with session.get(f'http://127.0.0.1:{args.port}/json/list') as response:
                return await response.json()

        async def main_target():
            try:
                return next((t for t in await targets() if t.get('type') == 'page' and '/renderer/index.html' in t.get('url', '') and '#/browser-viewer/' not in t['url']), None)
            except aiohttp.ClientConnectorError:
                return None

        target = await wait_for(main_target, 60, 'The isolated Desktop instance did not expose its renderer')
        app = UI(session, target)
        viewer = None
        try:
            is_offline_entered = False
            offline_box = None
            await app.command('Page.bringToFront')
            async def task_controls_ready():
                nonlocal is_offline_entered, offline_box
                if await app.read("[...document.querySelectorAll('body *')].some(e => ['New task', '\u65b0\u5efa\u4efb\u52a1'].includes(e.textContent.trim()) && e.getBoundingClientRect().height > 0)"):
                    return True
                if args.offline_entry and not is_offline_entered:
                    # Use a normal trusted click only when the startup dialog
                    # no longer covers the actual local-entry link.
                    box = await app.read("""[...document.querySelectorAll('body *')].filter(e=>['离线使用','Use offline','Use Offline','Continue offline'].includes(e.textContent.trim())).map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.height>0&&hit&&(hit===e||e.contains(hit))?r.toJSON():null}).find(Boolean)""")
                    # The login card and startup overlay animate. Click only
                    # after the actual hit-tested control has settled across
                    # observations; a dispatched click is not acknowledgement.
                    is_stable = box and offline_box and all(abs(box[key] - offline_box[key]) < 1 for key in ('x', 'y', 'width', 'height'))
                    offline_box = box
                    if is_stable:
                        await app.click(box['x']+box['width']/2, box['y']+box['height']/2)
                        is_offline_entered = True
                        evidence['normalLocalDesktopEntryChosen'] = True
                return False
            await wait_for(task_controls_ready, 30, 'The Desktop task controls did not finish loading')
            if args.model_config:
                # Offline entry intentionally removes online-account residue.
                # Configure the isolated acceptance account through the real
                # settings editor, without injecting IPC or bypassing send guards.
                config = json.loads(args.model_config.read_text(encoding='utf-8'))
                await app.command('Page.navigate', {'url': target['url'].split('#')[0] + '#/settings/about'})
                async def settings_ready():
                    return await app.read("!!document.querySelector('button .arco-icon-settings')")
                await wait_for(settings_ready, 15, 'The Desktop settings editor did not become available')
                box = await app.read("document.querySelector('button .arco-icon-settings').closest('button').getBoundingClientRect().toJSON()")
                await app.click(box['x'] + box['width']/2, box['y'] + box['height']/2)
                await app.click_text('编辑配置', 'Edit config', 'Edit Config')
                await app.fill('.arco-modal textarea', json.dumps(config))
                await app.click_text('确定', 'OK')
                async def settings_saved():
                    return not await app.read("[...document.querySelectorAll('.arco-modal textarea')].some(e => e.getBoundingClientRect().height > 0)")
                await wait_for(settings_saved, 15, 'The normal model settings save did not finish')
                await app.command('Page.navigate', {'url': target['url'].split('#')[0] + '#/guid'})
                await wait_for(task_controls_ready, 15, 'The task controls did not return after model configuration')
                evidence['normalModelSettingsSaved'] = True
            await app.click_text('新建任务', 'New task')
            await asyncio.sleep(.25)
            prompt = f'Use only sudowork-browser for this browser task. I need to see its Chrome window, so use headful mode. Open http://127.0.0.1:{fixture.server_port}, enter AI_BEFORE_{nonce} in Handoff value, and reply {ready}. Do not submit. Wait for explicit user handoff. After the user returns control, observe again and report the exact field value and page status without typing or submitting.'
            bootstrap = f'Reply exactly SESSION_BOOTSTRAP_{nonce}. Do not use tools. I will connect my existing Chrome through the Browser panel next.'
            await app.fill('textarea', bootstrap if args.existing_profile else prompt)
            await app.key('Enter', 'Enter', 13)
            if args.existing_profile:
                async def bootstrapped():
                    await app.wheel(1000)
                    replies = await app.assistant_messages()
                    return any('SESSION_BOOTSTRAP_' + nonce in reply for reply in replies) and await app.turn_finished()
                await wait_for(bootstrapped, 180, 'The real agent did not finish its initial turn')
                await app.click_text('浏览器', 'Browser')
                await app.click_text('连接我的 Chrome', 'Connect my Chrome')
                async def profile_confirmation():
                    return await app.read("Boolean(document.querySelector('.arco-modal-footer button'))")
                await wait_for(profile_confirmation, 20, 'The host did not request explicit profile selection')
                await app.screenshot(args.output/'personal-profile-selection.png')
                await app.click_text('连接我的 Chrome', 'Connect my Chrome')
                async def connected_personal():
                    text = await app.text()
                    return '已连接你的 Chrome profile' in text or 'Your connected Chrome profile' in text
                await wait_for(connected_personal, 30, 'The real agent barrier and selected personal Chrome were not acknowledged')
                task = prompt.replace('I need to see its Chrome window, so use headful mode.', 'Use the existing Chrome profile the user just connected. Call browser_observe first. Do not use browser_launch or change its profile or launch mode.')
                await app.fill('input[maxlength="2000"]', task)
                await app.click_text('交回 AI', 'Return to AI')
            async def ready_reply():
                await app.wheel(1000)
                has_prefilled = any(value == {'value': f'AI_BEFORE_{nonce}', 'trusted': True} for value in prefills)
                # The actual assistant reply and trusted website event must
                # both exist; the user's prompt cannot satisfy this check.
                return has_prefilled and any(ready in reply for reply in await app.assistant_messages()) and await app.turn_finished()
            await wait_for(ready_reply, 240, 'The real model did not prepare the browser')
            print('Actual model prepared the shared browser', flush=True)
            controls = None
            if args.controls_window:
                await app.click_text('工作空间', 'Workspace')
                await app.click_text('浏览器控制', 'Browser controls')
                async def new_controls():
                    return next((t for t in await targets() if '#/browser-controls/' in t.get('url', '')), None)
                controls = UI(session, await wait_for(new_controls, 20, 'The compact control window did not open'))
            elif not args.existing_profile:
                await app.click_text('浏览器', 'Browser')
            control_ui = controls or app
            async def browser_ready():
                text = await control_ui.text()
                return 'AI 正在控制浏览器' in text or 'AI is controlling' in text
            await wait_for(browser_ready, 20, 'The panel did not connect to the AI browser')
            await control_ui.click_text('接管浏览器', 'Take control')
            async def held():
                text = await control_ui.text()
                return '你已接管' in text or 'Human control' in text
            await wait_for(held, 30, 'Agent tools did not acknowledge takeover')
            print('Agent tools acknowledged human takeover', flush=True)
            if controls:
                assert await controls.read("Boolean(window.electronAPI && document.querySelector('[data-testid=browser-session-controls]') && !document.querySelector('img'))"), 'The compact control window attached a pixel viewer'
                await controls.screenshot(args.output/'human-controls.png')
                if args.windows_evidence:
                    async def compact_metadata():
                        rows = json.loads(args.windows_evidence.read_text(encoding='utf-8'))
                        return next((row for row in rows if row.get('route', '').startswith('/browser-controls/') and row.get('alwaysOnTop') is True), None)
                    native = await wait_for(compact_metadata, 10, 'The native control window is not always on top')
                    assert native['bounds']['width'] <= 500 and native['bounds']['height'] <= 300
            await app.screenshot(args.output/'human-panel.png')
            await control_ui.click_text('在新标签页查看', 'Open viewer tab')
            async def new_viewer():
                return next((t for t in await targets() if '#/browser-viewer/' in t.get('url', '')), None)
            viewer = UI(session, await wait_for(new_viewer, 20, 'The separate viewer did not open'))
            async def viewer_ready():
                return await viewer.read("Boolean(window.electronAPI && document.querySelector('[data-testid=browser-session-panel] img')?.naturalWidth)")
            await wait_for(viewer_ready, 40, 'The viewer preload, bridge or real browser frame is unavailable')
            await viewer.page_click(100, 130)
            await viewer.key('a', 'KeyA', 65, 2)
            await viewer.fill('input[maxlength="512"]', human)
            await viewer.click_text('输入文字', 'Insert text')
            await wait_for(lambda: asyncio.sleep(0, result={'value': human, 'trusted': True} in prefills), 15, 'The shared viewer did not deliver the exact trusted human value')
            await viewer.page_click(100, 190)
            await wait_for(lambda: asyncio.sleep(0, result=len(receipts) > 0), 10, 'The trusted human submit did not reach the page')
            assert receipts == [{'value': human, 'trusted': True}], receipts
            await viewer.screenshot(args.output/'human-viewer.png')
            await (control_ui if controls else viewer).click_text('交回 AI', 'Return to AI')
            async def model_readback():
                # Follow the actual chat as a user, without changing app state.
                await app.wheel(1000)
                return any(human in reply and status in reply for reply in await app.assistant_messages()) and await app.turn_finished()
            await wait_for(model_readback, 180, 'The model did not visibly report the human-edited page')
            assert receipts == [{'value': human, 'trusted': True}], 'An input or submit was replayed'
            await app.screenshot(args.output/'ai-readback.png')
            await app.fill('textarea', '/browser status')
            await app.key('Enter', 'Enter', 13)
            async def slash_status():
                await app.wheel(1000)
                return 'Browser session' in await app.text()
            await wait_for(slash_status,20,'Browser status did not use the shared session')
            await app.fill('textarea', "/browser eval JSON.stringify({value:document.querySelector('#handoff').value,status:document.querySelector('#status').textContent})")
            await app.key('Enter','Enter',13)
            async def slash_eval():
                await app.wheel(1000)
                return 'Browser evaluation' in await app.text()
            await wait_for(slash_eval,20,'Browser evaluation did not reach the shared page')
            await app.screenshot(args.output/'shared-browser-commands.png')
            assert receipts == [{'value': human,'trusted':True}]
            evidence.update(actualModel=True, headful=None if args.existing_profile else True, viewerBridge=True, sharedSession=True, humanValue=human, pageStatus=status, trustedSubmissions=receipts, noReplay=True, modelTurnFinished=True, slashCommands=True)
            if args.existing_profile:
                await viewer.click_text('接管浏览器', 'Take control')
                async def personal_held():
                    text = await viewer.text()
                    return '你已接管' in text or 'Human control' in text
                await wait_for(personal_held, 30, 'The agent did not acknowledge takeover before disconnection')
                await viewer.click_text('断开我的 Chrome', 'Disconnect my Chrome')
                await viewer.click_text('断开我的 Chrome', 'Disconnect my Chrome')
                async def disconnected_personal():
                    return not await viewer.read("document.body.textContent.includes('已连接你的 Chrome profile') || document.body.textContent.includes('Your connected Chrome profile')")
                await wait_for(disconnected_personal, 20, 'The selected personal Chrome did not disconnect')
                evidence.update(existingPersonalProfile=True, explicitProfileSelection=True, personalDisconnected=True)
            evidence['trustedAiPrefill'] = {'value': f'AI_BEFORE_{nonce}', 'trusted': True}
            if controls:
                evidence.update(compactControls=True, browserPanelHiddenDuringHandoff=True, noPixelViewerInControls=True, nativeAlwaysOnTop=bool(args.windows_evidence))
            evidence['passed'] = True
            print(json.dumps({'passed': True, 'evidence': str(args.output/'evidence.json')}), flush=True)
        except BaseException as error:
            evidence['failure'] = type(error).__name__ + ': ' + str(error)
            try:
                evidence['navigation'] = await app.read("({route:location.hash,offlineEntryAcknowledged:localStorage.getItem('sudowork_guest')==='1'})")
            except Exception:
                evidence['navigation'] = 'renderer unavailable'
            raise
        finally:
            evidence['trustedInputEvents'] = prefills
            evidence['lastUiCommands'] = app.trace[-20:]
            if not evidence['passed'] and viewer:
                try:
                    evidence['viewerGeometry'] = await viewer.read("""({viewport:{width:innerWidth,height:innerHeight},panel:document.querySelector('[data-testid=browser-session-panel]')?.getBoundingClientRect().toJSON(),inputs:[...document.querySelectorAll('input')].map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+Math.min(50,r.width/2),r.y+r.height/2);return {label:e.getAttribute('aria-label'),maxLength:e.maxLength,disabled:e.disabled,box:r.toJSON(),hitTag:hit?.tagName,visibility:getComputedStyle(e).visibility}})})""")
                    await viewer.screenshot(args.output/'failure-viewer.png')
                except Exception:
                    evidence['viewerGeometry'] = 'viewer unavailable'
            (args.output/'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
            if not evidence['passed']:
                await app.screenshot(args.output/'failure.png')
            # Keep the isolated app and its owned browser available for review.
            # The operator closes the app through its normal shutdown lifecycle.
            fixture.shutdown()
            fixture.server_close()


if __name__ == '__main__':
    asyncio.run(main())
