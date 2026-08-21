---
name: probe10
description: Probe whether substitution happens inside code spans and fenced blocks
---

BEGIN
plain=[$0]
inline=[`$0`]
inlineargs=[`$ARGUMENTS`]

```bash
fenced_zero="$0"
fenced_args="$ARGUMENTS"
fenced_at="$@"
fenced_default="${DIR:-/tmp}"
```

~~~
tilde_zero=$0
~~~
END

Reply with exactly: done
