#!/usr/bin/env bash
set -euo pipefail

# Run the actual desktop capability adapters against the pinned Sudocode release.
REPO_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$REPO_ROOT"
bun install --frozen-lockfile --ignore-scripts
cd apps/desktop
export GITHUB_ENV=$(mktemp)
trap 'rm -f "$GITHUB_ENV"' EXIT
node scripts/dev/download-acp-test-runtime.mjs
set -a
source "$GITHUB_ENV"
set +a
SUDOWORK_RUNTIME_E2E=1 RUST_LOG=info bunx vitest run \
  tests/integration/vault-signed-download.integration.test.ts \
  tests/integration/acpTunnelTransport.integration.test.ts
