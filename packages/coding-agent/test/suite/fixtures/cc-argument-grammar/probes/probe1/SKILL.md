---
name: probe1
description: Probe indexed placeholder edge cases
---

BEGIN
a=[$ARGUMENTS[0]]
b=[$ARGUMENTS[1]]
c=[$ARGUMENTS[-1]]
d=[$ARGUMENTS[x]]
e=[$ARGUMENTS[01]]
f=[$ARGUMENTS[ 0 ]]
g=[$ARGUMENTS[99]]
h=[$ARGUMENTS[]]
END

Reply with exactly: done
