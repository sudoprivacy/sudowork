#!/usr/bin/env bash
# Start a ruigu build: tag the current origin/ruigu head as ruigu-<version>-<n>
# and push the tag, which runs .github/workflows/build-ruigu.yml (draft release,
# never published to the official update channels).
#
# Usage: scripts/release-ruigu.sh [--dry-run]
set -euo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

git fetch --quiet origin ruigu --tags
SHA="$(git rev-parse origin/ruigu)"
VERSION="$(git show "origin/ruigu:package.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"

existing="$(git tag --points-at "$SHA" --list 'ruigu-*' | head -1)"
if [ -n "$existing" ]; then
  echo "origin/ruigu ($SHA) is already tagged as $existing; nothing to do."
  echo "Re-run that build from the Actions tab if needed."
  exit 0
fi

# Next build number for this version: ruigu-0.2.17-1, ruigu-0.2.17-2, ...
last="$(git tag --list "ruigu-${VERSION}-*" | sed -E "s/^ruigu-${VERSION//./\\.}-//" | grep -E '^[0-9]+$' | sort -n | tail -1 || true)"
TAG="ruigu-${VERSION}-$(( ${last:-0} + 1 ))"

echo "Tag:     $TAG"
echo "Commit:  $SHA ($(git log -1 --format=%s "$SHA"))"
if $DRY_RUN; then
  echo "(dry run, nothing pushed)"
  exit 0
fi

git tag -a "$TAG" "$SHA" -m "Ruigu build $TAG"
git push origin "refs/tags/$TAG"
echo "Pushed $TAG. Build: https://github.com/sudoprivacy/sudowork/actions/workflows/build-ruigu.yml"
