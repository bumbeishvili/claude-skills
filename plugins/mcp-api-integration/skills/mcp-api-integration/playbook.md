# MCP & API integration — playbook

Recipes for the Figma MCP server, the Figma REST API and the Asana MCP server.

The active project's `AGENTS.md` governs its workflow, content ownership, authorized writes and verification. These recipes implement that workflow; explicit user instructions take precedence.

---

## 1. Server configuration

Both servers are HTTP transport with OAuth. In Claude Code, in `~/.claude.json` under the project, or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "figma-remote-mcp": { "type": "http", "url": "https://mcp.figma.com/mcp" },
    "asana": {
      "type": "http",
      "url": "https://mcp.asana.com/v2/mcp",
      "oauth": { "clientId": "<client-id>" }
    }
  }
}
```

In Codex, in `~/.codex/config.toml`, or in `.codex/config.toml` for a trusted project:

```toml
[mcp_servers.figma-remote-mcp]
url = "https://mcp.figma.com/mcp"

[mcp_servers.asana]
url = "https://mcp.asana.com/v2/mcp"

[mcp_servers.asana.oauth]
client_id = "<client-id>"
```

Then sign in to each server with `codex mcp login <name>`.

Use the callback configuration supported by the client and the provider's registered redirect URI. If authentication fails because that callback port is occupied, preserve the configured development server and prefer an available REST connection (§9). Do not assume a universal callback port.

---

## 2. Figma URLs and node ids

```
https://www.figma.com/design/<fileKey>/<fileName>?node-id=<nodeId>
```

The URL writes node ids with a hyphen; the API and the MCP tools want a colon.

```js
function parseFigmaUrl(url) {
  const u = new URL(url);
  const fileKey = u.pathname.split('/')[2];
  const raw = u.searchParams.get('node-id');
  return { fileKey, nodeId: raw ? raw.replace(/-/g, ':') : null };
}
```

`figma.com/design/abc123/Site?node-id=41-1096` gives `fileKey: 'abc123'`, `nodeId: '41:1096'`. Passing `41-1096` through returns an empty node set rather than an error, which reads as a missing layer.

---

## 3. Figma REST endpoints

Base `https://api.figma.com`. Each path below was confirmed to exist by an unauthenticated probe returning 401 or 403 while an invented path returns 404.

| Path | Use |
|---|---|
| `GET /v1/me` | Cheapest call that proves a token works |
| `GET /v1/files/:key` | Whole file; take `depth` and `ids` to trim it |
| `GET /v1/files/:key/nodes?ids=1:23` | Specific subtrees, far smaller than the file |
| `GET /v1/images/:key?ids=1:23&format=svg&scale=2` | Render nodes to images; returns URLs to fetch |
| `GET /v1/files/:key/images` | Image fills already placed in the file |
| `GET /v1/files/:key/versions` | Version history |
| `GET /v1/files/:key/comments` | Comments on the file |

Auth header depends on the token:

```
X-Figma-Token: <personal access token>
Authorization: Bearer <oauth access token>
```

A token in the wrong header returns 403, which reads as a permissions problem on the file rather than a header mistake. Check the header first.

`GET /v1/images` returns URLs rather than image bytes. Fetch those separately, and treat them as short-lived.

---

## 4. Rate limits

Figma meters by credits per minute and per day, with a different cost per endpoint, so a script that stays under a request-per-second target can still exhaust the budget on expensive calls. Figma's guidance is roughly two requests a second against file reads and three against the others; treat those as a ceiling and stay under it. OAuth-app limits apply to the whole application rather than per user, so several people running the same integration share one budget.

Deliberately do not hardcode the credit figures — they change. Read them from [Figma's rate-limit documentation](https://developers.figma.com/docs/rest-api/) when the number matters.

**Cap the backoff.** A 429 from Figma has been reported carrying a `Retry-After` in the hundreds of thousands of seconds. Honouring that literally stalls a script for days and looks like a hang:

```js
const wait = Math.min(Number(res.headers.get('retry-after') || 0) * 1000, MAX_BACKOFF_MS);
```

When the header exceeds your cap, stop and tell the user the budget is exhausted. Retrying past that point burns the next window too.

---

## 5. Which Figma interface for which job

| Job | Interface |
|---|---|
| Implement a design in code | MCP `get_design_context` |
| Understand a file's structure | MCP `get_metadata` |
| Exact tokens — hex, px, type styles | MCP `get_variable_defs` |
| Check your build against the design | MCP `get_screenshot` |
| Export assets at set scales and formats | REST `/v1/images` |
| Read many files in one pass | REST `/v1/files/:key` per file, rate-limited |
| Find what changed and when | REST `/v1/files/:key/versions` |

Load the matching skill before the MCP tools that require one: `figma-design-to-code` before `get_design_context`, `figma-use` before `use_figma`.

MCP read-tool behaviours worth knowing before you call:

- **`get_variable_defs`** returns a node's bound design tokens — colors, font sizes, line heights, named styles. Pull it before hardcoding any value; it beats reading a hex off a screenshot.
- **`get_screenshot` returns a short-lived asset URL and a curl command, not image bytes.** Download with curl to keep the response small; pass `enableBase64Response: true` only when you can't fetch. The URL is signed and expires — treat it like a secret.
- **`get_metadata` with no `nodeId` lists top-level pages, and often only the active page.** A frame on another page still resolves when you pass its id directly, so query the id you have instead of enumerating. Metadata gives a node's children only — no parent link — so you cannot walk up to a containing frame; start from a page or a known id.
- Tool names carry the live namespace, which need not match the configured server name. Check the tool list before calling (SKILL.md, Figma).

---

## 6. Asana writes

Within the ticket work authorized by AGENTS.md or the user:

- assignment
- section moves
- custom-field values
- task type and labels
- ticket creation before agreed feature or fix implementation: follow the board's naming convention and include a factual description (what, where, acceptance criteria, source)
- image attachments: the source screenshot on a new ticket and the before/after image on a finished one, with no text alongside (§10, §11)

Comments via `mcp__asana__add_comment` or REST `POST /tasks/{gid}/stories` require authorization. Use the requested wording and brevity. A personal REST token also acts as the signed-in user. Respect instructions to leave comments or state unchanged, including code-only rollback requests.

When you hit a blocker — a missing Figma link, an ambiguous spec, an asset that was never attached — report it in chat. Post it on the ticket only when authorized, using the requested wording.

If you posted a comment by mistake, remove it: `GET /tasks/{gid}/stories` to find the story gid, then `DELETE /stories/{gid}`. You can only delete stories your own token authored.

---

## 7. Recovering a dead session

Symptoms come in this order: a tool that worked before returns empty, then returns a generic error, then names an auth failure. Empty is the common case, so treat an unexpected empty result as an auth question first.

```
mcp__figma-remote-mcp__authenticate
```

That is the Claude Code tool. In Codex, run `codex mcp login figma-remote-mcp` in a shell.

Either one needs the user to finish the sign-in in a browser. It cannot complete without them, so a scheduled or headless run has to fail loudly rather than retry.

Before a long unattended job, make one cheap read and confirm real data comes back.

---

## 8. Connection check

Run this before depending on either server. It separates "authenticated and empty" from "not authenticated".

```bash
# REST token works, and identifies who it belongs to
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" https://api.figma.com/v1/me | head -c 200

# a known file returns a name, not an error body
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY?depth=1" | head -c 200
```

For the MCP servers, the equivalent is one small read against something you know exists — a file you can see in the browser, a task you can name. A result matching what you already know is the only evidence the connection is live.

---

## 9. Asana REST

The fallback when the MCP server isn't connected — which is the norm in a headless, cron or otherwise non-interactive run, because the MCP OAuth flow needs a browser. A personal access token (Asana → Settings → Apps → Developer → personal access token) sent as a Bearer header needs no callback and works unattended.

Base `https://app.asana.com/api/1.0`. JSON writes wrap their body in `{ "data": { ... } }`; attachment uploads use multipart form data. Reads can trim their payload with `opt_fields`.

```
Authorization: Bearer <personal access token>
Content-Type: application/json   # JSON writes only
```

| Call | Use |
|---|---|
| `GET /users/me` | Cheapest call that proves the token works |
| `GET /projects/{gid}/sections` | Board columns and their gids — you need these to move tasks |
| `GET /tasks?project={gid}&opt_fields=name,completed,notes,memberships.section.name,permalink_url&limit=100` | List a project's tasks with their current column |
| `GET /tasks/{gid}?opt_fields=name,notes,completed,memberships.project.gid,memberships.section.gid,memberships.section.name,permalink_url` | Task details and completion/section readback |
| `GET /tasks/{gid}/stories?opt_fields=resource_subtype,text,created_at` | Latest comments and task history; follow pagination |
| `GET /tasks/{gid}/attachments?opt_fields=name,download_url,view_url` | Attachments; `download_url` is a signed, short-lived asset URL |
| `POST /sections/{gid}/addTask` `{data:{task}}` | **Move a task into a board column** |
| `POST /sections/{gid}/addTask` `{data:{task, insert_before}}` | Move and place it above a task already in that column (`insert_after` places it below) |
| `GET /sections/{gid}/tasks?opt_fields=name` | A column's tasks, top to bottom |
| `POST /tasks` `{data:{name, html_notes, projects:[gid]}}` | Create a ticket, then place it with `addTask`; add `due_on` only for an agreed date |
| `POST /attachments` multipart: `parent=<task gid>`, `file=@image.png` | Attach a source screenshot or a before/after image |
| `PUT /tasks/{gid}` `{data:{completed:true}}` | Mark complete; use `completed:false` to reopen within scope |
| `PUT /tasks/{gid}` `{data:{assignee, custom_fields, ...}}` | Other state changes |
| `POST /tasks/{gid}/stories` `{data:{text}}` | Post an authorized comment only (§6) |
| `DELETE /stories/{gid}` | Remove a comment your token authored |

Things that waste time if you don't know them:

- **A board column is a *section*.** Moving a task between columns is `POST /sections/{gid}/addTask` — not a field on the task. There is no `section` field to `PUT`. Section gids aren't guessable; read them from `GET /projects/{gid}/sections` first.
- **The current column lives in `memberships[].section.name`,** not a top-level field. Ask for it explicitly (`opt_fields=memberships.section.name`) or it won't be in the response.
- **Section and completion are separate.** Moving to Done does not set `completed`. After both writes, read the task back and check `completed` plus the section in the target project's membership. If either write fails, report the actual state and finish the missing authorized step.
- **`addTask` with no position puts the task at the top of the column.** To keep a column in number order, pass `insert_before` or `insert_after`. The task you name must already be in that column; one from another column returns 403 `child_object_does_not_exist_in_parent_object`.
- **Give uploads a timeout.** A multipart upload without one can hang for minutes; 90 seconds is plenty for a screenshot.

### Marker.io tasks

QA tickets filed by Marker.io have AI-generated titles prefixed `[Marker.io]` and a notes body that carries, in plain text:

- `Source URL:` — the page to reproduce the bug on.
- a `https://files.marker.io/...` asset link — **auth-walled; it returns an HTML login page, not the image.**
- reporter name/email and a `app.marker.io/i/...` issue link.

Read the actual screenshot from the task's own attachment instead: `GET /tasks/{gid}/attachments` → `download_url` (a signed `asanausercontent.com` URL, short-lived — fetch it promptly).

See `asana_client.py` for a copy-ready helper covering list / move / complete / attachments, plus the ticket calls from §10: create, attach an image, and move a task while keeping its column in number order.

---

## 10. Board convention

Follow the active project's Asana workflow in `AGENTS.md` or the user's instructions. Confirm the repository and Asana project, read its actual sections and use that board's IDs and ordering convention. Documentation and Git housekeeping do not require feature tickets unless requested.

### Creating tickets

- Create one ticket per agreed feature or fix before implementing it, or reuse the existing ticket. Follow the board's naming convention; when it uses `NN · Short title`, continue from its highest number.
- Record the requested behavior, affected view, acceptance criteria and supplied source links/copy. Attach the relevant source images (§11). Use an agreed due date; do not invent one.
- Read descriptions, latest comments and relevant attachment images before deciding the scope. Compare the actual view and expected outcome before treating tickets as duplicates; close a duplicate only when authorized, and add a linking comment only when separately authorized.

### Working a ticket

- Move to In Progress when work starts. Work one ticket at a time and continue through an authorized batch without asking permission per ticket.
- Apply the project's scope and content ownership rules: preserve shared defaults, edit CMS-owned copy through the existing CMS flow, reuse an existing metric's exact definition and source when requested, and use the matching design evidence.
- Load the available `playwright-repro` skill by its configured location. Capture the original state, implement the scoped change and rerun the same verification. Phone checks are required when separate phone code, layout, responsive behavior or interaction is affected; shared text-only changes need one browser check. Verify distinct affected surfaces, including tables.
- Recheck comments before closure or rework. Keep blocked or unverified work open and report the precise missing input in chat. Follow AGENTS.md for CMS-only work and explicit instructions to leave board state alone.

### Completing a ticket

- After the acceptance criteria pass, attach reviewed before/after evidence (§11), without a routine text comment. A check-only ticket's captions must explain that the captured states match because no change was needed.
- Use the final state authorized by the project or user. For Done, move with `POST /sections/{doneGid}/addTask`, then set `completed: true` with `PUT /tasks/{taskGid}`. Read back both values using §9; keep the board's ordering convention when positioning the task. If a review stage is required, leave the task incomplete in that stage.
- Done records verified completion, not deployment. Report deployment separately and satisfy any ticket-specific release requirement before closure.
- Use board state and attachments for routine progress. Post text comments only when authorized (§6).
- For an authorized unattended run, re-read the agreed input column and completion state. Stop when its eligible work is exhausted; polling does not expand the authorized scope.

---

## 11. Ticket images

### Source screenshot, on a new ticket

- Preserve supplied source images in full. For a browser capture, scroll to the relevant section and capture the whole viewport at readable resolution; use red rectangles to identify the requested area without obscuring it. Do not add a ticket/title header banner.
- Mark every relevant area when a ticket covers multiple items. Preserve enough context to identify the page and view.
- For a document source, render the whole relevant page to PNG. Locate text with the PDF text layer (`pdftotext -bbox-layout`) rather than guessing coordinates; account for ligatures when matching text. Use the supplied image when no original document is available.

### Before/after image, on a finished ticket

- Follow the active project's screenshot requirements. Use the same reproduction, route, viewport, filters and scroll location for both states. Wait for data, fonts and chart transitions to settle.
- Capture with `fullPage: false`, without a `clip`. Preserve the whole viewport at readable resolution; do not crop or resize it to fit a layout. Measure red rectangles from the DOM (`getBoundingClientRect`) and keep them clear of the UI.
- Put short captions below the screenshots: the before caption explains the issue; the after caption explains the change. Use straight quotes and no ticket/title header banner. Include separate pairs for distinct affected views, such as a chart and its table.
- Include phone evidence when the change affects separate phone code, layout, responsive behavior or interaction. Shared text-only changes do not need a duplicate phone pair.
- Capture real states. If a before capture is missing, use the old code in an isolated copy; preserve other work and do not temporarily revert the shared working tree.
- Open the final image before attaching it. Check that captions and marks are legible and do not cover the evidence. Dismiss incidental overlays consistently when they are not part of the issue, and keep the screenshots out of commits unless requested.
