---
name: probe12
description: Probe whether a declared ARGUMENTS shadows the indexed form $ARGUMENTS[N]
arguments: [issue, ARGUMENTS, branch]
---

BEGIN
raw=[$ARGUMENTS]
idx0=[$ARGUMENTS[0]]
idx1=[$ARGUMENTS[01]]
one=[$1]
issue=[$issue]
branch=[$branch]
END

Reply with exactly: done
