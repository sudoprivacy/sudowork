"""Real AI and trusted UI input against a configured, isolated Desktop instance.

Start the built app with its normal model credentials and an isolated home, then:
  python tests/e2e/live_shared_browser.py --port <CDP port> --output <evidence dir>

Requires the pinned ai-dev-browser remote package and an actual model account.
No browser control, agent output, takeover acknowledgement, or model is mocked.
"""

import argparse
import asyncio
import base64
import ctypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
import sys
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

    async def assistant_message_records(self):
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
          return {id: message.getAttribute('data-message-id'), text: texts.join(' ').trim()};
        })""")

    async def assistant_messages(self):
        return [message['text'] for message in await self.assistant_message_records()]

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
        # A background Electron surface can retain a blank compositor frame
        # even after its shadow DOM has rendered. Capture the foreground UI.
        await self.command('Page.bringToFront')
        await self.command('Runtime.evaluate', {'expression': 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', 'awaitPromise': True})
        shot = await self.command('Page.captureScreenshot', {'format': 'png'})
        path.write_bytes(base64.b64decode(shot['data']))

    async def page_click(self, x, y):
        frame = await self.read("(()=>{const e=document.querySelector('[data-testid=browser-session-panel] img'); if(!e||!e.naturalWidth)return null;return {box:e.getBoundingClientRect().toJSON(),width:e.naturalWidth,height:e.naturalHeight}})()")
        assert frame and frame['width'] > 0, 'The real shared browser frame is missing'
        box = frame['box']
        await self.click(box['x'] + x*box['width']/frame['width'], box['y'] + y*box['height']/frame['height'])

    async def page_drag(self, start, end):
        frame = await self.read("(()=>{const e=document.querySelector('[data-testid=browser-session-panel] img');return {box:e.getBoundingClientRect().toJSON(),width:e.naturalWidth,height:e.naturalHeight}})()")
        box = frame['box']
        assert frame['width'] and frame['height']
        await self.command('Page.bringToFront')
        for index in range(9):
            x = box['x'] + (start[0] + (end[0]-start[0])*index/8)*box['width']/frame['width']
            y = box['y'] + (start[1] + (end[1]-start[1])*index/8)*box['height']/frame['height']
            await self.command('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y, 'button': 'left' if index else 'none', 'buttons': 1 if index else 0})
            if index == 0:
                await self.command('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'buttons': 1, 'clickCount': 1})
        await self.command('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'buttons': 0, 'clickCount': 1})

    async def clipboard(self, text=None):
        expression = 'navigator.clipboard.readText()' if text is None else 'navigator.clipboard.writeText(' + json.dumps(text) + ')'
        result = await self.command('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
        assert not result.get('exceptionDetails'), 'The real local clipboard operation failed: ' + str(result.get('exceptionDetails'))
        return result['result'].get('value')


async def wait_for(probe, timeout, description):
    deadline = time.monotonic() + timeout
    while True:
        value = await probe()
        if value:
            return value
        assert time.monotonic() < deadline, description
        await asyncio.sleep(.25)


def foreground_chrome_window(title):
    """Observe the real Windows foreground window without activating it."""
    if sys.platform != 'win32':
        return {'verified': False, 'platform': sys.platform}
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetForegroundWindow.restype = ctypes.c_void_p
    user32.GetWindowTextW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int)
    user32.GetClassNameW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int)
    handle = user32.GetForegroundWindow()
    actual_title = ctypes.create_unicode_buffer(512)
    window_class = ctypes.create_unicode_buffer(128)
    user32.GetWindowTextW(handle, actual_title, len(actual_title))
    user32.GetClassNameW(handle, window_class, len(window_class))
    if title in actual_title.value and window_class.value.startswith('Chrome_WidgetWin_'):
        return {'verified': True, 'title': actual_title.value, 'class': window_class.value}
    return None


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--controls-window', action='store_true', help='Open the bound viewer from the compact status window while BrowserPanel is hidden')
    parser.add_argument('--windows-evidence', type=Path, help='Optional isolated Electron bootstrap window metadata')
    parser.add_argument('--existing-profile', action='store_true', help='Explicitly connect an isolated already-running extension Chrome instead of launching a managed browser')
    parser.add_argument('--offline-entry', action='store_true', help='Choose the ordinary local Desktop entry on a fresh login screen')
    parser.add_argument('--model-config', type=Path, help='Private model configuration to save through the ordinary Desktop settings editor after offline entry')
    parser.add_argument('--pending-native-question', action='store_true', help='Take control while the real model is waiting on its native question card, then verify the cancelled card no longer captures chat input')
    parser.add_argument('--status-repetitions', type=int, choices=range(1, 21), default=3, help='Require distinct completed responses to consecutive local browser status commands after the real model turn')
    parser.add_argument('--verify-selection-clipboard', action='store_true', help='Use real viewer drag selection, local clipboard, multiline paste and Chromium IME composition; restore an unchanged owned clipboard value afterwards')
    parser.add_argument('--first-use-runtime', type=Path, help='Owned app runtime interpreter to observe during a genuine first-use install; does not preinstall or modify it')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    nonce = uuid4().hex[:10]
    human = f'HUMAN_{nonce} 中文'
    ready = f'READY_{nonce}'
    status = f'SAVED_{nonce}'
    receipts = []
    prefills = []
    selected_phrase = 'Exact browser review phrase'
    selection_layouts = []
    clipboard_inputs = []
    clipboard_receipts = []
    pointer_receipts = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            html = f'''<!doctype html><meta charset="utf-8"><title>Browser handoff {nonce}</title><style>body{{font:22px sans-serif;margin:0}}h1{{position:absolute;left:40px;top:10px}}label{{position:absolute;left:40px;top:80px}}input{{position:absolute;left:40px;top:110px;width:300px;height:40px;font:22px sans-serif}}button{{position:absolute;left:40px;top:170px;width:300px;height:40px;font:22px sans-serif}}p{{position:absolute;left:40px;top:230px}}</style><h1>Browser handoff {nonce}</h1><label for="handoff">Handoff value</label><input id="handoff"><button id="submit">Submit once</button><p id="status">Awaiting user</p><script>submit.onclick=event=>fetch('/receipt',{{method:'POST',body:JSON.stringify({{value:handoff.value,trusted:event.isTrusted}})}}).then(()=>{{document.cookie='handoff={nonce}; Path=/';document.querySelector('#status').textContent='{status}'}});</script>'''
            html += """<script>const field=document.querySelector('#handoff');field.addEventListener('input',event=>fetch('/prefill',{method:'POST',body:JSON.stringify({value:field.value,trusted:event.isTrusted})}));</script>"""
            if args.verify_selection_clipboard:
                html += '<span id="review-phrase" style="position:absolute;left:40px;top:290px;font:20px monospace;white-space:pre">' + selected_phrase + '</span>'
                html += '''<textarea id="clipboard-field" style="position:absolute;left:40px;top:350px;width:500px;height:70px;font:20px monospace"></textarea>
<button id="clipboard-submit" style="top:460px">Submit multiline once</button><script>
const phrase=document.querySelector('#review-phrase'), area=document.querySelector('#clipboard-field');
requestAnimationFrame(()=>{const box=phrase.getBoundingClientRect();fetch('/selection-layout',{method:'POST',body:JSON.stringify({x:box.x,y:box.y,width:box.width,height:box.height})})});
area.addEventListener('input',event=>fetch('/clipboard-input',{method:'POST',body:JSON.stringify({value:area.value,trusted:event.isTrusted})}));
document.addEventListener('pointerup',event=>fetch('/pointer-receipt',{method:'POST',body:JSON.stringify({x:event.clientX,y:event.clientY,target:event.target.id,active:document.activeElement.id,trusted:event.isTrusted,selected:String(getSelection())})}));
document.querySelector('#clipboard-submit').onclick=event=>fetch('/clipboard-submit',{method:'POST',body:JSON.stringify({value:area.value,trusted:event.isTrusted})});
</script>'''
            body = html.encode()
            self.send_response(200)
            self.send_header('content-type', 'text/html; charset=utf-8')
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            assert self.path in ('/receipt', '/prefill', '/selection-layout', '/clipboard-input', '/clipboard-submit', '/pointer-receipt')
            value = json.loads(self.rfile.read(int(self.headers['content-length'])))
            {'/receipt': receipts, '/prefill': prefills, '/selection-layout': selection_layouts, '/clipboard-input': clipboard_inputs, '/clipboard-submit': clipboard_receipts, '/pointer-receipt': pointer_receipts}[self.path].append(value)
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
            prompt = f'Use only sudowork-browser for this browser task. I need to see its Chrome window, so use headful mode. Open http://127.0.0.1:{fixture.server_port}, enter AI_BEFORE_{nonce} in Handoff value, and reply {ready}. Do not submit. Wait for my next message. When I tell you I finished editing, freshly observe and report the exact field value and page status without typing or submitting.'
            prompt += ' Execute tools directly without progress narration. Keep final replies brief and in English.'
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
                await app.click_text('浏览器来源', 'Browser source')
                await app.click_text('使用我的 Chrome', 'Use my Chrome')
                if args.first_use_runtime:
                    runtime = args.first_use_runtime.resolve()
                    runtime_root = runtime.parent.parent
                    expected_version = runtime_root.name
                    started = time.monotonic()
                    async def runtime_ready():
                        if not runtime.is_file():
                            return False
                        records = [runtime_root / 'Lib' / 'site-packages' / f'ai_dev_browser-{expected_version}.dist-info' / 'RECORD']
                        records.extend(runtime_root.glob(f'lib/python*/site-packages/ai_dev_browser-{expected_version}.dist-info/RECORD'))
                        if not any(record.is_file() for record in records):
                            return False
                        check = await asyncio.create_subprocess_exec(
                            str(runtime), '-I', '-c',
                            "from importlib.metadata import version; assert version('ai-dev-browser')==" + repr(expected_version) + "; import ai_dev_browser.remote.worker",
                            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                        )
                        _, error = await check.communicate()
                        assert check.returncode == 0, error.decode(errors='replace')
                        return True
                    # The normal app installer has a 300 s pip budget. Observe
                    # that separate first-use phase; keep the existing profile
                    # consent deadline below unchanged once the runtime is ready.
                    await wait_for(runtime_ready, 300, 'The normal first-use browser runtime did not become ready')
                    evidence['normalFirstUseRuntimeReady'] = True
                    evidence['firstUseRuntimeReadyMs'] = round((time.monotonic() - started) * 1000, 2)
                async def profile_confirmation():
                    return await app.read("Boolean(document.querySelector('.arco-modal-footer button'))")
                await wait_for(profile_confirmation, 20, 'The host did not request explicit profile selection')
                await app.screenshot(args.output/'personal-profile-selection.png')
                await app.click_text('使用我的 Chrome', 'Use my Chrome')
                async def connected_personal():
                    text = await app.text()
                    return '已连接你的 Chrome profile' in text or 'Your connected Chrome profile' in text
                await wait_for(connected_personal, 30, 'The real agent barrier and selected personal Chrome were not acknowledged')
                await app.click_text('浏览器来源', 'Browser source')
                task = prompt.replace('I need to see its Chrome window, so use headful mode.', 'Use the existing Chrome profile the user just connected. Call browser_observe first. Do not use browser_launch or change its profile or launch mode.')
                await app.fill('textarea', task)
                await app.key('Enter', 'Enter', 13)
            async def ready_reply():
                await app.wheel(1000)
                has_prefilled = any(value == {'value': f'AI_BEFORE_{nonce}', 'trusted': True} for value in prefills)
                # The actual assistant reply and trusted website event must
                # both exist; the user's prompt cannot satisfy this check.
                return has_prefilled and any(ready in reply for reply in await app.assistant_messages()) and await app.turn_finished()
            await wait_for(ready_reply, 240, 'The real model did not prepare the browser')
            print('Actual model prepared the shared browser', flush=True)
            if args.pending_native_question:
                question = f'NATIVE_HANDOFF_{nonce}'
                await app.fill('textarea', f'Use your native AskUserQuestion tool now. Ask exactly "{question}: Can you handle this browser step?" with choices "I will handle it" and "Keep working". Wait for my answer. Do not use browser tools or answer the question yourself.')
                await app.key('Enter', 'Enter', 13)
                async def native_question_pending():
                    return await app.read("Boolean(document.querySelector('textarea[placeholder=\"输入回答\"],textarea[placeholder=\"Enter answer\"]'))") and question in await app.text()
                await wait_for(native_question_pending, 180, 'The actual model did not open its native question card')
                evidence['actualNativeQuestionPendingBeforeTakeover'] = True
                await app.screenshot(args.output/'pending-native-question.png')
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
                return 'SudoWork 正在操作' in text or 'SudoWork is operating' in text
            await wait_for(browser_ready, 20, 'The panel did not connect to the AI browser')
            bound_route = await app.read('location.hash')
            native_window = await control_ui.read("[...document.querySelectorAll('button')].some(e=>['打开浏览器窗口','Show browser window'].includes(e.textContent.trim())&&!e.disabled)")
            if native_window:
                previous_viewers = {t['id'] for t in await targets() if '#/browser-viewer/' in t.get('url', '')}
                await control_ui.click_text('打开浏览器窗口', 'Show browser window')
                async def native_foreground():
                    return foreground_chrome_window(f'Browser handoff {nonce}')
                native_proof = await wait_for(native_foreground, 10, 'The task Chrome window did not become foreground')
                assert {t['id'] for t in await targets() if '#/browser-viewer/' in t.get('url', '')} == previous_viewers, 'Showing native Chrome opened an unexpected Electron viewer'
                evidence.update(browserPresentation='native-window-and-embedded-panel', nativeWindowRequested=True, nativeWindowOpened=native_proof.get('verified') is True,
                                nativeWindowForeground=native_proof, separateViewerOpened=False)
                # Observe and input through the same shared panel after proving
                # the normal Desktop action reveals the actual task Chrome.
                if controls:
                    await app.click_text('浏览器', 'Browser')
                viewer = app
            else:
                await control_ui.click_text('独立查看', 'Open separately')
                async def new_viewer():
                    return next((t for t in await targets() if '#/browser-viewer/' in t.get('url', '')), None)
                viewer = UI(session, await wait_for(new_viewer, 20, 'The separate viewer did not open'))
                evidence.update(browserPresentation='separate-viewer', separateViewerOpened=True)
            async def viewer_ready():
                # An image may arrive before the new window's stylesheets.
                # Wait for its actual layout before mapping trusted coordinates.
                return await viewer.read("Boolean(window.electronAPI && document.readyState === 'complete' && document.querySelector('[data-testid=browser-session-panel] img')?.naturalWidth && getComputedStyle(document.querySelector('[data-testid=browser-session-panel]')).display === 'flex')")
            await wait_for(viewer_ready, 40, 'The viewer preload, bridge or real browser frame is unavailable')
            evidence['viewerPresentation'] = await viewer.read("""({font:getComputedStyle(document.body).fontFamily,panelDisplay:getComputedStyle(document.querySelector('[data-testid=browser-session-panel]')).display,styleSheets:[...document.styleSheets].map(s=>({href:s.href,rules:(()=>{try{return s.cssRules.length}catch{return null}})()}))})""")
            assert not await viewer.read("[...document.querySelectorAll('button')].some(e=>['Take control','Return to AI','接管浏览器','交回 AI'].includes(e.textContent.trim()))"), 'Browser handoff buttons must not be required'
            await viewer.page_click(100, 130)
            async def held():
                text = await control_ui.text()
                return '你可以操作' in text or 'You can operate' in text
            await wait_for(held, 30, 'Agent tools did not acknowledge takeover')
            print('Agent tools acknowledged human takeover', flush=True)
            if args.pending_native_question:
                async def native_question_cancelled():
                    text = await app.text()
                    return ('已取消该问题' in text or 'Question cancelled' in text) and not await app.read("Boolean(document.querySelector('textarea[placeholder=\"输入回答\"],textarea[placeholder=\"Enter answer\"]'))")
                await wait_for(native_question_cancelled, 10, 'The acknowledged takeover left a stale native question capturing chat input')
                previous_document = await app.read('performance.timeOrigin')
                await app.command('Page.reload')
                async def cancellation_reloaded():
                    try:
                        return await app.read('performance.timeOrigin') != previous_document and await native_question_cancelled()
                    except RuntimeError as error:
                        if 'context' in str(error).lower() and ('destroyed' in str(error).lower() or 'cannot find' in str(error).lower()):
                            return False
                        raise
                await wait_for(cancellation_reloaded, 20, 'The cancelled native question returned after reloading its persisted conversation')
                await wait_for(held, 20, 'Human ownership did not survive the conversation reload')
                evidence['nativeQuestionCancelledAfterTakeover'] = True
                evidence['nativeQuestionCancellationPersisted'] = True
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
            await wait_for(viewer_ready, 40, 'The viewer preload, bridge or real browser frame is unavailable')
            if args.verify_selection_clipboard:
                await viewer.command('Page.bringToFront')
                saved_clipboard = await viewer.clipboard()
                pasted = 'Clipboard 中文\nSecond line ✓ ' + nonce
                composed = '中文输入\nComposed line ✓ ' + nonce
                try:
                    await wait_for(lambda: asyncio.sleep(0, result=selection_layouts), 10, 'The real page did not report its text layout')
                    layout = selection_layouts[-1]
                    y = layout['y'] + layout['height']/2
                    # Start/end inside the actual glyph range. Chrome does not
                    # initiate text selection at the exact outer pixel boundary.
                    await viewer.page_drag((layout['x']+0.5, y), (layout['x']+layout['width']-0.5, y))
                    await viewer.click_text('复制选区', 'Copy selected text')
                    async def copied():
                        return await viewer.clipboard() == selected_phrase
                    await wait_for(copied, 15, 'The viewer did not copy the exact dragged phrase to the local clipboard')
                    evidence['exactPhraseCopiedFromRemoteSelection'] = True
                    await viewer.clipboard(pasted)
                    await viewer.page_click(120, 380)
                    await viewer.click_text('粘贴到页面', 'Paste into page')
                    evidence['pasteUiText'] = (await viewer.text())[-800:]
                    await wait_for(lambda: asyncio.sleep(0, result={'value': pasted, 'trusted': True} in clipboard_inputs), 15, 'The real page did not receive trusted multiline clipboard text')
                    await viewer.page_click(120, 380)
                    await viewer.key('a', 'KeyA', 65, 2)
                    editor = 'textarea[maxlength="8192"]'
                    await viewer.fill(editor, '')
                    await viewer.command('Input.imeSetComposition', {'text': '中文输入', 'selectionStart': 4, 'selectionEnd': 4})
                    await viewer.key('Enter', 'Enter', 229, 2)
                    await viewer.command('Input.insertText', {'text': '中文输入'})
                    await viewer.command('Input.insertText', {'text': '\nComposed line ✓ ' + nonce})
                    assert await viewer.read('document.activeElement.value') == composed
                    assert clipboard_inputs[-1] == {'value': pasted, 'trusted': True}, 'IME confirmation wrote to the remote page before the user submitted'
                    await viewer.key('Enter', 'Enter', 13, 2)
                    await wait_for(lambda: asyncio.sleep(0, result={'value': composed, 'trusted': True} in clipboard_inputs), 15, 'The completed IME text did not reach the same remote page')
                    await viewer.page_click(160, 480)
                    await wait_for(lambda: asyncio.sleep(0, result=clipboard_receipts), 10, 'The real multiline submission did not arrive')
                    assert clipboard_receipts == [{'value': composed, 'trusted': True}], clipboard_receipts
                    evidence.update(exactPhraseCopiedFromRemoteSelection=True, realMultilineClipboardPaste=True, chromiumImeComposition=True, imeConfirmationDidNotSubmit=True, trustedMultilineSubmissionOnce=True)
                    await viewer.screenshot(args.output/'selection-clipboard-ime.png')
                finally:
                    current_clipboard = await viewer.clipboard()
                    if current_clipboard.replace('\r\n', '\n') in (selected_phrase, pasted):
                        await viewer.clipboard(saved_clipboard)
                        evidence['ownedClipboardRestored'] = True
                    elif current_clipboard == saved_clipboard:
                        evidence['ownedClipboardUnchanged'] = True
                    else:
                        evidence['newerUserClipboardPreserved'] = True
            await viewer.page_click(100, 130)
            await viewer.key('a', 'KeyA', 65, 2)
            await viewer.fill('input[maxlength="512"],textarea[maxlength="8192"]', human)
            await viewer.click_text('输入文字', 'Insert text')
            await wait_for(lambda: asyncio.sleep(0, result={'value': human, 'trusted': True} in prefills), 15, 'The shared viewer did not deliver the exact trusted human value')
            await viewer.page_click(100, 190)
            await wait_for(lambda: asyncio.sleep(0, result=len(receipts) > 0), 10, 'The trusted human submit did not reach the page')
            assert receipts == [{'value': human, 'trusted': True}], receipts
            await viewer.screenshot(args.output/'human-viewer.png')
            await app.fill('textarea', 'I finished editing and submitting in the shared browser. Freshly observe it and report the exact current field value and page status. Do not type or submit again.')
            await app.key('Enter', 'Enter', 13)
            async def model_readback():
                # Follow the actual chat as a user, without changing app state.
                await app.wheel(1000)
                return any(human in reply and status in reply for reply in await app.assistant_messages()) and await app.turn_finished()
            await wait_for(model_readback, 180, 'The model did not visibly report the human-edited page')
            assert receipts == [{'value': human, 'trusted': True}], 'An input or submit was replayed'
            await app.screenshot(args.output/'ai-readback.png')
            async def status_response_ids():
                # Status Markdown is inside open shadow roots, just like the
                # model's answer. Keep its real message identity as well.
                return {message['id'] for message in await app.assistant_message_records() if 'Browser session' in message['text']}
            status_commands = []
            evidence['consecutiveStatusCommands'] = status_commands
            for _ in range(args.status_repetitions):
                previous_ids = await status_response_ids()
                started = time.monotonic()
                await app.fill('textarea', '/browser status')
                await app.key('Enter', 'Enter', 13)
                async def slash_status():
                    await app.wheel(1000)
                    return bool(await status_response_ids() - previous_ids) and await app.turn_finished()
                await wait_for(slash_status,20,'Browser status did not produce a new completed response from the shared session')
                status_commands.append({'responseMs': round((time.monotonic()-started)*1000, 2), 'distinctCompletedResponse': True})
            await app.fill('textarea', "/browser eval JSON.stringify({value:document.querySelector('#handoff').value,status:document.querySelector('#status').textContent})")
            await app.key('Enter','Enter',13)
            async def slash_eval():
                await app.wheel(1000)
                return 'Browser evaluation' in await app.text()
            await wait_for(slash_eval,20,'Browser evaluation did not reach the shared page')
            await app.screenshot(args.output/'shared-browser-commands.png')
            assert receipts == [{'value': human,'trusted':True}]
            evidence.update(actualModel=True, headful=None if args.existing_profile else True, viewerBridge=True, sharedSession=True, humanValue=human, pageStatus=status, trustedSubmissions=receipts, noReplay=True, modelTurnFinished=True, slashCommands=True, conversationInterruptAndContinue=True, noBrowserHandoffButtons=True)
            if args.existing_profile:
                await viewer.page_click(100, 130)
                async def personal_held():
                    text = await viewer.text()
                    return '你可以操作' in text or 'You can operate' in text
                await wait_for(personal_held, 30, 'The agent did not acknowledge takeover before disconnection')
                await viewer.click_text('浏览器来源', 'Browser source')
                await viewer.click_text('断开我的 Chrome', 'Disconnect my Chrome')
                await viewer.click_text('断开我的 Chrome', 'Disconnect my Chrome')
                async def disconnected_personal():
                    return not await viewer.read("document.body.textContent.includes('已连接你的 Chrome profile') || document.body.textContent.includes('Your connected Chrome profile')")
                await wait_for(disconnected_personal, 20, 'The selected personal Chrome did not disconnect')
                evidence.update(existingPersonalProfile=True, explicitProfileSelection=True, personalDisconnected=True)
            if native_window:
                assert await app.read('location.hash') == bound_route and nonce in await app.text(), 'The native window/panel journey changed its bound conversation'
                evidence['sameConversationRetainedInPanel'] = True
            else:
                await viewer.click_text('打开会话', 'Open conversation')
                async def bound_conversation_opened():
                    return await viewer.read('location.hash') == await app.read('location.hash') and nonce in await viewer.text()
                await wait_for(bound_conversation_opened, 20, 'The viewer did not open its exact bound conversation')
                evidence['sameConversationOpenedFromViewer'] = True
            evidence['trustedAiPrefill'] = {'value': f'AI_BEFORE_{nonce}', 'trusted': True}
            if controls:
                evidence.update(compactControls=True, browserPanelHiddenDuringHandoff=not native_window, noPixelViewerInControls=True, nativeAlwaysOnTop=bool(args.windows_evidence))
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
            if args.verify_selection_clipboard:
                evidence.update(clipboardInputEvents=clipboard_inputs, clipboardSubmitEvents=clipboard_receipts, pointerEvents=pointer_receipts)
            evidence['lastUiCommands'] = app.trace[-20:]
            if not evidence['passed'] and viewer:
                try:
                    evidence['viewerGeometry'] = await viewer.read("""({viewport:{width:innerWidth,height:innerHeight},panel:document.querySelector('[data-testid=browser-session-panel]')?.getBoundingClientRect().toJSON(),inputs:[...document.querySelectorAll('input')].map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+Math.min(50,r.width/2),r.y+r.height/2);return {label:e.getAttribute('aria-label'),maxLength:e.maxLength,disabled:e.disabled,box:r.toJSON(),hitTag:hit?.tagName,visibility:getComputedStyle(e).visibility}})})""")
                    await viewer.screenshot(args.output/'failure-viewer.png')
                except Exception:
                    evidence['viewerGeometry'] = 'viewer unavailable'
            (args.output/'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
            if not evidence['passed']:
                try:
                    await app.screenshot(args.output/'failure.png')
                except Exception as screenshot_error:
                    # Keep the original journey failure when a stalled
                    # renderer cannot produce a diagnostic screenshot.
                    evidence['failureScreenshotError'] = type(screenshot_error).__name__ + ': ' + str(screenshot_error)
                    (args.output/'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
            # Keep the isolated app and its owned browser available for review.
            # The operator closes the app through its normal shutdown lifecycle.
            fixture.shutdown()
            fixture.server_close()


if __name__ == '__main__':
    asyncio.run(main())
