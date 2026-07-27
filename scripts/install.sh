#!/usr/bin/env bash
# Install the claude-skills setup into the current project, straight from GitHub.
#
#   curl -fsSL https://raw.githubusercontent.com/bumbeishvili/claude-skills/main/scripts/install.sh | bash
#
# Writes .claude/skills/<skill> for every skill, plus .claude/CLAUDE.md,
# .claude/ABOUT.md and .claude/settings.local.json, into the directory you run it from.
#
# Anything already there is kept. FORCE=1 replaces it, moving the old copy to
# <name>.bak-<timestamp> first.

set -euo pipefail

REPO="${REPO:-bumbeishvili/claude-skills}"
BRANCH="${BRANCH:-main}"
RAW="${RAW:-https://raw.githubusercontent.com/$REPO/$BRANCH}"
SKILLS="ai-deslop d3-charts light-cms mcp-api-integration playwright-repro"
FORCE="${FORCE:-0}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Bounded and retried, so a transient blip does not abort the run and a stalled
# connection cannot hang forever. The preflight uses tighter limits because it runs
# three times before any work starts.
CURL=(curl -fsSL --connect-timeout 10 --max-time 60 --retry 2 --retry-delay 2)
CURL_CHECK=(curl -fsSL --connect-timeout 5 --max-time 10 --retry 1 --retry-delay 1)

command -v npx  >/dev/null || { echo "npx is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

CFG_NAME=(CLAUDE.md ABOUT.md settings.local.json)
CFG_URL=("$RAW/.claude/CLAUDE.md" "$RAW/.claude/ABOUT.md" "$RAW/templates/settings.local.json")
CFG_DEST=(.claude/CLAUDE.md .claude/ABOUT.md .claude/settings.local.json)

# Check every remote file resolves before writing anything, so a missing one cannot
# leave a half-installed .claude behind.
echo "checking $REPO@$BRANCH"
missing=""
for i in "${!CFG_URL[@]}"; do
  "${CURL_CHECK[@]}" -o /dev/null "${CFG_URL[$i]}" </dev/null 2>/dev/null \
    || missing="$missing  ${CFG_URL[$i]}"$'\n'
done
if [ -n "$missing" ]; then
  echo "not reachable:" >&2
  printf '%s' "$missing" >&2
  echo "nothing was written. re-run to retry — this is often a transient network error." >&2
  exit 1
fi

# 0 = go ahead and write, 1 = leave the target alone.
can_write() {
  local path="$1" label="$2"
  [ -e "$path" ] || return 0
  if [ "$FORCE" != "1" ]; then
    printf '  %-22s kept (exists; FORCE=1 to replace)\n' "$label"
    return 1
  fi
  mv "$path" "$path.bak-$STAMP"
  printf '  %-22s backed up to %s.bak-%s\n' "$label" "$(basename "$path")" "$STAMP"
}

mkdir -p .claude/skills

echo "skills (first run downloads degit, this takes a moment)"
for s in $SKILLS; do
  can_write ".claude/skills/$s" "$s" || continue
  printf '  %-22s ' "$s"
  # </dev/null so npx cannot read the script off this pipe when run as curl | bash.
  npx --yes degit "$REPO/plugins/$s/skills/$s#$BRANCH" ".claude/skills/$s" </dev/null >/dev/null 2>&1 \
    && echo "ok" || { echo "failed"; exit 1; }
done

echo "config"
for i in "${!CFG_URL[@]}"; do
  can_write "${CFG_DEST[$i]}" "${CFG_NAME[$i]}" || continue
  printf '  %-22s ' "${CFG_NAME[$i]}"
  "${CURL[@]}" -o "${CFG_DEST[$i]}" "${CFG_URL[$i]}" </dev/null && echo "ok" || { echo "failed"; exit 1; }
done

echo
echo "done -> $(pwd)/.claude"
echo "settings.local.json grants Bash(*) under acceptEdits — edit it if that is too broad."
