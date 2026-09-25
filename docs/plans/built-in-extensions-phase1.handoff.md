# Built-in extensions, phase 1: handoff for pi-fence and OpenIntent

Phase 1 ships `rpiv-ask-user-question` as a built-in of this fork (`docs/adr/ADR-0009-built-in-extensions.md`). This note lists what the change means for pi-fence and for the OpenIntent workflow-engine design. Phase 1 edited neither repository. After phase 1, the owner approved one pi-fence change: commit `83fa852` forwards `PI_FORK_BUILTINS`. This note reflects that change. Each item names the owner action it needs, or states that none is needed. Items that no run has observed are marked unverified. The implementation contract is `docs/plans/built-in-extensions-phase1.plan.md` (tasks T8 and T9).

## pi-fence

| Item | Status | Evidence | Owner action |
| --- | --- | --- | --- |
| rpiv's code and defaults | No new grant needed. The base profile already allows reads of `~/Developer/ai/pi`, which holds `packages/builtins/`. | Report Section 3.4. | None. |
| rpiv's optional config file | Denied under the fence, so fenced sessions use rpiv's defaults. No config file exists today. | `packages/builtins/rpiv-ask-user-question/config.ts` line 102 loads `rpiv-ask-user-question` through `@juicesharp/rpiv-config`. `node_modules/@juicesharp/rpiv-config/config.ts` lines 34 to 47 read `$XDG_CONFIG_HOME`, else `~/.config`. `pi-fence/profiles/base.template.json` line 24 denies `~` and allows no `~/.config/rpiv-ask-user-question`. | Only if a config file is ever created: add `~/.config/rpiv-ask-user-question` to the base profile's read allow list. |
| rpiv's external editor | Unverified. It spawns only on user request. | `packages/builtins/rpiv-ask-user-question/state/external-editor.ts` line 19 calls `spawn`. | Check once in a fenced session, if the editor is ever used there. |
| The `rpiv-mono` read grant | Disappears automatically when T9 removes the `settings.json` entry. | `pi-fence/src/profile/loader.ts` line 99, `derivedPackageReads`. | None. |
| The doorman | Needs no change. It inspects only `bash`, `read`, `grep`, `find` and `ls`. | `pi-fence/extensions/lib/doorman.ts` line 113, `COVERED_TOOLS`. | None. |
| `PI_FORK_BUILTINS` | Done. pi-fence forwards the name to the fenced child since commit `83fa852`, and the launcher was rebuilt on 2026-09-25. Fenced sessions started with `PI_FORK_BUILTINS=off` load no built-in. Unverified end to end: no fenced session has run with the switch yet. | `pi-fence/src/profile/environment.ts` line 41, inside `ALLOWED_PI_NAMES` (line 24); `pi-fence/src/launch/env.ts` line 92. | Run one fenced session with `PI_FORK_BUILTINS=off pi --profile general`, and confirm that `ask_user_question` is absent. |

## OpenIntent amendment points

The design is `openintent/changes/workflow-engine/design.md` in the worktree `~/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine`. It changes only through its own amendment process. Report Section 5.6 names D2, D8, D14 and D16; report Section 3.4 adds D11.

| Decision | Current text | Amendment point | Evidence |
| --- | --- | --- | --- |
| D2, executable identity (`design.md` line 120) | Extension sources are inventoried and approved. Each run records the SDK identity it ran under (line 434). | Built-in code is part of the fork revision that the SDK identity records. OpenIntent never inventories or approves it as an extension source. | `packages/builtins/` sits inside the fork checkout that `packages/workflow/node_modules/@earendil-works/pi-coding-agent` links to (`design.md` line 417). |
| D8, scoped workers (`design.md` line 385) | "Discovery starts disabled; only selected extensions, skills and context sources are supplied" (line 396). | Built-ins load in every worker that links to the checkout, including under `noExtensions`. D8 must name them as SDK-provided resources, governed by the worker's tool selection. Readiness never lists them. | `packages/workflow/src/pi/worker-policy-extension.ts` line 179 publishes `extensions: policy.extensions`, not the loaded set. Phase-1 check C8 (outside consumer through a symlink) loaded both built-ins. |
| D11, operator questions (`design.md` line 569) | A model gate uses the ask-operator tool (line 407). The transport refuses stray UI dialogs. | A worker without a tool scope also exposes `ask_user_question`. In RPC mode it raises a `select` dialog, which the transport refuses and which fails the worker. Worker tool selections must exclude `ask_user_question`. `PI_FORK_BUILTINS=off` is an interim control for fenced and unfenced workers alike, but it removes every built-in. | `worker-policy-extension.ts` lines 65 to 66 and 156: absent `tools` gates nothing. `packages/workflow/src/pi/transport/rpc-child.ts` line 81 lists `select` in `UI_DIALOG_METHODS`; lines 441 to 450 fail the connection. Phase-1 check C2 observed the `select` fallback. pi-fence commit `83fa852` forwards the switch. |
| D14, studio service (`design.md` line 708) | "OpenIntent does not silently disable or reconfigure another extension" (line 726). | Built-ins load in the studio session regardless of operator setup. OpenIntent cannot exclude them, and D14 forbids it to disable another extension. The only switch is `PI_FORK_BUILTINS=off`, set by the operator at launch. It removes every built-in, in fenced and unfenced sessions alike. | `packages/coding-agent/src/core/fork-builtins.ts` in this fork; pi-fence commit `83fa852`. |
| D16, provider extensions (`design.md` line 753) | `acceptance-providers.json` roles `builtin`, `claude-bridge` and `glm-tweaks` (line 858). | Unchanged in phase 1. The `claude-bridge` role changes only when pi-claude-bridge becomes a built-in (plan Section 10, order 6). | Plan Section 10. |

OpenIntent's own vitest tests see the built-ins. Only Pi's `packages/coding-agent/vitest.config.ts` sets `PI_FORK_BUILTINS: "off"`; `packages/workflow/package.json` line 36 runs plain `vitest run`.

## Unverified items

- The external editor under the fence.
- OpenIntent worker behavior with built-ins. No phase-1 run started an OpenIntent worker.
- A fenced OpenIntent worker entry (SPIKE-0003 open item).
- A fenced session honoring `PI_FORK_BUILTINS`. pi-fence commit `83fa852` forwards the name, and its unit tests prove the forwarding. No fenced session has run with the switch yet.
