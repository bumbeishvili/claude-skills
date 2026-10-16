# MCP & API integration — playbook

Recipes for the Figma MCP server, the Figma REST API and the Asana MCP server.

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
      "oauth": { "clientId": "<client-id>", "callbackPort": 8080 }
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
callback_port = 8080
```

Then sign in to each server with `codex mcp login <name>`.

Confirm port 8080 is free before authenticating Asana:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Anything listening there takes the OAuth callback and the flow fails without naming the cause.

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

Allowed, because they change task state:

- assignment
- section moves
- custom-field values
- task type and labels
- tickets, when the user asks for a brief or feedback round to be split into them: a numbered title and a factual description (what, where, source)
- image attachments: the source screenshot on a new ticket and the before/after image on a finished one, with no text alongside (§10, §11)

Not allowed, because it attributes them to the user: comments via `mcp__asana__add_comment` (or REST `POST /tasks/{gid}/stories`), and any other call that produces text in the user's voice. The rule holds for a personal REST token too, not only the OAuth MCP server.

When you hit a blocker — a missing Figma link, an ambiguous spec, an asset that was never attached — write it in your chat reply. The user relays it if they want it on the ticket.

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

Base `https://app.asana.com/api/1.0`. Every write wraps its body in `{ "data": { ... } }`, and every read can trim its payload with `opt_fields`.

```
Authorization: Bearer <personal access token>
Content-Type: application/json   # writes only
```

| Call | Use |
|---|---|
| `GET /users/me` | Cheapest call that proves the token works |
| `GET /projects/{gid}/sections` | Board columns and their gids — you need these to move tasks |
| `GET /tasks?project={gid}&opt_fields=name,completed,notes,memberships.section.name,permalink_url&limit=100` | List a project's tasks with their current column |
| `GET /tasks/{gid}?opt_fields=name,notes,permalink_url` | One task's detail |
| `GET /tasks/{gid}/attachments?opt_fields=name,download_url,view_url` | Attachments; `download_url` is a signed, short-lived asset URL |
| `POST /sections/{gid}/addTask` `{data:{task}}` | **Move a task into a board column** |
| `POST /sections/{gid}/addTask` `{data:{task, insert_before}}` | Move and place it above a task already in that column (`insert_after` places it below) |
| `GET /sections/{gid}/tasks?opt_fields=name` | A column's tasks, top to bottom |
| `POST /tasks` `{data:{name, html_notes, projects:[gid], due_on}}` | Create a ticket, then place it with `addTask` |
| `POST /attachments` multipart: `parent=<task gid>`, `file=@image.png` | Attach a source screenshot or a before/after image |
| `PUT /tasks/{gid}` `{data:{completed:true}}` | Complete / reopen |
| `PUT /tasks/{gid}` `{data:{assignee, custom_fields, ...}}` | Other state changes |
| `POST /tasks/{gid}/stories` `{data:{text}}` | Comment — **avoid** (identity rule) |
| `DELETE /stories/{gid}` | Remove a comment your token authored |

Things that waste time if you don't know them:

- **A board column is a *section*.** Moving a task between columns is `POST /sections/{gid}/addTask` — not a field on the task. There is no `section` field to `PUT`. Section gids aren't guessable; read them from `GET /projects/{gid}/sections` first.
- **The current column lives in `memberships[].section.name`,** not a top-level field. Ask for it explicitly (`opt_fields=memberships.section.name`) or it won't be in the response.
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

A QA board runs its tasks left to right through columns: **List → ToDo → In Progress → Dev Testing → To Be Deployed → Done → Backlog**. Boards differ, so read the sections and map them before moving anything. Features, issues and client feedback all follow the same flow.

### Creating tickets

- **One ticket per item, numbered.** Title `NN · Short title`, continuing from the highest number on the board, so the number leads straight back to the item in the source.
- **A short, factual description**: what to change, where (files, components), and the source with its date. Quote any copy the client supplied word for word.
- **Attach a screenshot of the source with the item boxed in red** (§11). Attachment only, no comment text with it.
- **Put new tickets in ToDo, in number order, with a due date.** Items nobody has agreed to yet go to Backlog, with the reason in the description.
- Create every ticket before starting work, so the board shows the whole batch.

### Working a ticket

- **Move it to In Progress the moment you start.** One ticket at a time, so In Progress never fills with half-done work; tickets that change the same lines can move together.
- **Reproduce first, fix, then prove the fix against the same reproduction.** For a web change that means a throwaway Playwright script run before and after, at desktop width and at phone width (390px), not an assumption. Run axe on the parts you changed. If the [`playwright-repro`](../../../playwright-repro/skills/playwright-repro/SKILL.md) skill is available, use it.
- **Move to Dev Testing only when the change is made and verified**, not when the edit is written.

### Completing a ticket

- **Attach one before/after image, with no text** (§11). Before shows the issue reproduced or the old state; after shows the same view fixed, the changed area boxed and labelled. For an issue, the before half is the bug reproduced.
- **Then move it to Dev Testing.** That is the agent's last column. To Be Deployed and Done belong to the reviewer; move tasks there only when the user asks.
- **Keep every column ordered.** Active columns run in ascending number order, 01 at the top; place each task with `insert_before`/`insert_after` (§9). Done runs newest first: when asked to move a batch there, add it lowest number first with no position, so the newest ends on top.
- **A check-only ticket** (nothing needed changing) still gets an image. Label it so it's clear the two halves match on purpose.
- **Never comment to report progress.** The board columns *are* the status. Blockers, questions and "can't reproduce" go in your chat reply to the user, never on the ticket (identity rule, §6).
- **Polling for new work** (unattended runs): re-read the ToDo column on an interval; a task's section, not a flag, tells you it's new. Stop when ToDo is empty rather than spinning.

---

## 11. Ticket images

### Source screenshot, on a new ticket

- Crop the part of the source that holds the item, with a line or two of context above and below, at a size that reads without zooming.
- Box every paragraph the ticket covers. An item spread over a page gets several boxes, not one box around its first paragraph.
- Add a header band naming the ticket and the source, e.g. `Ticket 07 · requests doc, page 3`.
- For a document, render the page to PNG and locate lines from the PDF text layer (`pdftotext -bbox-layout`) rather than guessing coordinates. Ligatures such as fi and fl drop out of the text layer, so normalise both sides before matching. For a screenshot of a brief, find the text rows by scanning for dark pixels.

### Before/after image, on a finished ticket

- Capture both halves with the same script, page, view and viewport.
- If the change is already in the code, put the old version back for a moment, capture the before half, restore the new version, and check the restored file is byte-identical.
- Box the changed area in red with a short label, and caption the halves BEFORE (grey) and AFTER (green). Several views go in one image as stacked pairs.
- Add phone-width pairs when the layout changes. Scale retina phone shots down so they sit at a similar size to the desktop ones.
- Measure boxes from the DOM (`getBoundingClientRect`) instead of reading coordinates off the image.
- Scroll and clip rather than using `fullPage: true`. A full-page capture resizes the viewport and can leave the page ignoring the next click.
- Open the finished image and look at it before uploading. Labels must not cover what they point at. Hide sticky overlays such as survey prompts and cookie bars. Check every glyph exists in the label font; an arrow can render as an empty box.
