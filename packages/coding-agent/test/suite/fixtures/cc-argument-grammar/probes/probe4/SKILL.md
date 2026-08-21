---
name: probe4
description: Probe declared-name collisions with ARGUMENTS and digits
arguments: [issue, ARGUMENTS, "1", branch]
---

BEGIN
raw=[$ARGUMENTS]
one=[$1]
zero=[$0]
issue=[$issue]
branch=[$branch]
nope=[$nope]
END

Reply with exactly: done
