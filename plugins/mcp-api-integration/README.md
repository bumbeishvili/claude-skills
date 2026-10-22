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

An OAuth MCP server or personal REST token acts as the signed-in user. Text comments require authorization and use the requested wording. State changes follow the agreed ticket workflow. Source screenshots and before/after evidence are attached without a routine progress comment.

## Ticket convention

Create or reuse the ticket before implementing an agreed feature or fix. Read the latest comments and attachment images, preserve the requested scope, and verify the affected views. Follow the active project's final-state rule: when Done is authorized, move to Done, mark complete, and read back both values; respect any required review stage.

Evidence uses full viewport screenshots, red rectangles and short issue/fix captions below the images. Include affected tables and other distinct views. Add phone checks for separate mobile code or layout/interaction changes; shared copy edits need one browser check. Details are in `skills/mcp-api-integration/playbook.md` §10–11.

## What's here

Rules in `skills/mcp-api-integration/SKILL.md`, recipes in `playbook.md`.

`figma-client.ts`, `figma_client.py` and `asana_client.py` are dependency-free REST clients. Run any of them with no arguments to check a token. `asana_client.py` also creates tickets, attaches images and moves a task while keeping its column in number order.

Part of [claude-skills](../../).
