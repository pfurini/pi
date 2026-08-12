---
name: all-fields
description: Comprehensive committed fixture exercising every A.2 field at once.
license: MIT
compatibility: Pi
metadata:
  owner: core
when_to_use: Use for the all-fields conformance round-trip.
argument-hint: "[path]"
arguments: [path]
allowed-tools: [read]
disallowed-tools: bash
disallowedTools: [write]
model: inherit
effort: high
context: inline
agent: general-purpose
background: false
paths: ["src/**"]
shell: bash
hooks:
  PreToolUse: echo ignored
unknown-scalar: value
unknown-list: [one, two]
unknown-map:
  nested: true
---
Inert filler body.
