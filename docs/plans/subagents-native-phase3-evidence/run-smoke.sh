#!/usr/bin/env bash
# Phase 3 TUI smoke (D45): drives a built Pi in a background cmux surface, with an isolated home, its own
# TMPDIR under <out dir> and the scripted faux provider of faux-smoke.ts. No credentials and no live
# configuration take part.
#
#   run-smoke.sh <coding-agent dist dir> <direct|model> <out dir>
#
# Checks, in order: a print-mode mention reaches the main model and starts no agent (D44); startup; a background Agent shows in the widget and the status line; FleetView
# opens at an empty editor and the agent's viewer opens on Enter, shown by its ` close` key hint; the `@` popup lists a startable agent; a
# mention starts `@explore` (direct: "Started @explore", model: "Prompting @explore…" and the clone's
# agent); `@main` reaches the main model; `/quit` exits 0 while agents run. Each screen is saved to
# <out dir>/<step>.txt. Prints one line per check and exits 0 when all pass, 1 otherwise, 2 on bad input.
set -u
DIST=${1:-}; MODE=${2:-}; OUT=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd)
if [[ ! -f "$DIST/cli.js" || ( "$MODE" != direct && "$MODE" != model ) || -z "$OUT" ]]; then
	echo "usage: run-smoke.sh <dist> <direct|model> <out dir>" >&2; exit 2
fi
if [[ -e "$OUT" ]]; then echo "run-smoke: $OUT exists" >&2; exit 2; fi
mkdir -p "$OUT/home/.pi/agent" "$OUT/work" "$OUT/tmp"
H="$OUT/home"; W="$OUT/work"; T="$OUT/tmp"
printf '{"forkBuiltins":{"subagents":{"agentMentions":"%s"}}}\n' "$MODE" > "$H/.pi/agent/settings.json"
NODE_DIR=$(dirname "$(command -v node)")
cat > "$OUT/launch.sh" <<LAUNCH
#!/bin/sh
cd '$W' || exit 2
env -i PATH='$NODE_DIR:/usr/bin:/bin' HOME='$H' TMPDIR='$T' PI_CODING_AGENT_DIR='$H/.pi/agent' PI_OFFLINE=1 TERM=xterm-256color node '$DIST/cli.js' -e '$HERE/faux-smoke.ts' --provider smoke --model smoke-1
echo SMOKE-EXIT \$?
sleep 60
LAUNCH
chmod +x "$OUT/launch.sh"
CMD="$OUT/launch.sh"
FAILED=0
# Over stdin: the CLI reads an argument that starts with `@` as a file to attach.
PRINT=$(cd "$W" && printf '@explore print check' | env -i PATH="$NODE_DIR:/usr/bin:/bin" HOME="$H" TMPDIR="$T" PI_CODING_AGENT_DIR="$H/.pi/agent" PI_OFFLINE=1 node "$DIST/cli.js" -p -e "$HERE/faux-smoke.ts" --provider smoke --model smoke-1 2>&1)
printf '%s\n' "$PRINT" > "$OUT/00-print.txt"
if [[ "$PRINT" == "smoke reply" ]]; then echo "pass 00-print: smoke reply"; else echo "FAIL 00-print: smoke reply"; FAILED=1; fi
SURFACE=$(cmux new-surface --type terminal --focus false --command "$CMD" | grep -o 'surface:[0-9]*' | head -1)
if [[ -z "$SURFACE" ]]; then echo "run-smoke: no surface" >&2; exit 2; fi
echo "surface $SURFACE"
screen() { cmux read-screen --surface "$SURFACE" --lines 60 2>/dev/null; }
# wait_for <step> <fixed string> <seconds>: polls the screen until it holds the string.
wait_for() {
	local step=$1 want=$2 limit=$3 i
	for ((i = 0; i < limit * 4; i++)); do
		if screen | grep -qF -- "$want"; then screen > "$OUT/$step.txt"; echo "pass $step: $want"; return 0; fi
		sleep 0.25
	done
	screen > "$OUT/$step.txt"; echo "FAIL $step: $want"; FAILED=1; return 1
}
send() { cmux send --surface "$SURFACE" "$1" > /dev/null; }
key() { cmux send-key --surface "$SURFACE" "$1" > /dev/null; }

wait_for 01-start "smoke-1" 20
send "spawn one\n"
wait_for 02-widget "smoke background" 15
wait_for 03-status "1 running agent" 5
# The first Down opens FleetView on `main`; the second selects the agent, and Enter opens its viewer.
key down
wait_for 04-fleet "Enter view" 5
key down
sleep 0.5
key enter
wait_for 05-viewer " close" 5
# One Escape closes the viewer; another closes FleetView. A third at an empty editor opens the tree.
for _ in 1 2; do
	screen | grep -qE ' close|Enter view|Esc back' || break
	key escape; sleep 0.5
done
sleep 5
send "@ex"
wait_for 06-popup "start agent" 5
key backspace; key backspace; key backspace
if [[ "$MODE" == direct ]]; then
	send "@explore smoke direct task\n"
	wait_for 07-mention "Started @explore" 10
else
	send "@explore smoke model task\n"
	wait_for 07-mention "Prompting @explore" 10
	wait_for 08-clone "smoke clone" 10
fi
send "@main plain question\n"
wait_for 09-main "smoke reply" 10
send "spawn two\n"
wait_for 10-running "running" 10
send "/quit\n"
wait_for 11-quit "SMOKE-EXIT 0" 15
cmux close-surface --surface "$SURFACE" > /dev/null 2>&1
exit $FAILED
