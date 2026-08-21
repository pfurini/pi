---
name: probe7
description: Probe escaping and dollar-at
arguments: [issue]
---

BEGIN
p=[\$1]
q=[\$ARGUMENTS]
r=[\$issue]
s=[\$nope]
t=[\$100.00]
u=[\\$1]
v=[$@]
w=[$ARGUMENTS]
END

Reply with exactly: done
