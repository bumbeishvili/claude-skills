# mcp-api-integration

Working rules for Figma and Asana, over both MCP and REST.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/mcp-api-integration/skills/mcp-api-integration .claude/skills/mcp-api-integration
mkdir -p .agents/skills && ln -sfn ../../.claude/skills/mcp-api-integration .agents/skills/mcp-api-integration
```

Needs `npx`. The first line installs the skill for Claude Code, the second links it for Codex. Invoke with `/mcp-api-integration` in Claude Code or `$mcp-api-integration` in Codex, or mention a Figma design or an Asana task.

The REST clients read tokens from the environment:

```bash
export FIGMA_TOKEN=<personal access token>
export ASANA_TOKEN=<personal access token>   # fallback for when MCP OAuth can't run
```

## The rule it exists for

An OAuth MCP server, or a personal REST token, acts as the signed-in user. Comments and messages are attributed to them and read as though they wrote them, so those stay off-limits. Assignment changes, section moves and custom-field edits are fine, because they change state instead of speaking. Images are the one exception: a ticket's source screenshot and its before/after evidence go up as attachments with no text.

## Ticket convention

Features, issues and client feedback all go through the board the same way. Each item becomes a numbered ticket (`NN · Title`) with a screenshot of the source and the item boxed in red. It moves ToDo → In Progress → Dev Testing, and is verified on desktop and phone before Dev Testing. It closes with one before/after image and no comment text. The agent stops at Dev Testing; To Be Deployed and Done belong to the reviewer. Details are in `playbook.md` §10–11.

## What's here

Rules in `skills/mcp-api-integration/SKILL.md`, recipes in `playbook.md`.

`figma-client.ts`, `figma_client.py` and `asana_client.py` are dependency-free REST clients. Run any of them with no arguments to check a token. `asana_client.py` also creates tickets, attaches images and moves a task while keeping its column in number order.

Part of [claude-skills](../../).
