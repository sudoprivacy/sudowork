"""Boot the packaged WebUI through Compose and retain prior release assets."""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from gateway_assets import NGINX_IMAGE, verify_gateway_fixture


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def main(args, is_released=False):
    root = Path(__file__).resolve().parents[4]
    fixture = "sudowork-container-smoke-" + uuid.uuid4().hex[:12]
    temporary = tempfile.TemporaryDirectory(prefix=fixture)
    temporary_root = Path(temporary.name).resolve()
    assert temporary_root.parent == Path(tempfile.gettempdir()).resolve()
    assert temporary_root.name.startswith(fixture)
    asset_volume = fixture + "_webui-assets"
    is_configured = False
    environment = {
        **os.environ,
        "COMPOSE_PROJECT_NAME": fixture,
        "WEBUI_IMAGE": args.image,
        "WEBUI_PORT": "127.0.0.1:0",
        "POSTGRES_USER": "fixture",
        "POSTGRES_PASSWORD": "fixture",
        "POSTGRES_DB": "fixture",
        "PUBLIC_ORIGIN": "https://webui.invalid",
        "MOSS_BASE_URL": "https://moss.invalid",
        "MOSS_WS_BASE_URL": "wss://moss.invalid",
        "MOSS_ALLOWED_ORIGINS": "",
        "CSP_IMG_SRC_ORIGINS": "",
        "SESSION_HMAC_KEY": "a" * 64,
        "TOKEN_AES_KEY": "b" * 64,
    }
    command = [
        "docker",
        "compose",
        "--project-name",
        fixture,
        "--file",
        str(root / "apps/webui/docker-compose.yml"),
    ]

    def compose(*arguments):
        return run(*command, *arguments, cwd=root, env=environment)

    def publish(*sources, include_previous=False):
        mounts = [
            "--mount",
            f"type=volume,source={asset_volume},target=/retained-assets",
        ]
        if include_previous:
            mounts += [
                "--mount",
                f"type=bind,source={temporary_root / 'previous-assets'},target=/previous-assets,readonly",
            ]
        return [
            "docker",
            "run",
            "--rm",
            "--label",
            "sudowork.fixture=" + fixture,
            *mounts,
            args.image,
            "node",
            "dist/server/publishAssets.js",
            "--target",
            "/retained-assets",
            *sources,
        ]

    try:
        if args.build and (not is_released or args.compose_origin == "release"):
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
        run("docker", "image", "inspect", args.image)
        if is_released:
            released = temporary_root / "released"
            released.mkdir()
            setup = [
                "docker",
                "run",
                "--rm",
                "--label",
                "sudowork.fixture=" + fixture,
                "--mount",
                f"type=bind,source={root / 'apps/webui/deploy/install.sh'},target=/install.sh,readonly",
                "--mount",
                f"type=bind,source={released},target=/generated",
            ]
            for key in (
                "POSTGRES_USER",
                "POSTGRES_PASSWORD",
                "POSTGRES_DB",
                "PUBLIC_ORIGIN",
                "MOSS_BASE_URL",
                "MOSS_WS_BASE_URL",
                "SESSION_HMAC_KEY",
                "TOKEN_AES_KEY",
            ):
                setup += ["--env", key + "=" + environment[key]]
            setup += [
                "--env",
                "WEBUI_RELEASE_TAG=v1.2.3",
                "--env",
                "WEBUI_INSTALL_USER=root",
                args.image,
                "bash",
                "/install.sh",
                "--dry-run",
                "--non-interactive",
                "--install-dir",
                "/generated",
            ]
            run(*setup)
            if os.name == "posix":
                # The real installer runs as root; return only this synthetic
                # fixture tree to its host owner before Compose reads .env.
                ownership = (
                    "const fs=require('fs'),path=require('path');"
                    "function own(p){const s=fs.lstatSync(p);"
                    "if(s.isSymbolicLink())throw Error('Unexpected fixture link');"
                    "if(s.isDirectory())for(const n of fs.readdirSync(p))own(path.join(p,n));"
                    "fs.chownSync(p,Number(process.argv[1]),Number(process.argv[2]));}"
                    "own('/generated');"
                )
                run(
                    "docker",
                    "run",
                    "--rm",
                    "--label",
                    "sudowork.fixture=" + fixture,
                    "--mount",
                    f"type=bind,source={released},target=/generated",
                    args.image,
                    "node",
                    "-e",
                    ownership,
                    str(os.getuid()),
                    str(os.getgid()),
                )
            # Keep fixture database ownership in a named volume on every host.
            # Only the local image and database storage differ from the release.
            override = released / "fixture.json"
            override.write_text(
                json.dumps(
                    {
                        "services": {
                            "postgres": {
                                "volumes": [
                                    {
                                        "type": "volume",
                                        "source": "webui-pgdata",
                                        "target": "/var/lib/postgresql/data",
                                    }
                                ]
                            },
                            **{
                                service: {"image": args.image}
                                for service in ("webui", "migrate", "publish-assets")
                            },
                        },
                        "volumes": {"webui-pgdata": {}},
                    }
                ),
                encoding="utf-8",
            )
            command = [
                "docker",
                "compose",
                "--project-name",
                fixture,
                "--file",
                str(released / "docker-compose.yml"),
                "--file",
                str(override),
            ]
        initialization = temporary_root / "hold-initialization.sh"
        initialization.write_bytes(
            b"#!/bin/sh\nset -eu\n"
            b"touch /tmp/sudowork-init-waiting\n"
            b"attempt=0\n"
            b"while [ ! -f /tmp/sudowork-init-release ]; do\n"
            b"  attempt=$((attempt + 1))\n"
            b"  [ $attempt -lt 1200 ] || exit 1\n"
            b"  sleep 0.1\ndone\n"
        )
        readiness = temporary_root / "readiness.json"
        readiness.write_text(
            json.dumps(
                {
                    "services": {
                        "postgres": {
                            "volumes": [
                                {
                                    "type": "bind",
                                    "source": str(initialization),
                                    "target": "/docker-entrypoint-initdb.d/90-sudowork-readiness.sh",
                                    "read_only": True,
                                }
                            ]
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        command += ["--file", str(readiness)]
        model = json.loads(compose("config", "--format", "json"))
        assert model["name"] == fixture
        assert model["volumes"]["webui-assets"]["name"] == asset_volume
        assert model["volumes"]["webui-pgdata"]["name"] == fixture + "_webui-pgdata"
        assert all(
            value["name"].startswith(fixture + "_")
            for value in model["networks"].values()
        )
        assert all(
            model["services"][service]["image"] == args.image
            for service in ("webui", "migrate", "publish-assets")
        )
        is_configured = True
        run(
            "docker",
            "volume",
            "create",
            "--label",
            "com.docker.compose.project=" + fixture,
            "--label",
            "com.docker.compose.volume=webui-assets",
            "--label",
            "sudowork.fixture=" + fixture,
            asset_volume,
        )
        previous = temporary_root / "previous-assets"
        previous.mkdir()
        legacy_name = "legacy-browser-A1b2C3d4.js"
        legacy_bytes = (
            "globalThis.previousBrowserBuild=" + json.dumps(fixture) + ";"
        ).encode()
        (previous / legacy_name).write_bytes(legacy_bytes)
        seeded = json.loads(run(*publish("/previous-assets", include_previous=True)))
        assert seeded["added"] == 1

        # Use the deployment's actual prerequisite and read-only mount.
        if subprocess.run(
            ["docker", "image", "inspect", "postgres:16-alpine"],
            capture_output=True,
            check=False,
        ).returncode:
            run("docker", "pull", "postgres:16-alpine")
        compose("up", "-d", "--no-build", "--pull", "never", "postgres")
        database = compose("ps", "--quiet", "postgres")
        deadline = time.monotonic() + 90
        while subprocess.run(
            [
                "docker",
                "exec",
                database,
                "sh",
                "-c",
                "test -f /tmp/sudowork-init-waiting",
            ],
            capture_output=True,
            check=False,
        ).returncode:
            assert time.monotonic() < deadline, (
                "PostgreSQL initialization fixture did not start"
            )
            time.sleep(0.1)
        try:
            # The temporary init server accepts local sockets before the real
            # TCP server starts. Run the deployment's actual health command.
            run(
                "docker",
                "exec",
                database,
                "pg_isready",
                "-U",
                "fixture",
                "-d",
                "fixture",
            )
            health = model["services"]["postgres"]["healthcheck"]["test"]
            assert health[0] == "CMD-SHELL"
            probe = subprocess.run(
                ["docker", "exec", database, "sh", "-c", health[1]],
                capture_output=True,
                text=True,
                check=False,
            )
            assert probe.returncode != 0, (
                "Deployment must not call the temporary Unix-only server ready"
            )
        finally:
            released_init = subprocess.run(
                ["docker", "exec", database, "touch", "/tmp/sudowork-init-release"],
                capture_output=True,
                text=True,
                check=False,
            )
        assert released_init.returncode == 0, released_init.stderr
        compose(
            "up",
            "-d",
            "--no-build",
            "--pull",
            "never",
            "--wait",
            "--wait-timeout",
            "90",
            "webui",
        )
        app = compose("ps", "--quiet", "webui")
        app_info = json.loads(run("docker", "inspect", app))[0]
        assert app_info["Config"]["Labels"]["com.docker.compose.project"] == fixture
        mount = next(
            item
            for item in app_info["Mounts"]
            if item["Destination"] == "/app/apps/webui/dist/client/assets"
        )
        assert mount["Name"] == asset_volume and mount["RW"] is False
        port = app_info["NetworkSettings"]["Ports"]["26808/tcp"][0]["HostPort"]
        origin = "http://127.0.0.1:" + port
        local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with local_http.open(origin + "/health/live", timeout=5) as response:
            assert json.load(response) == {"status": "ok"}
        with local_http.open(origin + "/", timeout=5) as response:
            html = response.read().decode()
        scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
        assert scripts, "Production SPA must include its built JavaScript"
        for script in scripts:
            with local_http.open(origin + script, timeout=10) as response:
                assert response.status == 200 and len(response.read()) > 100
        legacy_url = origin + "/assets/" + legacy_name
        with local_http.open(legacy_url, timeout=10) as response:
            assert response.read() == legacy_bytes
        repeated = json.loads(run(*publish("/app/apps/webui/dist/client/assets")))
        assert repeated["added"] == 0 and repeated["retained"] > 0
        (previous / legacy_name).write_bytes(
            b"conflicting bytes under an unchanged asset name"
        )
        collision = subprocess.run(
            publish("/previous-assets", include_previous=True),
            capture_output=True,
            text=True,
            check=False,
        )
        assert collision.returncode != 0 and "conflicting contents" in collision.stderr
        with local_http.open(legacy_url, timeout=10) as response:
            assert response.read() == legacy_bytes, (
                "A rejected publication must preserve original bytes"
            )
        with local_http.open(origin + "/browser-viewer/fixture", timeout=5) as response:
            assert response.read().decode() == html
        gateway = verify_gateway_fixture(root, app_info, args.gateway_image, fixture)
        print(
            json.dumps(
                {
                    "passed": True,
                    "image": args.image,
                    "realDocker": True,
                    "actualCompose": True,
                    "composeOrigin": "release-installer" if is_released else "source",
                    "migrations": True,
                    "postgresInitializationGated": True,
                    "health": True,
                    "productionScripts": len(scripts),
                    "viewerSpa": True,
                    "oldAssetsAcrossUpgrade": True,
                    "readOnlyAssetVolume": True,
                    "assetPublicationIdempotent": True,
                    "conflictingAssetRejectedWithoutOverwrite": True,
                    "publicAssetGateway": gateway,
                }
            ),
            flush=True,
        )
    except BaseException:
        if is_configured:
            diagnostic = subprocess.run(
                [*command, "logs", "--no-color", "--timestamps"],
                cwd=root,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
            print(diagnostic.stdout, file=sys.stderr, flush=True)
        raise
    finally:
        if is_configured:
            containers = compose("ps", "--all", "--quiet").splitlines()
            for identifier in containers:
                info = json.loads(run("docker", "inspect", identifier))[0]
                assert info["Config"]["Labels"]["com.docker.compose.project"] == fixture
            for name in (asset_volume, fixture + "_webui-pgdata"):
                result = subprocess.run(
                    ["docker", "volume", "inspect", name],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if result.returncode == 0:
                    assert (
                        json.loads(result.stdout)[0]["Labels"][
                            "com.docker.compose.project"
                        ]
                        == fixture
                    )
            compose("down", "--volumes", "--remove-orphans")
        assert Path(temporary.name).resolve() == temporary_root
        temporary.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--gateway-image", default=NGINX_IMAGE)
    parser.add_argument(
        "--compose-origin", choices=("source", "release", "both"), default="both"
    )
    arguments = parser.parse_args()
    if arguments.compose_origin in ("source", "both"):
        main(arguments)
    if arguments.compose_origin in ("release", "both"):
        main(arguments, is_released=True)
