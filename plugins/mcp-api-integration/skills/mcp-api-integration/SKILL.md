---
name: mcp-api-integration
description: Figma and Asana connection/API mechanics under the project's AGENTS.md workflow. Covers design evidence, ticket creation, authorized comments, board moves and completion, image attachments, OAuth checks and REST fallbacks. Use when reading designs, working Asana tickets, connecting either service or diagnosing empty responses.
---
# MCP & API integration

Use the active project's `AGENTS.md` for scope, content ownership, ticket lifecycle and verification requirements. Explicit user instructions take precedence. This skill supplies the connection and API mechanics; installing it alone does not establish a project's final ticket state.

- **[`playbook.md`](playbook.md)** — mechanics: server config, endpoint tables, tool behaviours, rate limits, Asana REST, board lifecycle.
- **[`figma-client.ts`](figma-client.ts)** / **[`figma_client.py`](figma_client.py)** / **[`asana_client.py`](asana_client.py)** — dependency-free REST clients.

## The identity rule

**Every connection here acts as the signed-in user.** True of an OAuth MCP server and of a personal REST token, so it holds whichever way you reach Asana.

- **Report blockers in chat.** Post comments only when authorized, using the requested wording. This applies to MCP and REST alike.
- **Use image attachments for routine evidence.** Attach source screenshots and before/after images without an accompanying progress comment (playbook §11).
- **Change state within the authorized workflow.** Follow AGENTS.md and any instruction to leave ticket state alone; a code-only rollback does not authorize Asana changes.
- If a comment goes out by mistake, delete it rather than leaving it under their name (playbook §6).

Apply this to any OAuth server you connect later.

## Choosing the interface

- **Figma MCP** to read a design you are implementing.
- **Figma REST** for what MCP does not expose: asset exports, bulk reads across files, version history.
- **Asana MCP** for task state in an interactive session.
- **Asana REST** with a personal token when MCP OAuth cannot run — headless, cron, non-interactive. It needs no browser callback.

Which Figma tool suits which job, and how each one behaves, is playbook §5.

## Figma

- **Verify the tool namespace before calling.** The configured server name and the live tool prefix differ: Figma via claude.ai surfaces as `mcp__claude_ai_Figma__*`, not `figma-remote-mcp`. Read the tool list.
- **Convert `-` to `:` in node ids.** A URL carries `node-id=1-23`; every tool and endpoint wants `1:23`. The hyphen returns an empty node set, which reads as a missing layer.
- **Take exact values from `get_variable_defs`.** It returns the bound colors, sizes and named type styles. A hex sampled off a screenshot is a guess.
- **Read the comments and annotations.** Comments are the file's threads; annotations are dev-mode notes pinned to a node. Both carry requirements the visual alone does not.
- **Load the matching skill first** where one exists: `figma-design-to-code` before `get_design_context`, `figma-use` before `use_figma`, `figma-create-new-file` before `create_new_file`, `figma-generate-diagram` before `generate_diagram`.

## Asana

- **Move a task between board columns with `POST /sections/{gid}/addTask`.** A column is a *section*, and moving is not a task-field update. Read section gids from `GET /projects/{gid}/sections`; a guessed gid fails silently.
- **Create or reuse the ticket before implementation.** Read the latest comments and attachment images, then recheck comments before closure. Follow the confirmed board's naming, ordering and agreed due dates.
- **Follow the authorized completion workflow.** When the project or user authorizes Done after verification and evidence, move to Done and set `completed: true`; otherwise respect its review stage. Read back `completed` and `memberships.project.gid,memberships.section.gid,memberships.section.name` for the target project. Keep blocked work open; local verification does not establish deployment (playbook §10).
- **Use the project verification rules.** Load the available `playwright-repro` skill by its configured location for reproduction mechanics; project instructions determine phone checks and evidence formatting.
- **Preserve the configured development port.** If an OAuth callback conflicts with the running server, prefer an available REST connection.
- Marker.io tickets carry a reproduction URL and a screenshot attachment; the retrieval path is playbook §9.

## Before you rely on a result

- **Prove the connection returns real data.** An empty first call means either no matching records or a dead session. Establish which before reporting either.
- **Re-authenticate when something that worked returns nothing.** An expired session surfaces as empty results or a generic failure rather than as an auth error.
- **Check for a live session before unattended work.** Re-auth returns a URL a human opens in a browser, so a headless or cron run cannot complete it and should fail loudly instead of retrying.
- **Confirm a value that matters against a second source** — the REST API, or the design open in the app.

## Practices

- **Read credentials from the environment**: `FIGMA_TOKEN`, `ASANA_TOKEN`.
- **Match the header to the token type** — `X-Figma-Token` for a personal access token, `Authorization: Bearer` for OAuth. Crossing them returns 403 and reads like a file-permission problem.
- **Ask for the smallest response.** `depth` and an explicit `ids` list keep a design file from arriving whole.
- **Cap 429 backoff.** Figma has returned `Retry-After` values large enough to stall a script for days; cap the wait and surface the limit (playbook §4).
- **Record the `fileKey` and node id you read** so the next person opens exactly what you saw.
