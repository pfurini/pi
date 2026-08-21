---
name: probe9
description: Probe whether CC recognizes any braced placeholder form
arguments: [issue]
---

BEGIN
s1=[${@:1}]
s2=[${@:1:2}]
s3=[${@:-def}]
s4=[${ARGUMENTS:1}]
s5=[${ARGUMENTS:-def}]
s6=[${0:-def}]
s7=[${issue:-def}]
s8=[${nope:-def}]
END

Reply with exactly: done
