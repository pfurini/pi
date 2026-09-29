#!/usr/bin/env bash
# Phase 4 smoke (D45's pattern): drives a built Pi in a background cmux surface, with an isolated home,
# its own TMPDIR under <out dir> and the scripted faux provider of faux-tasks.ts. No credentials and no
# live configuration take part.
#
#   run-smoke.sh <coding-agent dist dir> <out dir>
#
# Checks, in order: a print-mode run creates and executes a task and saves the session's task file; the
# native TaskStop rejects pi-tasks' old `shell_id`; startup; TaskCreate and TaskExecute show the task in
# progress in the `tasks` widget with its agent; the agent's end completes the task; TaskOutput hands
# over the agent's result, which step 05-result finds on TaskOutput's own line; `/tasks` opens its menu and its settings list; `/quit` exits 0. Each screen is
# saved to <out dir>/<step>.txt. Prints one line per check and exits 0 when all pass, 1 otherwise, 2 on
# bad input.
set -u
DIST=${1:-}; OUT=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
if [[ ! -f "$DIST/cli.js" || -z "$OUT" ]]; then
	echo "usage: run-smoke.sh <dist> <out dir>" >&2; exit 2
fi
if [[ -e "$OUT" ]]; then echo "run-smoke: $OUT exists" >&2; exit 2; fi
mkdir -p "$OUT/home/.pi/agent" "$OUT/work" "$OUT/print" "$OUT/tmp"
H="$OUT/home"; W="$OUT/work"; T="$OUT/tmp"
NODE_DIR=$(dirname "$(command -v node)")
FAILED=0
pi_print() {
	(cd "$OUT/print" && env -i PATH="$NODE_DIR:/usr/bin:/bin" HOME="$H" TMPDIR="$T" PI_CODING_AGENT_DIR="$H/.pi/agent" PI_OFFLINE=1 node "$DIST/cli.js" -p "$1" -e "$HERE/faux-tasks.ts" --provider smoke --model smoke-1 2>&1)
}
PRINT=$(pi_print "plan work")
printf '%s\n' "$PRINT" > "$OUT/00-print.txt"
if [[ "$PRINT" == "executed: Launched 1 agent(s):"* ]] && grep -qF '"subject": "smoke task one"' "$OUT"/print/.pi/tasks/tasks-*.json 2>/dev/null; then
	echo "pass 00-print: task file saved"
else
	echo "FAIL 00-print: task file saved"; FAILED=1
fi
SHELL_ID=$(pi_print "stopshell now")
printf '%s\n' "$SHELL_ID" > "$OUT/00-shell-id.txt"
if [[ "$SHELL_ID" == *'Validation failed for tool "TaskStop"'* ]]; then echo "pass 00-shell-id: rejected"; else echo "FAIL 00-shell-id: rejected"; FAILED=1; fi
cat > "$OUT/launch.sh" <<LAUNCH
#!/bin/sh
cd '$W' || exit 2
env -i PATH='$NODE_DIR:/usr/bin:/bin' HOME='$H' TMPDIR='$T' PI_CODING_AGENT_DIR='$H/.pi/agent' PI_OFFLINE=1 TERM=xterm-256color node '$DIST/cli.js' -e '$HERE/faux-tasks.ts' --provider smoke --model smoke-1
echo SMOKE-EXIT \$?
sleep 60
LAUNCH
chmod +x "$OUT/launch.sh"
SURFACE=$(cmux new-surface --type terminal --focus false --command "$OUT/launch.sh" | grep -o 'surface:[0-9]*' | head -1)
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

# Pi's own startup line: the out dir or the launch command could hold any model name.
wait_for 01-start "escape interrupt" 20
send "plan work\n"
wait_for 02-widget "1 tasks (1 in progress)" 15
wait_for 03-agent "smoke task one (agent " 5
wait_for 04-done "1 tasks (1 done)" 15
send "check it\n"
wait_for 05-output "checked: Task #1 [completed]: subagent" 15
# The agent's result follows on the same line; the completion notice shows it on a line of its own.
wait_for 05-result " | smoke child done" 5
send "/tasks\n"
wait_for 06-menu "View all tasks (1)" 5
# View, Create, Clear completed, Clear all, then Settings.
for _ in 1 2 3 4; do key down; sleep 0.2; done
key enter
wait_for 07-settings "Task Settings" 5
key escape; sleep 0.5
key escape; sleep 0.5
send "/quit\n"
wait_for 08-quit "SMOKE-EXIT 0" 15
cmux close-surface --surface "$SURFACE" > /dev/null 2>&1
exit $FAILED
