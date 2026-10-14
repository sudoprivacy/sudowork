"""Build and boot the actual WebUI Docker image with an isolated PostgreSQL."""

import argparse
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def main(args):
    root = Path(__file__).resolve().parents[4]
    fixture = "sudowork-container-smoke-" + uuid.uuid4().hex[:12]
    owned = []
    network = None
    try:
        if args.build:
            subprocess.run(
                [
                    "docker",
                    "build",
                    "--file",
                    "apps/webui/Dockerfile",
                    "--tag",
                    args.image,
                    ".",
                ],
                cwd=root,
                check=True,
            )
        network = run(
            "docker",
            "network",
            "create",
            "--label",
            "sudowork.fixture=" + fixture,
            fixture,
        )
        pg = run(
            "docker",
            "run",
            "--detach",
            "--name",
            fixture + "-pg",
            "--network",
            fixture,
            "--network-alias",
            "postgres",
            "--label",
            "sudowork.fixture=" + fixture,
            "--env",
            "POSTGRES_USER=fixture",
            "--env",
            "POSTGRES_PASSWORD=fixture",
            "--env",
            "POSTGRES_DB=fixture",
            "postgres:16-alpine",
        )
        owned.append(pg)
        deadline = time.monotonic() + 60
        while subprocess.run(
            [
                "docker",
                "exec",
                pg,
                "pg_isready",
                "-h",
                "127.0.0.1",
                "-U",
                "fixture",
                "-d",
                "fixture",
            ],
            capture_output=True,
            check=False,
        ).returncode:
            assert time.monotonic() < deadline, (
                "Isolated PostgreSQL did not become ready"
            )
            time.sleep(0.25)
        environment = [
            "--env",
            "DATABASE_URL=postgres://fixture:fixture@postgres:5432/fixture",
            "--env",
            "PUBLIC_ORIGIN=https://webui.invalid",
            "--env",
            "MOSS_BASE_URL=https://moss.invalid",
            "--env",
            "MOSS_WS_BASE_URL=wss://moss.invalid",
            "--env",
            "SESSION_HMAC_KEY=" + "a" * 64,
            "--env",
            "TOKEN_AES_KEY=" + "b" * 64,
            "--env",
            "PORT=26808",
        ]
        subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                fixture,
                *environment,
                args.image,
                "node",
                "dist/server/migrate.js",
            ],
            check=True,
        )
        app = run(
            "docker",
            "run",
            "--detach",
            "--name",
            fixture + "-webui",
            "--network",
            fixture,
            "--label",
            "sudowork.fixture=" + fixture,
            "--publish",
            "127.0.0.1::26808",
            *environment,
            args.image,
        )
        owned.append(app)
        port = json.loads(run("docker", "inspect", app))[0]["NetworkSettings"]["Ports"][
            "26808/tcp"
        ][0]["HostPort"]
        origin = "http://127.0.0.1:" + port
        local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 45
        while True:
            try:
                with local_http.open(origin + "/health/live", timeout=2) as response:
                    assert json.load(response) == {"status": "ok"}
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                assert time.monotonic() < deadline, (
                    "Packaged WebUI did not become ready"
                )
                time.sleep(0.25)
        with local_http.open(origin + "/", timeout=5) as response:
            html = response.read().decode()
        scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
        assert scripts, "Production SPA must include its built JavaScript"
        for script in scripts:
            with local_http.open(origin + script, timeout=10) as response:
                assert response.status == 200 and len(response.read()) > 100
        with local_http.open(origin + "/browser-viewer/fixture", timeout=5) as response:
            assert response.read().decode() == html, (
                "Viewer navigation must serve the same SPA"
            )
        print(
            json.dumps(
                {
                    "passed": True,
                    "image": args.image,
                    "realDocker": True,
                    "migrations": True,
                    "health": True,
                    "productionScripts": len(scripts),
                    "viewerSpa": True,
                }
            )
        )
    finally:
        for identifier in reversed(owned):
            assert re.fullmatch(r"[a-f0-9]{64}", identifier)
            subprocess.run(
                ["docker", "rm", "--force", "--volumes", identifier],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        if network:
            assert re.fullmatch(r"[a-f0-9]{64}", network)
            subprocess.run(
                ["docker", "network", "rm", network],
                check=True,
                stdout=subprocess.DEVNULL,
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--build", action="store_true")
    main(parser.parse_args())
