"""Run the browser journey's real HTTP fixture on a private VM interface."""

import ast
from contextlib import contextmanager
import ipaddress
import json
from pathlib import Path
import shlex
import textwrap
import threading
from types import SimpleNamespace


@contextmanager
def private_fixture(ssh, *, bind_host="172.17.0.1"):
    """Use an already authenticated SSH client; preserve its identity policy."""
    address = ipaddress.ip_address(bind_host)
    assert address.version == 4 and address.is_private and not address.is_unspecified
    source = Path(__file__).with_name("live_cloud_browser.py").read_text("utf-8")
    site, = [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ClassDef) and node.name == "Site"
    ]
    site_source = textwrap.dedent(ast.get_source_segment(source, site))
    remote = """from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, select, sys, threading
from urllib.parse import parse_qs, urlsplit
lock = threading.Lock()
def emit(value):
    with lock:
        print(json.dumps(value), flush=True)
class Events:
    def __init__(self, kind): self.kind = kind
    def append(self, value): emit({'kind': self.kind, 'value': value})
visits, receipts = Events('visit'), Events('submit')
""" + site_source + """
server = ThreadingHTTPServer((BIND_HOST, 0), Site)
emit({'kind':'ready','port':server.server_port})
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    select.select([sys.stdin], [], [], 900)
finally:
    server.shutdown()
    server.server_close()
    emit({'kind':'closed'})
"""
    remote = remote.replace("BIND_HOST", repr(str(address)))
    fixture = SimpleNamespace(
        receipts=[], visits=[],
        proof={"publicPort": False, "sshForwarding": False,
               "fixtureTimeoutSeconds": 900, "persistentServiceCreated": False},
    )
    stdin, stdout, stderr = ssh.exec_command(
        "python3 -u -c " + shlex.quote(remote), timeout=45
    )
    try:
        ready = json.loads(stdout.readline())
        assert ready["kind"] == "ready" and 1024 < ready["port"] < 65536
        fixture.port = ready["port"]
        fixture.origin = f"http://{address}:{fixture.port}"
        fixture.proof.update(
            privateOrigin=fixture.origin, visits=fixture.visits, receipts=fixture.receipts
        )
        # The stream spans the complete journey. The remote lifetime bounds it;
        # individual UI and model deadlines remain in live_cloud_browser.py.
        stdout.channel.settimeout(None)

        def receive():
            for line in stdout:
                value = json.loads(line)
                if value["kind"] == "visit":
                    fixture.visits.append(value["value"])
                elif value["kind"] == "submit":
                    fixture.receipts.append(value["value"])
                elif value["kind"] == "closed":
                    fixture.proof["closed"] = True

        reader = threading.Thread(target=receive, daemon=True)
        reader.start()
        probe = """import json, urllib.request
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open(ORIGIN+'/health',timeout=10) as response:
    data=response.read()
    print(json.dumps({'status':response.status,'fixtureTitle':b'Desktop cloud fixture' in data}))
""".replace("ORIGIN", repr(fixture.origin))
        _, checked, error = ssh.exec_command(
            "python3 -c " + shlex.quote(probe), timeout=20
        )
        report = checked.read().decode()
        assert checked.channel.recv_exit_status() == 0, error.read().decode()
        fixture.proof["preflight"] = json.loads(report)
        assert fixture.proof["preflight"] == {"status": 200, "fixtureTitle": True}
        yield fixture
    finally:
        stdin.write("x\n")
        stdin.flush()
        stdin.channel.shutdown_write()
        if "reader" in locals():
            reader.join(timeout=10)
        code = stdout.channel.recv_exit_status()
        fixture.proof.update(exit=code, stderr=stderr.read().decode())
        assert code == 0 and fixture.proof.get("closed"), (
            "The private fixture did not acknowledge shutdown: " + json.dumps(fixture.proof)
        )
