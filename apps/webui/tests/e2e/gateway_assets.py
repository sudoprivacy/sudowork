"""Verify public asset transport through a real isolated nginx gateway."""

import gzip
import hashlib
import json
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

NGINX_IMAGE = (
    "nginx@sha256:b34848eff6db786b6b1282d3a9c3fd0b5563dfb6d261df4923378b419e0d24f0"
)


def verify_asset_delivery(origin):
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(path, headers=None):
        request = urllib.request.Request(origin + path, headers=headers or {})
        try:
            response = http.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    status, html_headers, html = get("/")
    assert status == 200 and html_headers.get("Cache-Control") == "no-store"
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', html.decode())
    assert scripts and scripts[0].startswith("/assets/")
    asset = scripts[0]
    status, plain_headers, plain = get(asset, {"Accept-Encoding": "identity"})
    assert status == 200 and len(plain) > 1024
    assert "immutable" in plain_headers.get("Cache-Control", "")
    assert "max-age=31536000" in plain_headers.get("Cache-Control", "")
    status, encoded_headers, encoded = get(asset, {"Accept-Encoding": "gzip"})
    assert status == 200 and encoded_headers.get("Content-Encoding") == "gzip"
    assert "accept-encoding" in encoded_headers.get("Vary", "").lower()
    assert gzip.decompress(encoded) == plain, "Compressed response changed the asset"
    assert len(encoded) < len(plain) // 2, "Entry module compression is ineffective"
    etag = plain_headers.get("ETag")
    assert etag
    status, unchanged_headers, unchanged = get(asset, {"If-None-Match": etag})
    assert status == 304 and unchanged == b""
    assert "immutable" in unchanged_headers.get("Cache-Control", "")
    status, missing_headers, _ = get("/assets/sudowork-missing-transport-fixture.js")
    assert status == 404 and missing_headers.get("Cache-Control") == "no-store"
    status, auth_headers, _ = get("/api/auth/session")
    assert status == 401 and auth_headers.get("Cache-Control") == "no-store"
    assert auth_headers.get("Content-Encoding") is None
    return {
        "passed": True,
        "asset": asset,
        "plainBytes": len(plain),
        "gzipBytes": len(encoded),
        "sha256": hashlib.sha256(plain).hexdigest(),
        "immutableAssets": True,
        "conditionalRead": True,
        "missingAssetsAndPrivateApiNotCached": True,
        "htmlNotCached": True,
    }


def verify_gateway_fixture(root, app_info, image, fixture):
    temporary = tempfile.TemporaryDirectory(prefix=fixture + "-gateway-")
    folder = Path(temporary.name).resolve()
    assert folder.parent == Path(tempfile.gettempdir()).resolve()
    assert folder.name.startswith(fixture + "-gateway-")
    name = fixture + "-gateway"
    created = False

    def run(*args):
        return subprocess.check_output(args, text=True).strip()

    try:
        snippets = root / "apps/webui/deploy/nginx"
        config = folder / "default.conf"
        config.write_text(
            "server { listen 80; server_name _; "
            "include /etc/nginx/sudowork/static-assets.conf; "
            "location / { proxy_pass http://webui:26808; } }\n",
            encoding="utf-8",
        )
        networks = app_info["NetworkSettings"]["Networks"]
        assert len(networks) == 1
        network = next(iter(networks))
        arguments = [
            "docker",
            "create",
            "--name",
            name,
            "--label",
            "sudowork.fixture=" + fixture,
            "--network",
            network,
            "--publish",
            "127.0.0.1::80",
        ]
        for source, target in (
            (config, "/etc/nginx/conf.d/default.conf"),
            (snippets / "static-cache.conf", "/etc/nginx/conf.d/00-static-cache.conf"),
            (snippets / "static-assets.conf", "/etc/nginx/sudowork/static-assets.conf"),
        ):
            arguments += [
                "--mount",
                f"type=bind,source={source},target={target},readonly",
            ]
        identifier = run(*arguments, image)
        created = True
        run("docker", "start", identifier)
        run("docker", "exec", name, "nginx", "-t")
        info = json.loads(run("docker", "inspect", name))[0]
        port = info["NetworkSettings"]["Ports"]["80/tcp"][0]["HostPort"]
        deadline = time.monotonic() + 10
        while True:
            state = json.loads(run("docker", "inspect", name))[0]["State"]
            assert state["Running"], "Isolated gateway exited"
            try:
                result = verify_asset_delivery("http://127.0.0.1:" + port)
                break
            except urllib.error.URLError:
                assert time.monotonic() < deadline, "Isolated gateway did not listen"
                time.sleep(0.1)
        return {**result, "realNginx": True, "gatewayImage": image}
    finally:
        if created:
            info = json.loads(run("docker", "inspect", name))[0]
            assert info["Config"]["Labels"]["sudowork.fixture"] == fixture
            run("docker", "stop", "--time", "5", info["Id"])
            run("docker", "rm", info["Id"])
        assert Path(temporary.name).resolve() == folder
        temporary.cleanup()
