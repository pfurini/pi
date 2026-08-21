---
name: hooks
description: hooks parsed and preserved but never executed.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: echo pre-tool-use
  PostToolUse:
    - matcher: "*"
      hooks:
        - type: command
          command: echo post-tool-use
---
Inert filler body.
