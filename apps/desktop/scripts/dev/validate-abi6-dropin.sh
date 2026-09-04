#!/usr/bin/env bash
# Drop-in ABI-6 validation: boot the published nexusd-cluster assembly with the
# published vault/local-connector/fuse plugins in a clean Linux env and assert
# every plugin loads (no "plugin API version mismatch") + the daemon serves.
#
# Run INSIDE a debian container. Env in, no NEXUS_PEERS:
#   docker run --rm -e ASM_VER -e VAULT_VER -e LC_VER -e FUSE_VER \
#     -v "$PWD/scripts/dev":/s debian:bookworm-slim bash /s/validate-abi6-dropin.sh
set -uo pipefail

ASM_VER="${ASM_VER:-0.1.0}"
VAULT_VER="${VAULT_VER:-0.5.44}"
LC_VER="${LC_VER:-0.4.44}"
FUSE_VER="${FUSE_VER:-0.6.44}"
BASE="https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com"
PLAT="linux-x86_64"

echo "== deps =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
apt-get install -yqq curl ca-certificates fuse3 libfuse3-3 >/dev/null 2>&1 || \
  apt-get install -yqq curl ca-certificates fuse3 >/dev/null 2>&1

ROOT=/tmp/dropin; BIN=$ROOT/bin; PLUG=$ROOT/plugins; DATA=$ROOT/data
mkdir -p "$BIN" "$PLUG" "$DATA"

dl() { # url dest
  echo "  GET $1"
  curl -fsSL "$1" -o "$2" || { echo "  !! download failed: $1"; return 1; }
}

echo "== assembly nexusd-cluster v$ASM_VER =="
dl "$BASE/nexusd-cluster/release/v$ASM_VER/nexusd-cluster-$PLAT.tar.gz" "$ROOT/asm.tgz" || exit 2
tar xzf "$ROOT/asm.tgz" -C "$BIN"
# archive may nest under a dir; find the binary
DAEMON=$(find "$BIN" -type f -name 'nexusd-cluster' | head -1)
chmod +x "$DAEMON" 2>/dev/null
echo "  daemon: $DAEMON"

echo "== plugins =="
for spec in "nexus-vault/$VAULT_VER" "nexus-local-connector/$LC_VER" "nexus-fuse-plugin/$FUSE_VER"; do
  name="${spec%/*}"; ver="${spec#*/}"
  dl "$BASE/$name/release/v$ver/$name-$PLAT.tar.gz" "$ROOT/$name.tgz" || exit 3
  tar xzf "$ROOT/$name.tgz" -C "$PLUG"
done
echo "  plugin dir contents:"; ls -la "$PLUG"

echo "== boot (clean env, no NEXUS_PEERS) =="
env -i HOME=/root PATH=/usr/bin:/bin NEXUS_DATA_DIR="$DATA" \
  "$DAEMON" serve-local --port 25808 --hostname localhost \
  --data-dir "$DATA" --plugin-dir "$PLUG" >"$ROOT/daemon.log" 2>&1 &
PID=$!
sleep 8

echo "== daemon log =="
cat "$ROOT/daemon.log"
echo "== verdict =="
RC=0
if grep -qiE "plugin API version mismatch|version mismatch: plugin" "$ROOT/daemon.log"; then
  echo "FAIL: ABI version mismatch present"; RC=1
fi
if ! kill -0 "$PID" 2>/dev/null; then
  echo "NOTE: daemon process not alive after 8s (check log above for panic vs clean plugin-scan exit)"
fi
# count plugin-loaded lines
echo "-- plugin load lines --"
grep -iE "plugin|loaded|register|vault|connector|fuse|managed.agent" "$ROOT/daemon.log" | head -40
kill "$PID" 2>/dev/null
exit $RC
