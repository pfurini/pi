#!/usr/bin/env bash
# Fork-owned: the guarded scratch-merge sync for packages under packages/builtins/.
# Proven in SPIKE-0004 (openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md);
# ADR-0009 and .pi/skills/sync-upstream/SKILL.md govern its use. Change its behavior only
# through a new spike or an owner ruling recorded in ADR-0009, followed by a replay of the
# SPIKE-0004 cases. The 2026-09-26 ruling added the failure checks below.
# Usage: sync-upstream.sh <pi worktree> <package directory, relative> <new upstream commit>
#
# Steps, in the frozen order:
#   (1) read repository, path and base from <dir>/UPSTREAM.json;
#   (2) refuse unless the latest commit touching UPSTREAM.json carries Upstream-Base: <base>;
#   (3) refuse when the package directory has uncommitted changes (ignored files excluded);
#   (4) refuse when <base> is not an ancestor of <new> in the upstream clone;
#   (5) refuse when the upstream path is not a directory at <base> or <new>; report up to date
#       when the upstream subtree is unchanged, rewriting only the base value;
#   (6) otherwise merge base, ours (HEAD) and theirs in a scratch repository, copy the result
#       back, write the new base and stage the directory with `git add -A -f`.
# A failed command in (6) refuses (exit 2). Before the package directory is cleared, the
# refusal prints no `scratch:` line and the package is unchanged. After it, the refusal
# prints the `scratch:` line and the caller restores the package from HEAD.
# Exit codes: 0 clean merge, 1 merge with conflicts, 2 refusal, 3 up to date.
# It never commits and never fetches.
set -u
pi=$1
dir=$2
new=$3
record="$pi/$dir/UPSTREAM.json"

refuse() {
	echo "SYNC OUTCOME: refused ($1)"
	exit 2
}

# (1)
read_field() {
	node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).upstream;process.stdout.write(String(r[process.argv[2]]??""))' "$record" "$1"
}
repo=$(read_field repository) || refuse "record unreadable"
path=$(read_field path)
base=$(read_field base)
echo "record: repository=$repo path=${path:-<root>} base=$base new=$new"

# (2)
trailer=$(git -C "$pi" log -1 --format='%(trailers:key=Upstream-Base,valueonly)' -- "$dir/UPSTREAM.json" | tr -d '[:space:]')
if ! [[ "$base" =~ ^[0-9a-f]{40}$ ]] || [ "$trailer" != "$base" ]; then
	refuse "record: the latest commit of UPSTREAM.json carries Upstream-Base '${trailer:-none}', not '$base'"
fi

# (3)
if [ -n "$(git -C "$pi" status --porcelain -- "$dir")" ]; then
	refuse "uncommitted changes in $dir"
fi

# (4)
git -C "$repo" merge-base --is-ancestor "$base" "$new" 2>/dev/null
ancestry=$?
if [ "$ancestry" -ne 0 ]; then
	refuse "ancestry: $base is not an ancestor of $new in $repo (exit $ancestry)"
fi

treeish() { if [ -n "$path" ]; then echo "$1:$path"; else echo "$1^{tree}"; fi; }
subtree() { # prints the tree id of the upstream path at <commit>; fails when it is not a directory
	local id
	id=$(git -C "$repo" rev-parse -q --verify "$(treeish "$1")") || return 1
	[ "$(git -C "$repo" cat-file -t "$id")" = tree ] || return 1
	echo "$id"
}
write_base() {
	node -e 'const fs=require("fs");const p=process.argv[1];const s=fs.readFileSync(p,"utf8");const t=s.replace(/("base":\s*")[0-9a-fA-F]*(")/,"$1"+process.argv[2]+"$2");if(t===s&&!s.includes(process.argv[2]))throw new Error("base not found");fs.writeFileSync(p,t)' "$record" "$1"
}

# (5)
base_tree=$(subtree "$base") || refuse "path: '${path:-<root>}' is not a directory at $base in $repo"
new_tree=$(subtree "$new") || refuse "path: '${path:-<root>}' is not a directory at $new in $repo"
if [ "$base_tree" = "$new_tree" ]; then
	write_base "$(git -C "$repo" rev-parse "$new")" || refuse "writing the base to $record failed"
	echo "SYNC OUTCOME: up to date"
	exit 3
fi

# (6)
extract() { # <repo> <tree-ish> <outdir>; fails when the tree cannot be read or written out
	local idx status=0
	idx=$(mktemp /tmp/spike-0004-idx.XXXXXX) || return 1
	rm -f "$idx"
	mkdir -p "$3" || return 1
	GIT_INDEX_FILE="$idx" git -C "$1" read-tree "$2" &&
		GIT_INDEX_FILE="$idx" git -C "$1" checkout-index -a -f --prefix="$3/" || status=1
	rm -f "$idx"
	return "$status"
}
scratch=$(mktemp -d /tmp/spike-0004-scratch.XXXXXX) || refuse "creating the scratch directory failed"
# Before the package directory is replaced, a failure leaves the package unchanged.
setup_failed() { refuse "scratch setup: $1 failed, the package is unchanged (scratch directory $scratch)"; }
G=(git -C "$scratch" -c user.name=sync -c user.email=sync@local -c commit.gpgsign=false -c core.hooksPath=/dev/null)
git init -q -b ours "$scratch" || setup_failed "git init"
clear_tree() { find "$scratch" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +; }
extract "$repo" "$(treeish "$base")" "$scratch" || setup_failed "extracting the base tree"
{ "${G[@]}" add -A && "${G[@]}" commit -q --allow-empty -m base; } || setup_failed "committing the base tree"
"${G[@]}" branch -q theirs || setup_failed "creating the theirs branch"
clear_tree || setup_failed "clearing the scratch tree"
extract "$pi" "HEAD:$dir" "$scratch" || setup_failed "extracting the package at HEAD"
{ "${G[@]}" add -A && "${G[@]}" commit -q --allow-empty -m ours; } || setup_failed "committing the package at HEAD"
"${G[@]}" switch -q theirs || setup_failed "switching to theirs"
clear_tree || setup_failed "clearing the scratch tree"
extract "$repo" "$(treeish "$new")" "$scratch" || setup_failed "extracting the new tree"
{ "${G[@]}" add -A && "${G[@]}" commit -q --allow-empty -m theirs; } || setup_failed "committing the new tree"
"${G[@]}" switch -q ours || setup_failed "switching to ours"
"${G[@]}" merge --no-edit theirs >"$scratch.merge.log" 2>&1
merge_exit=$?
conflicted=$("${G[@]}" diff --name-only --diff-filter=U) || setup_failed "listing the conflicted files"
# After this point a failure leaves the package partly replaced; the caller restores it from HEAD.
changed_failed() {
	echo "scratch: $scratch (merge exit $merge_exit)"
	refuse "$1 failed after the package directory was cleared; restore it from HEAD"
}
find "$pi/$dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} + || changed_failed "clearing $dir"
(cd "$scratch" && tar -cf - --exclude=./.git .) | (cd "$pi/$dir" && tar -xf -)
copy_status=("${PIPESTATUS[@]}")
[ "${copy_status[0]}" -eq 0 ] && [ "${copy_status[1]}" -eq 0 ] || changed_failed "copying the merge result"
write_base "$(git -C "$repo" rev-parse "$new")" || changed_failed "writing the base"
git -C "$pi" add -A -f -- "$dir" || changed_failed "staging $dir"
echo "scratch: $scratch (merge exit $merge_exit)"
echo "conflicted:"
[ -n "$conflicted" ] && printf '%s\n' "$conflicted"
if [ -n "$conflicted" ]; then
	echo "SYNC OUTCOME: conflicts ($(printf '%s\n' "$conflicted" | grep -c .) files)"
	exit 1
fi
if [ "$merge_exit" -ne 0 ]; then
	echo "SYNC OUTCOME: refused (scratch merge failed without conflicts, exit $merge_exit)"
	exit 2
fi
echo "SYNC OUTCOME: clean"
exit 0
