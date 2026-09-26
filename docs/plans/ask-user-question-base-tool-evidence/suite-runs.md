# coding-agent suite runs

Each run used `failing-tests.mjs run <worktree> packages/coding-agent <out.json>`. The final commits were compared with base-1 by `failing-tests.mjs diff` and by `test-identities.mjs` (T2 with `removed-t2.txt`). The machine load average was 26 to 47 during the later runs, from other sessions.

## Sequential runs

| Run | Tree | Tests | Failed | Failing tests |
| --- | --- | --- | --- | --- |
| base-1 | baseline `92294f229` | 3951 | 0 | none |
| base-2 | baseline | 3951 | 1 | test/agent-session-concurrent.test.ts > should throw when prompt() called while streaming |
| base-3 | baseline | 3951 | 0 | none |
| base-4 | baseline | 3951 | 0 | none |
| base-5 | baseline | 3951 | 0 | none |
| base-6 | baseline | 3951 | 0 | none |
| probe-1 | draft, gate before ownership fix | 4608 | 3 | test/agent-session-concurrent.test.ts > should wait for queued agent events before emitting tool_call<br>test/agent-session-concurrent.test.ts > should persist message_end events in order with slow extension handlers<br>test/suite/skill-c1-acceptance.test.ts > `AskUserQuestion` miss replies with the corrective redirect |
| probe-2 | draft, eager `hasUI` | 4611 | 2 | test/agent-session-concurrent.test.ts > should wait for queued agent events before emitting tool_call<br>test/agent-session-concurrent.test.ts > should persist message_end events in order with slow extension handlers |
| probe-3 | draft `b9d05e405` | 4611 | 0 | none |
| t1-2 | gated T1 `3eeb72a20` | 4617 | 0 | none |
| t2-2 | gated T2 `bc9788777` | 4613 | 0 | none |
| t1-3 | gate-free T1 `68ef2a376` | 4612 | 0 | none |
| t1-4 | gate-free T1 | 4612 | 0 | none |
| t1-5 | gate-free T1 | 4612 | 0 | none |
| t1-6 | gate-free T1 | 4612 | 0 | none |
| t2-3 | gate-free T2 `cfa28fecb` | 4608 | 1 | test/footer-data-provider.test.ts > updates the cached branch when the reftable directory changes |
| t2-4 | gate-free T2 | 4608 | 0 | none |
| t2-5 | gate-free T2 | 4608 | 1 | test/footer-data-provider.test.ts > debounces rapid reftable updates into a single async refresh |
| t2-6 | gate-free T2 | 4608 | 0 | none |
| t2-7 | gate-free T2 | 4608 | 0 | none |
| t2-8 | gate-free T2 | 4608 | 0 | none |
| t1-7 | final T1 `00166b028` | 4612 | 0 | none |
| t2-9 | final T2 `0bc75dbc4` | 4608 | 0 | none |

## Deliberately loaded runs

Two suites ran at once, or a suite ran while `footer-data-provider.test.ts` was looped on the baseline. Footer loop results on the baseline: round 1 and 2, 8 runs each; round 3, 14 runs. The cached-branch test failed in 2 of 30 loop runs; the debounce test failed in none.

| Run | Tree | Tests | Failed | Failing tests |
| --- | --- | --- | --- | --- |
| load-base-1 | baseline, in parallel with load-t2-1 | 3951 | 1 | test/footer-data-provider.test.ts > updates the cached branch when the reftable directory changes |
| load-t2-1 | gate-free T2, in parallel with load-base-1 | 4608 | 1 | test/agent-session-concurrent.test.ts > should allow followUp() while streaming |
| load-base-2 | baseline, in parallel with load-t2-2 | 3951 | 1 | test/agent-session-concurrent.test.ts > should allow steer() while streaming |
| load-t2-2 | gate-free T2, in parallel with load-base-2 | 4608 | 1 | test/agent-session-concurrent.test.ts > should queue extension-origin steering messages while streaming |
| load-bg-1 | gate-free T2, under the footer loop round 1 | 4608 | 0 | none |
| load-bg-2 | gate-free T2, under the footer loop round 2 | 4608 | 1 | test/agent-session-concurrent.test.ts > should allow steer() while streaming |
| load-bg-3 | gate-free T2, under the footer loop round 3 | 4608 | 2 | test/agent-session-concurrent.test.ts > should throw when prompt() called while streaming<br>test/agent-session-concurrent.test.ts > should allow followUp() while streaming |
| load-bg-4 | baseline, under the footer loop round 3 | 3951 | 2 | test/agent-session-concurrent.test.ts > should throw when prompt() called while streaming<br>test/agent-session-concurrent.test.ts > should allow steer() while streaming |
