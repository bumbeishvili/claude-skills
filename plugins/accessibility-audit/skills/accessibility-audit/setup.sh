#!/usr/bin/env bash
# Sets up what the accessibility-audit skill needs on this machine: the pinned npm packages in package.json and
# Playwright's Chromium, Firefox and WebKit, in one workspace shared by every project:
# A11Y_AUDIT_HOME, default ~/.cache/accessibility-audit.
#
#   bash setup.sh --check   report what is missing, change nothing; exits 1 if a required part is missing
#   bash setup.sh           install what is missing (re-running is safe: finished steps are skipped)
#
# Optional parts are reported but never installed here: pdfinfo (linked-PDF checks), macOS `say` and `afinfo`
# (spoken walkthroughs), and VoiceOver automation (the real VoiceOver pass), which needs the person's own approval.
set -euo pipefail

HOME_DIR="${A11Y_AUDIT_HOME:-$HOME/.cache/accessibility-audit}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-install}"
missing=0

say_line() { printf '%-10s %s\n' "$1" "$2"; }
need() { say_line "MISSING" "$1"; missing=1; }
optional() { say_line "optional" "$1"; }

node_ok() { command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; }

# Every package pinned in the skill's package.json resolves from the workspace at that version.
packages_ok() {
	[ -f "$HOME_DIR/package.json" ] || return 1
	# Read node_modules/<name>/package.json directly: some packages (@axe-core/playwright) do not export it.
	(cd "$HOME_DIR" 2>/dev/null && node -e '
		const path = require("path");
		const want = require(process.argv[1]).dependencies;
		for (const [name, version] of Object.entries(want)) {
			const installed = require(path.join(process.cwd(), "node_modules", name, "package.json")).version;
			if (installed !== version) { console.error(name + " is " + installed + ", want " + version); process.exit(1); }
		}' "$HERE/package.json" >/dev/null 2>&1)
}

# Each Playwright browser the skill drives has its executable on disk.
browsers_ok() {
	(cd "$HOME_DIR" 2>/dev/null && node -e '
		const fs = require("fs");
		const pw = require("playwright");
		for (const name of ["chromium", "firefox", "webkit"]) {
			if (!fs.existsSync(pw[name].executablePath())) { console.error(name); process.exit(1); }
		}' >/dev/null 2>&1)
}

# ffmpeg-static runs and can encode H.264; polled, because a broken binary can hang instead of failing.
ffmpeg_ok() {
	local bin tmp pid i ok=1
	bin="$(cd "$HOME_DIR" 2>/dev/null && node -e 'process.stdout.write(require("ffmpeg-static") || "")' 2>/dev/null || true)"
	[ -n "$bin" ] && [ -x "$bin" ] || return 1
	tmp="$(mktemp)"
	"$bin" -hide_banner -encoders >"$tmp" 2>/dev/null &
	pid=$!
	for i in $(seq 1 30); do
		kill -0 "$pid" 2>/dev/null || break
		sleep 0.5
	done
	if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; rm -f "$tmp"; return 1; fi
	grep -q libx264 "$tmp" && ok=0
	rm -f "$tmp"
	return "$ok"
}

# VoiceOver accepts AppleScript, and guidepup's VoiceOver settings image is installed ('install voiceover').
voiceover_automation_ok() {
	[ "$(uname -s)" = "Darwin" ] || return 1
	[ "$(defaults read com.apple.VoiceOver4/default SCREnableAppleScript 2>/dev/null || true)" = "1" ] || return 1
	[ -e /private/var/db/Accessibility/.VoiceOverAppleScriptEnabled ] || return 1
	compgen -G "$HOME/Library/Caches/guidepup/voiceover/*/*/guidepup-voiceover-preferences-macos-*.dmg" >/dev/null
}

report() {
	node_ok && say_line "ok" "node $(node -v)" || need "node 18 or later"
	packages_ok && say_line "ok" "npm packages in $HOME_DIR" || need "npm packages in $HOME_DIR (pinned in $HERE/package.json)"
	browsers_ok && say_line "ok" "Playwright Chromium, Firefox, WebKit" || need "Playwright browsers (chromium, firefox, webkit)"
	ffmpeg_ok && say_line "ok" "ffmpeg-static with libx264" || need "a working ffmpeg-static (narrated walkthrough videos)"
	command -v pdfinfo >/dev/null && say_line "ok" "pdfinfo $(pdfinfo -v 2>&1 | head -1 | awk '{print $3}')" || optional "pdfinfo, for linked-PDF checks (brew install poppler)"
	if [ "$(uname -s)" = "Darwin" ]; then
		command -v say >/dev/null && command -v afinfo >/dev/null && say_line "ok" "macOS say and afinfo (spoken walkthroughs)" || optional "macOS say and afinfo"
		voiceover_automation_ok && say_line "ok" "VoiceOver automation enabled" \
			|| optional "VoiceOver automation, for voiceover.cjs: the person runs 'npx @guidepup/setup@0.29.3 setup --macos-ignore-tcc-db' and 'npx @guidepup/setup@0.29.3 install voiceover' in their own terminal (playbook.md §6)"
	else
		optional "VoiceOver is macOS only; NVDA (Windows) and Orca (Linux) runs are described in playbook.md"
	fi
}

if [ "$MODE" = "--check" ]; then
	report
	[ "$missing" = 0 ] && echo "Ready." || echo "Install what is missing with: bash $HERE/setup.sh"
	exit "$missing"
fi

node_ok || { echo "node 18 or later is required" >&2; exit 1; }
mkdir -p "$HOME_DIR"
if ! packages_ok; then
	cp "$HERE/package.json" "$HOME_DIR/package.json"
	(cd "$HOME_DIR" && npm install --no-audit --no-fund --loglevel=error)
fi
browsers_ok || (cd "$HOME_DIR" && npx --no-install playwright install chromium firefox webkit)
missing=0
report
[ "$missing" = 0 ] && echo "Ready." || { echo "Some required parts are still missing (above)." >&2; exit 1; }
