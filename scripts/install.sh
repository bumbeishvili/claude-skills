#!/usr/bin/env bash
# Install the claude-skills setup into the current project, straight from GitHub.
#
#   curl -fsSL https://raw.githubusercontent.com/bumbeishvili/claude-skills/main/scripts/install.sh | bash
#
# Writes .claude/skills/<skill> for every skill, plus .claude/CLAUDE.md and
# .claude/settings.local.json, into the directory you run it from.
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

command -v npx >/dev/null || { echo "npx is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

# Check every remote file resolves before writing anything, so a missing one
# cannot leave a half-installed .claude behind.
missing=""
for u in "$RAW/.claude/CLAUDE.md" "$RAW/.claude/ABOUT.md" "$RAW/templates/settings.local.json"; do
  curl -fsIL -o /dev/null "$u" 2>/dev/null || missing="$missing  $u"
done
if [ -n "$missing" ]; then
  echo "these are not reachable on $REPO@$BRANCH:" >&2
  printf '%s\n' "$missing" >&2
  echo "nothing was written." >&2
  exit 1
fi

# 0 = go ahead and write, 1 = leave the target alone.
can_write() {
  local path="$1" label="$2"
  [ -e "$path" ] || return 0
  if [ "$FORCE" != "1" ]; then
    printf '  kept     %-24s exists; FORCE=1 to replace\n' "$label"
    return 1
  fi
  mv "$path" "$path.bak-$STAMP"
  printf '  backup   %-24s -> %s.bak-%s\n' "$label" "$(basename "$path")" "$STAMP"
}

mkdir -p .claude/skills

echo "skills"
for s in $SKILLS; do
  can_write ".claude/skills/$s" "$s" || continue
  npx --yes degit "$REPO/plugins/$s/skills/$s#$BRANCH" ".claude/skills/$s" >/dev/null
  printf '  added    %s\n' "$s"
done

echo "config"
fetch() {
  local url="$1" dest="$2" label="$3"
  can_write "$dest" "$label" || return 0
  curl -fsSL "$url" -o "$dest"
  printf '  added    %s\n' "$label"
}
fetch "$RAW/.claude/CLAUDE.md"                .claude/CLAUDE.md           CLAUDE.md
fetch "$RAW/.claude/ABOUT.md"                 .claude/ABOUT.md            ABOUT.md
fetch "$RAW/templates/settings.local.json"    .claude/settings.local.json settings.local.json

echo
echo "done -> $(pwd)/.claude"
echo "settings.local.json grants Bash(*) under acceptEdits — edit it if that is too broad."
