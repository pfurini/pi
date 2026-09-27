import subprocess, sys, os
root = "/tmp/subagents-native-probe/packages/coding-agent"
svc = "src/core/fork-builtins/subagents/service.ts"
bt = "src/core/fork-builtins/base-tools.ts"
ad = "src/core/fork-builtins/subagents/adapter.ts"
vitest = "/tmp/subagents-native-probe/node_modules/vitest/dist/cli.js"
files = ["test/suite/fork-subagents-probe.test.ts", "test/fork-builtins/base-tools.test.ts"]
mutations = [
    ("M1 child gets no excludeTools", svc, "excludeTools: request.excludeTools,", "excludeTools: [],"),
    ("M2 inline built-ins kept", svc, "extensionsOverride: dropInlineBuiltIns,", ""),
    ("M3 no per-session reuse", svc, "let service = services.get(session);", "let service: SubagentService | undefined;"),
    ("M4 cleanup hook ignored", svc, "if (sessionId === parentId) this.dispose();", "void sessionId;"),
    ("M6 no ping handler", ad, 'bus.emit(`subagents:rpc:ping:reply:${requestId}`, {', 'void bus; void ({'),
    ("M7 adapter never leaves the bus", ad, "\t\t\tunsubscribePing();\n", ""),
    ("M8 no ready announcement", ad, 'bus.emit("subagents:ready", {});', ""),
    ("M9 adapter not installed", bt, "if (options.eventBus) installSubagentAdapter(options.session, options.eventBus);", ""),
    ("M5 service built at registration", bt, "\taddOwned(definitions, AGENT_TOOL_NAME, () =>", "\tsubagentServiceFor(options.session, options.agentDir);\n\taddOwned(definitions, AGENT_TOOL_NAME, () =>"),
]
for name, path, old, new in mutations:
    full = os.path.join(root, path)
    orig = open(full).read()
    assert orig.count(old) == 1, name
    open(full, "w").write(orig.replace(old, new))
    try:
        out = subprocess.run(["node", vitest, "--run", *files], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout
    finally:
        open(full, "w").write(orig)
    failed = [l.strip() for l in out.splitlines() if l.strip().startswith("FAIL") or " ✗ " in l or l.strip().startswith("×")]
    summary = [l.strip() for l in out.splitlines() if "Tests " in l]
    print(name, "|", summary[-1] if summary else "no summary")
    for l in failed:
        print("   ", l)
out = subprocess.run(["node", vitest, "--run", *files], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout
print("restored |", [l.strip() for l in out.splitlines() if "Tests " in l][-1])
