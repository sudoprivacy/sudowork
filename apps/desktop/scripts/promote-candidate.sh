#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Expected validate, rc or promote}"
candidate_tag="${2:?Expected a nightly tag}"
target_version="${3:?Expected a stable version}"
expected_commit="${4:-}"

fail() { echo "ERROR: $*" >&2; exit 1; }
[[ "$mode" =~ ^(validate|rc|promote)$ ]] || fail 'Invalid promotion mode'
[[ "$candidate_tag" =~ ^nightly-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{7,40}$ ]] || fail 'Invalid nightly tag'
[[ "$target_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'Invalid stable version'
candidate_commit=$(git rev-parse --verify "refs/tags/${candidate_tag}^{commit}")
candidate_tree=$(git rev-parse "${candidate_commit}^{tree}")
if [[ "$mode" != validate ]]; then
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'Expected the audited commit SHA'
  [[ "$candidate_commit" == "$expected_commit" ]] || fail 'Nightly tag changed after validation'
fi

for manifest in package.json apps/desktop/package.json; do
  manifest_version=$(git show "${candidate_commit}:${manifest}" | node -e 'let value="";process.stdin.on("data", chunk => value += chunk);process.stdin.on("end", () => console.log(JSON.parse(value).version));')
  [[ "$manifest_version" == "$target_version" ]] || fail "${manifest} version differs from the requested release"
done
stable_tag="v${target_version}"
rc_tag="${stable_tag}-rc"
! git rev-parse --verify --quiet "refs/tags/${stable_tag}" >/dev/null || fail 'Stable tag already exists'

if [[ "$mode" == promote ]]; then
  # Refresh main after the human audit before comparing source trees.
  git fetch origin refs/heads/main:refs/remotes/origin/main
fi
merged_tree=$(git merge-tree --write-tree refs/remotes/origin/main "$candidate_commit") || fail 'Main conflicts with the audited candidate'
[[ "$merged_tree" == "$candidate_tree" ]] || fail 'Merging main changes the audited candidate contents'

if [[ "$mode" == validate ]]; then
  echo "$candidate_commit"
  exit 0
fi
[[ -z "$(git status --porcelain)" ]] || fail 'Promotion requires a clean checkout'

if [[ "$mode" == rc ]]; then
  ! git rev-parse --verify --quiet "refs/tags/${rc_tag}" >/dev/null || fail 'RC tag already exists'
  git tag "$rc_tag" "$candidate_commit"
  git push origin "refs/tags/${rc_tag}"
else
  rc_commit=$(git rev-parse --verify "refs/tags/${rc_tag}^{commit}")
  [[ "$rc_commit" == "$candidate_commit" ]] || fail 'RC tag differs from the audited candidate'
  git switch --detach refs/remotes/origin/main
  if git merge-base --is-ancestor HEAD "$candidate_commit"; then
    git merge --ff-only "$candidate_commit"
  else
    git merge --no-ff -m "chore(release): promote audited ${candidate_tag}" "$candidate_commit"
  fi
  [[ "$(git rev-parse HEAD^{tree})" == "$candidate_tree" ]] || fail 'Main contents differ from the audited candidate'
  git tag "$stable_tag" HEAD
  git push --atomic origin HEAD:refs/heads/main "refs/tags/${stable_tag}"
fi
