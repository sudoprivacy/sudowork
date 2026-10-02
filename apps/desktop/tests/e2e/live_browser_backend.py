"""Paid, real-model browser acceptance through a running isolated Sudowork UI.

The app must use the requested backend, with a real provider configured.
The harness uses the pinned sudohand binary for fixture and UI inspection.
Missing credentials,
tools, image understanding or UI completion fail this test; nothing is skipped.
Use a disposable app profile. The database argument is read-only.
"""

import argparse
import asyncio
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFont
from ai_dev_browser.core import js_evaluate, page_discover, page_screenshot, type_by_ref
from ops.connect import connect
from ops.press_key import press_key


async def main(args):
    sys.stdout.reconfigure(encoding="utf-8")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    database = args.database.resolve()
    assert (
        database != Path.home() / ".nexus/sudowork.db"
    ), "Use a disposable application profile"
    assert database.is_file(), "The isolated app must already be running"
    wrapper = (
        Path(__file__).resolve().parents[2] / "resources/sudoclaw-bin/browser_helper.py"
    )
    env = dict(
        os.environ,
        SUDOWORK_BROWSER_BACKEND="sudohand",
        SUDOWORK_SUDOHAND_PATH=str(args.suh.resolve()),
        AI_DEV_BROWSER_OUTPUT_DIR=str(output),
        AI_DEV_BROWSER_TRANSPORT="cdp",
        AI_DEV_BROWSER_OS_CLICK="false",
    )
    for key in (
        "AI_DEV_BROWSER_PORT",
        "AI_DEV_BROWSER_TAB_URL",
        "AI_DEV_BROWSER_REDIRECT",
    ):
        env.pop(key, None)

    def command(*argv):
        result = subprocess.run(
            [sys.executable, str(wrapper), *argv],
            env=env,
            cwd=output,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=70,
        )
        assert result.returncode == 0, result.stderr or result.stdout
        return json.loads(result.stdout)

    badge = "".join(
        secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6)
    )
    picture = Image.new("RGB", (540, 110), "#f3dc8f")
    draw = ImageDraw.Draw(picture)
    draw.text(
        (30, 16),
        badge,
        font=ImageFont.truetype(
            "DejaVuSans.ttf" if os.name != "nt" else "arial.ttf", 64
        ),
        fill="#142e47",
    )
    png = io.BytesIO()
    picture.save(png, format="PNG")
    receipts = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == "/badge.png":
                data, content_type = png.getvalue(), "image/png"
            elif self.path == "/state":
                data, content_type = (
                    json.dumps(receipts, ensure_ascii=False).encode(),
                    "application/json",
                )
            else:
                data = """<!doctype html><meta charset="utf-8"><title>Migration review</title>
                <style>body{font:24px sans-serif;margin:60px;background:#eef5ff}input,button{font:inherit;padding:12px}</style>
                <h1>Reserve a review</h1><form><label>Attendee <input aria-label="Attendee" required></label>
                <button id="reserve-now">Reserve one seat</button></form><p id="receipt"></p>
                <h2>Visual badge</h2><img src="/badge.png" alt="Visual badge; read it from the screenshot">
                <script>async function refresh(){let r=await(await fetch('/state')).json();document.querySelector('#receipt').textContent=r.length?'Reserved '+r[0].name+' / '+r[0].id:'No reservation yet'}
                document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();await fetch('/reserve',{method:'POST',body:JSON.stringify({name:document.querySelector('input').value,trusted:e.isTrusted})});await refresh()};refresh()</script>""".encode()
                content_type = "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            assert self.path == "/reserve"
            item = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            item["id"] = secrets.token_hex(5)
            receipts.append(item)
            self.send_response(201)
            self.end_headers()
            self.wfile.write(json.dumps(item).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = None
    browser = None
    report = {
        "status": "failed",
        "backend": args.backend,
        "model_transport": "Sudowork UI → scode ACP → real provider",
        "receipts": receipts,
    }
    try:
        launched = await asyncio.to_thread(
            command, "browser_start", "--headless", "new", "--temp"
        )
        port = str(launched["port"])
        assert int(port) != args.app_port and not launched.get("reused"), launched
        nonce = secrets.token_hex(5)
        task = (
            f"Browser acceptance {nonce}. Use the browser skill to open http://127.0.0.1:{server.server_port}/ "
            f"in the already running browser on CDP port {port}. Reserve exactly one seat for 林晓. "
            "Verify the resulting receipt. Take a screenshot, open the image with your image tool, "
            "and report the six-character visual badge from the image. Include the screenshot in your reply. "
            "The badge is only in image pixels. Do not use OCR or read fixture source/files. "
            "Finish with BOOKED:<receipt id> and BADGE:<six characters>."
        )
        browser, tab = await connect(port=args.app_port)
        fields = await page_discover(tab)
        field = next(
            item
            for item in fields
            if item.get("role") == "textbox" and "Sudo Code" in item.get("name", "")
        )
        typed = await type_by_ref(tab, field["ref"], task, clear=True)
        assert not (isinstance(typed, dict) and typed.get("error")), typed
        assert (
            nonce
            in (await js_evaluate(tab, 'document.querySelector("textarea").value'))[
                "result"
            ]
        )
        print("Typed the task through the real application input", flush=True)
        await press_key(tab, "Enter")
        deadline = time.monotonic() + args.timeout
        conversation = None
        final = ""
        while time.monotonic() < deadline:
            with sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True) as db:
                if not conversation:
                    row = db.execute(
                        "SELECT conversation_id FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT 1",
                        (f"%{nonce}%",),
                    ).fetchone()
                    if row:
                        conversation = row[0]
                        print("Application conversation:", conversation, flush=True)
                if conversation:
                    rows = db.execute(
                        "SELECT content FROM messages WHERE conversation_id=? AND type='text' ORDER BY created_at",
                        (conversation,),
                    ).fetchall()
                    final = "\n".join(r[0] for r in rows)
                    failures = db.execute(
                        "SELECT type FROM messages WHERE conversation_id=? AND (status='error' OR (type='agent_status' AND json_extract(content, '$.status')='error'))",
                        (conversation,),
                    ).fetchall()
                    assert (
                        not failures
                    ), "Application reported a failed turn; inspect its logs before retrying"
            if (
                receipts
                and f'BOOKED:{receipts[0]["id"]}' in final
                and f"BADGE:{badge}" in final
                and "[[NEXUS_GENERATED_FILES]]" in final
            ):
                break
            if not conversation and time.monotonic() > deadline - args.timeout + 30:
                raise AssertionError(
                    "Application did not accept the submitted task within 30 seconds"
                )
            await asyncio.sleep(3)
        else:
            raise AssertionError(
                "Real application/model did not finish the reservation and image-reading task"
            )
        assert (
            len(receipts) == 1
            and receipts[0]["name"] == "林晓"
            and receipts[0]["trusted"]
        ), receipts
        with sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True) as db:
            events = [
                json.loads(row[0])["update"]
                for row in db.execute(
                    "SELECT content FROM messages WHERE conversation_id=? AND type='acp_tool_call' ORDER BY created_at",
                    (conversation,),
                )
            ]
        executions = [
            event for event in events if event.get("title") in ("Bash", "PowerShell")
        ]
        commands = [
            event.get("rawInput", {}).get("command", "") for event in executions
        ]
        report.update(
            conversation=conversation,
            badge=badge,
            execution_tools=[event["title"] for event in executions],
            commands=commands,
            tools=[
                {"name": event.get("title"), "status": event.get("status")}
                for event in events
            ],
        )
        assert (
            executions
        ), "The model did not invoke the browser through its execution tool"
        if os.name == "nt":
            assert (
                executions[0]["title"] == "PowerShell"
            ), "Windows skill did not steer the model to its working shell"
        assert any(
            "browser --list" in command for command in commands
        ), "Model bypassed runtime tool discovery"
        catalog_events = [
            event
            for event in executions
            if "browser --list" in event.get("rawInput", {}).get("command", "")
        ]
        is_rust_catalog = "suh.describe.v1" in json.dumps(catalog_events)
        assert is_rust_catalog == (
            args.backend == "sudohand"
        ), "The application invoked a different backend"
        assert any(
            "browser page_screenshot" in command for command in commands
        ), "Model bypassed browser capture"
        assert not any(
            event.get("status") == "failed" for event in executions
        ), "Execution failures require a steering review"
        image_reads = [
            event
            for event in events
            if event.get("title") == "read_file"
            and Path(event.get("rawInput", {}).get("path", "")).suffix.lower()
            in (".png", ".jpg", ".jpeg")
            and event.get("status") == "completed"
        ]
        assert image_reads, "The model did not successfully open its screenshot"
        capture = Path(image_reads[-1]["rawInput"]["path"]).resolve()
        assert capture.is_relative_to(
            database.parent
        ), "Screenshot escaped the disposable profile"
        with Image.open(capture) as captured_image:
            dimensions = list(captured_image.size)

        async def ui(tool, *arguments):
            return await asyncio.to_thread(
                command,
                tool,
                "--port",
                str(args.app_port),
                "--tab-url",
                "/renderer/index.html",
                *arguments,
            )

        # The generated-file card arrives after the final text. Wait for that
        # chat button; a same-name workspace tree item only selects the file.
        attachment_deadline = time.monotonic() + 40
        while time.monotonic() < attachment_deadline:
            await ui(
                "js_evaluate",
                "--expression",
                "(()=>{const e=document.querySelector('[data-virtuoso-scroller]');if(e)e.scrollTop=e.scrollHeight;return Boolean(e)})()",
            )
            # Capturing requests a painted frame even when Electron is behind
            # another window. Its virtual list otherwise keeps stale contents.
            await ui("page_screenshot", "--path", str(output / "chat-attachment.png"))
            target = await ui("find_by_text", "--text", capture.name)
            if (
                target.get("found")
                and target.get("role") == "button"
                and target.get("ref")
            ):
                break
            await asyncio.sleep(0.5)
        else:
            raise AssertionError(
                "Screenshot attachment is absent from the completed chat"
            )
        await ui("click_by_ref", "--ref", target["ref"])
        await ui(
            "page_screenshot", "--path", str(output / "sudowork-image-preview.png")
        )
        preview_deadline = time.monotonic() + 20
        while time.monotonic() < preview_deadline:
            shown = await ui(
                "js_evaluate",
                "--expression",
                "[...document.images].filter(i=>i.complete&&i.getBoundingClientRect().width>100).map(i=>[i.naturalWidth,i.naturalHeight])",
            )
            if dimensions in shown["result"]:
                break
            await asyncio.sleep(0.5)
        else:
            raise AssertionError(
                "The generated screenshot did not load in the application preview"
            )
        await ui(
            "page_screenshot", "--path", str(output / "sudowork-image-preview.png")
        )
        (output / capture.name).write_bytes(capture.read_bytes())
        current_url = (await js_evaluate(tab, "location.href"))["result"]
        assert (
            "/renderer/" in current_url or ":5" in current_url
        ), "The model navigated the application itself"
        report.update(status="passed", preview_dimensions=dimensions)
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        if browser:
            try:
                await page_screenshot(tab, path=str(output / "sudowork-chat.png"))
                (output / "chat-dom.txt").write_text(
                    (await js_evaluate(tab, "document.body.innerText"))["result"],
                    encoding="utf-8",
                )
            except Exception as error:
                report["capture_error"] = str(error)
            finally:
                await browser.close()
        try:
            if port:
                await asyncio.to_thread(command, "browser_stop", "--port", port)
        finally:
            server.shutdown()
            server.server_close()
            (output / "ui-live-report.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-port", type=int, required=True)
    parser.add_argument(
        "--backend", choices=["sudohand", "ai-dev-browser"], default="sudohand"
    )
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--suh", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=420)
    asyncio.run(main(parser.parse_args()))
