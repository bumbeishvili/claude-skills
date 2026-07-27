# mcp-api-integration

Working rules for Figma and Asana, over both MCP and REST.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/mcp-api-integration/skills/mcp-api-integration .claude/skills/mcp-api-integration
```

Needs `npx`. Invoke with `/mcp-api-integration`, or mention a Figma design or an Asana task.

The REST clients read tokens from the environment:

```bash
export FIGMA_TOKEN=<personal access token>
export ASANA_TOKEN=<personal access token>   # fallback for when MCP OAuth can't run
```

## The rule it exists for

An OAuth MCP server, or a personal REST token, acts as the signed-in user. Comments and messages are attributed to them and read as though they wrote them, so those stay off-limits. Assignment changes, section moves and custom-field edits are fine, because they change state instead of speaking.

## What's here

Rules in `skills/mcp-api-integration/SKILL.md`, recipes in `playbook.md`.

`figma-client.ts`, `figma_client.py` and `asana_client.py` are dependency-free REST clients. Run any of them with no arguments to check a token.

Part of [claude-skills](../../).
