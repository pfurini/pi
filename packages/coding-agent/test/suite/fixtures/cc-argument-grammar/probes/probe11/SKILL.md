---
name: probe11
description: Probe whether CC absolutizes @path references, authored or argument-derived
---

BEGIN
authored=[@notes/local.md]
authored_dot=[@./notes/local.md]
authored_abs=[@/tmp/absolute.md]
fromargs=[$ARGUMENTS]
fromindex=[$0]
END

Reply with exactly: done
