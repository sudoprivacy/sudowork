"""Real AI and trusted UI input against a configured, isolated Desktop instance.

Start the built app with its normal model credentials and an isolated home, then:
  python tests/e2e/live_shared_browser.py --port <CDP port> --output <evidence dir>

Requires ai-dev-browser[remote]==0.57.3 (aiohttp) and an actual model account.
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

    async def command(self, method, params=None):
        # A short-lived connection avoids consuming another viewer's events.
        async with self.session.ws_connect(self.target['webSocketDebuggerUrl']) as ws:
            self.sequence += 1
            await ws.send_json({'id': self.sequence, 'method': method, 'params': params or {}})
            async for message in ws:
                value = json.loads(message.data)
                if value.get('id') == self.sequence:
                    if 'error' in value:
                        raise RuntimeError(value['error'])
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

    async def click(self, x, y):
        if not await self.read('document.hasFocus()'):
            await self.command('Page.bringToFront')
        await self.command('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
        for kind in ['mousePressed', 'mouseReleased']:
            await self.command('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        await asyncio.sleep(.15)

    async def click_text(self, *labels):
        for label in labels:
            boxes = await self.read(f"[...document.querySelectorAll('body *')].filter(e=>e.textContent.trim()==={json.dumps(label)}).map(e=>e.getBoundingClientRect().toJSON()).filter(r=>r.width>0&&r.height>0&&r.y>=0&&r.bottom<innerHeight).sort((a,b)=>a.width*a.height-b.width*b.height)")
            if boxes:
                box = boxes[0]
                await self.click(box['x'] + box['width']/2, box['y'] + box['height']/2)
                return
        raise AssertionError(f'Visible control not found: {labels}')

    async def key(self, key, code, number, modifiers=0):
        for kind in ['keyDown', 'keyUp']:
            await self.command('Input.dispatchKeyEvent', {'type': kind, 'key': key, 'code': code, 'windowsVirtualKeyCode': number, 'modifiers': modifiers})

    async def fill(self, selector, text):
        box = await self.read(f"(()=>{{const e=[...document.querySelectorAll({json.dumps(selector)})].find(e=>e.getBoundingClientRect().height>10);return e?.getBoundingClientRect().toJSON()}})()")
        assert box and box['height'] > 0, f'Input missing: {selector}'
        await self.click(box['x'] + min(50, box['width']/2), box['y'] + box['height']/2)
        await self.key('a', 'KeyA', 65, 2)
        await self.command('Input.insertText', {'text': text})
        await asyncio.sleep(.2)

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
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    nonce = uuid4().hex[:10]
    human = f'HUMAN_{nonce} 中文'
    ready = f'READY_{nonce}'
    status = f'SAVED_{nonce}'
    receipts = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            html = f'''<!doctype html><meta charset="utf-8"><style>body{{font:22px sans-serif;margin:0}}h1{{position:absolute;left:40px;top:10px}}label{{position:absolute;left:40px;top:80px}}input{{position:absolute;left:40px;top:110px;width:300px;height:40px;font:22px sans-serif}}button{{position:absolute;left:40px;top:170px;width:300px;height:40px;font:22px sans-serif}}p{{position:absolute;left:40px;top:230px}}</style><h1>Browser handoff {nonce}</h1><label for="handoff">Handoff value</label><input id="handoff"><button id="submit">Submit once</button><p id="status">Awaiting user</p><script>submit.onclick=event=>fetch('/receipt',{{method:'POST',body:JSON.stringify({{value:handoff.value,trusted:event.isTrusted}})}}).then(()=>{{document.cookie='handoff={nonce}; Path=/';document.querySelector('#status').textContent='{status}'}});</script>'''
            body = html.encode()
            self.send_response(200)
            self.send_header('content-type', 'text/html; charset=utf-8')
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            assert self.path == '/receipt'
            receipts.append(json.loads(self.rfile.read(int(self.headers['content-length']))))
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

        target = next(t for t in await targets() if t.get('type') == 'page' and '/renderer/index.html' in t.get('url', '') and '#/browser-viewer/' not in t['url'])
        app = UI(session, target)
        viewer = None
        try:
            await app.click_text('新建任务', 'New task')
            await asyncio.sleep(.25)
            prompt = f'Use only sudowork-browser for this browser task. I need to see its Chrome window, so use headful mode. Open http://127.0.0.1:{fixture.server_port}, enter AI_BEFORE_{nonce} in Handoff value, and reply {ready}. Do not submit. Wait for explicit user handoff. After the user returns control, observe again and report the exact field value and page status without typing or submitting.'
            await app.fill('textarea', prompt)
            await app.key('Enter', 'Enter', 13)
            async def ready_reply():
                await app.wheel(1000)
                text = await app.text()
                return ready in text and ('执行完成' in text or 'Completed' in text) and '正在处理中' not in text
            await wait_for(ready_reply, 240, 'The real model did not prepare the browser')
            print('Actual model prepared the shared browser', flush=True)
            await app.click_text('浏览器', 'Browser')
            async def browser_ready():
                text = await app.text()
                return 'AI 正在控制浏览器' in text or 'AI is controlling' in text
            await wait_for(browser_ready, 20, 'The panel did not connect to the AI browser')
            await app.click_text('接管浏览器', 'Take control')
            async def held():
                text = await app.text()
                return '你已接管' in text or 'Human control' in text
            await wait_for(held, 30, 'Agent tools did not acknowledge takeover')
            print('Agent tools acknowledged human takeover', flush=True)
            await app.screenshot(args.output/'human-panel.png')
            await app.click_text('在新标签页查看', 'Open viewer tab')
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
            await viewer.page_click(100, 190)
            await wait_for(lambda: asyncio.sleep(0, result=len(receipts) > 0), 10, 'The trusted human submit did not reach the page')
            assert receipts == [{'value': human, 'trusted': True}], receipts
            await viewer.screenshot(args.output/'human-viewer.png')
            await viewer.click_text('交回 AI', 'Return to AI')
            async def model_readback():
                # Follow the actual chat as a user, without changing app state.
                await app.wheel(1000)
                text = await app.text()
                return human in text and status in text and '正在处理中' not in text and 'Processing' not in text
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
            evidence.update(passed=True, actualModel=True, headful=True, viewerBridge=True, sharedSession=True, humanValue=human, pageStatus=status, trustedSubmissions=receipts, noReplay=True, modelTurnFinished=True, slashCommands=True)
            print(json.dumps({'passed': True, 'evidence': str(args.output/'evidence.json')}), flush=True)
        finally:
            (args.output/'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
            if not evidence['passed']:
                await app.screenshot(args.output/'failure.png')
            # Keep the isolated app and its owned browser available for review.
            # The operator closes the app through its normal shutdown lifecycle.
            fixture.shutdown()
            fixture.server_close()


if __name__ == '__main__':
    asyncio.run(main())
