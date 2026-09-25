#!/usr/bin/env bash
# T6: PI_FORK_BUILTINS=off end to end through the CLI bundle. The fixture arrives through -e,
# so the model resolves even with every built-in disabled.
# Usage: spike/harness/off-cli.sh <label>   (run from the worktree root)
set -u
label="${1:?label}"
bin="$PWD/packages/coding-agent/dist/bundle/cli.js"
out="$PWD/spike/runs/$label-OFF-cli.txt"
agent_dir=$(mktemp -d /tmp/pi-builtins-t6-agent.XXXXXX)
work_dir=$(mktemp -d /tmp/pi-builtins-t6-cwd.XXXXXX)
printf '{\n  "packages": []\n}\n' >"$agent_dir/settings.json"
{
	echo "label: $label"
	echo "bin: $bin"
	echo "agent dir: $agent_dir (settings.json lists no package)"
	echo "===== PI_FORK_BUILTINS=off pi --no-extensions -e fixture -p --model spike-fixture/echo"
	fixture="$PWD/packages/builtins/spike-fixture-provider/index.ts"
	(cd "$work_dir" && PI_FORK_BUILTINS=off PI_CODING_AGENT_DIR="$agent_dir" node "$bin" --no-extensions -e "$fixture" -p --model spike-fixture/echo "off check" 2>&1)
	echo "exit=$?"
} >"$out" 2>&1
cat "$out"
grep -q '^exit=0$' "$out"
