#!/usr/bin/env sh
# Reject AI-authorship signatures in commit messages.
# Single source of truth shared by the local hook (.husky/commit-msg) and
# CI (.github/workflows/no-ai-signature.yml). See AGENTS.md.
set -eu

# Vendor names are matched only inside co-author trailers / "Generated with"
# footers, so ordinary subjects like "fix cursor position" stay allowed.
PATTERN='co-authored-by:[[:space:]].*(claude|anthropic|openai|chatgpt|gpt-|copilot|codeium|cursor|gemini|llama)|noreply@anthropic\.com|generated with[[:space:]]+\[?(claude|chatgpt|copilot|cursor)|🤖[[:space:]]*generated'

check_text() {
  label="$1"
  hits=$(grep -iEn "$PATTERN" || true)
  if [ -n "$hits" ]; then
    echo "❌ AI authorship signature in $label:"
    echo "$hits" | sed 's/^/     /'
    return 1
  fi
  return 0
}

rc=0
case "${1:-}" in
  --message-file)
    file="${2:?usage: --message-file <path>}"
    check_text "commit message" <"$file" || rc=1
    ;;
  --range)
    range="${2:?usage: --range <base>..<head>}"
    for sha in $(git rev-list "$range"); do
      git log -1 --format='%B' "$sha" | check_text "$(git log -1 --format='%h %s' "$sha")" || rc=1
    done
    ;;
  *)
    echo "usage: $0 --message-file <path> | --range <base>..<head>" >&2
    exit 2
    ;;
esac

if [ "$rc" -ne 0 ]; then
  echo ""
  echo "Per AGENTS.md: never add 'Co-Authored-By', 'Generated with', or any AI"
  echo "attribution to commits. Remove the offending line(s) and commit again."
  exit 1
fi

echo "✅ No AI signatures found"
