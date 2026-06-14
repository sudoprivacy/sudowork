#!/bin/bash
#
# Local-reproducer for the Linux secrets-grpc end-to-end test.
#
# What it exercises:
#   1. `bun run nexus-vfs:download` — fetches nexusd-cluster + vault dylib +
#      local-connector + fuse-plugin from COS into ~/.nexus-vfs/. Catches
#      SHA256 manifest drift in scripts/download-nexus-vfs.js the moment
#      the pinned `runtime-versions.json` falls out of sync with the
#      published artifacts.
#   2. `bun run build:native` — builds the nexus-napi binding for the
#      host platform.
#   3. Starts nexusd-cluster on 0.0.0.0:2028 with --plugin-dir, asserting
#      the plugin set loads with the trust root + ABI it was built
#      against.
#   4. Runs `tests/integration/secrets-grpc.integration.test.ts` against
#      that live cluster — full CRUD round-trip through napi → gRPC
#      (HTTP/2) → vault plugin → kernel syscalls.
#
# Run locally inside a Docker container that has Rust + Node toolchains.
# Example invocation from a host with Docker Desktop:
#
#   docker run --rm \
#     -v "$PWD:/work/sudowork:ro" \
#     -v sudowork-cargo-registry:/usr/local/cargo/registry \
#     -v sudowork-cargo-git:/usr/local/cargo/git \
#     rust:1-bookworm \
#     bash /work/sudowork/scripts/dev/linux-e2e.sh
#
# The script copies the repo into a writable workspace inside the
# container so `bun install` + native build don't bleed back to the
# host worktree.
#
# CI runs the same flow inline in .github/workflows/pr-integration-smoke.yml
# (no docker indirection — the runner is already ubuntu-latest), so this
# script stays in sync with what production CI verifies.

set -uo pipefail

WORK=${WORK_DIR:-/root/work}
SOURCE_MOUNT=${SOURCE_MOUNT:-/work/sudowork}
mkdir -p "$WORK"
export HOME=${HOME:-/root}

echo "=== ENV ==="
uname -a
rustc --version
cargo --version
echo ""

echo "=== STEP 1: apt deps + bun ==="
apt-get update -qq
apt-get install -y -qq curl unzip ca-certificates protobuf-compiler pkg-config libssl-dev build-essential 2>&1 | tail -3
curl -fsSL https://bun.sh/install | bash 2>&1 | tail -3
export PATH="$HOME/.bun/bin:$PATH"
bun --version
echo ""

echo "=== STEP 2: stage sudowork into a writable copy ==="
cp -r "$SOURCE_MOUNT" "$WORK/sudowork"
cd "$WORK/sudowork"
echo ""

echo "=== STEP 3: bun install ==="
date -u
bun install 2>&1 | tail -8
date -u
echo ""

echo "=== STEP 4: nexus-vfs:download (cluster + plugins from COS) ==="
date -u
bun run nexus-vfs:download 2>&1 | tail -25
RC4=$?
date -u
echo "[download rc=$RC4]"
ls -la "$HOME/.nexus-vfs/bin/" "$HOME/.nexus-vfs/plugins/" 2>&1 | head -15
echo ""

echo "=== STEP 5: build:native (napi for the host platform) ==="
date -u
bun run build:native 2>&1 | tail -10
RC5=$?
date -u
echo "[build:native rc=$RC5]"
ls -la native/nexus-napi/*.node native/nexus-napi/index.* 2>&1 | head -5
echo ""

echo "=== STEP 6: launch nexusd-cluster on :2028 ==="
mkdir -p "$WORK/cluster-data"
RUST_LOG=info,kernel::kernel::plugins=info nohup "$HOME/.nexus-vfs/bin/nexusd-cluster" \
  --bind-addr 0.0.0.0:2028 \
  --data-dir "$WORK/cluster-data" \
  --no-tls \
  --bootstrap-mode static \
  --plugin-dir "$HOME/.nexus-vfs/plugins" \
  > "$WORK/cluster.log" 2>&1 &
CLUSTER_PID=$!
echo "cluster pid=$CLUSTER_PID"
sleep 6
echo "--- cluster log head ---"
head -25 "$WORK/cluster.log"
echo "--- plugin load events ---"
grep -E "plugins loaded|plugin loaded|skip plugin|signature verified" "$WORK/cluster.log" | head -15
echo ""

echo "=== STEP 7: NEXUS_E2E=1 vitest run secrets-grpc ==="
date -u
NEXUS_E2E=1 bunx vitest run tests/integration/secrets-grpc.integration.test.ts 2>&1 | tail -30
RC7=$?
date -u
echo "[vitest rc=$RC7]"
echo ""

echo "=== STEP 8: stop cluster ==="
kill "$CLUSTER_PID" 2>/dev/null || true
sleep 2
echo ""

echo "=== summary ==="
echo "download:$RC4  build:native:$RC5  vitest:$RC7"
[ "$RC4" -eq 0 ] && [ "$RC5" -eq 0 ] && [ "$RC7" -eq 0 ] && echo "ALL GREEN" || echo "FAILURES PRESENT"
exit $RC7
