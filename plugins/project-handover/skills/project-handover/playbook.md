# project-handover playbook

Commands for gathering the facts, a checklist mapping template fields to their
sources, and the key sequences for editing Google Docs on macOS through Playwright.
Swap `Meta` for `Control` on Linux/Windows.

## 1. Setup

`<docId>` is the segment after `/document/d/` in the doc's URL.

```bash
# once per machine
npm i -g playwright && playwright install chromium

# background browser (leave the window open; sign in to Google when it appears)
NODE_PATH="$(npm root -g)" node gdoc-browser.cjs <docId>

# wait until CDP answers
curl -s http://localhost:9222/json/version

# read the template / verify edits
NODE_PATH="$(npm root -g)" node gdoc-outline.cjs <docId>

# apply edits
NODE_PATH="$(npm root -g)" node gdoc-edit.cjs <docId> ops.json
```

Which pages the browser has open: `curl -s http://localhost:9222/json`. If the doc tab
is gone, the scripts open a new one.

## 2. Fact sources

Run these in the project; each answers a group of template fields. Quote outputs, not
recollection.

| Fields | Source | Command / place |
|---|---|---|
| Timeline, activity | git history | `git log --reverse --format=%ad --date=short \| head -1`; `git log -1 --format=%ad --date=short`; `git rev-list --count HEAD` |
| Stack, versions | package manifest + lockfile | `package.json` scripts and dependencies; `node -p "require('./node_modules/<pkg>/package.json').version"` |
| Structure | source tree | `ls src/routes src/lib` (or the framework's equivalents); one line per top-level area |
| Existing docs | repo root | `README.md`, `.env.example`, notebooks, `AGENTS.md`, `.claude/CLAUDE.md`, any `docs/` |
| Live, staging, preview URLs (mandatory) | hosting CLI, the user | Vercel: `vercel inspect <prod-url>` (aliases), `vercel alias ls --scope <team>`, `vercel ls <project>`; Netlify: `netlify sites:list`, `netlify status`; if the CLI is not linked, ask the user |
| Hosting account, team, project | hosting CLI | `vercel whoami`, `vercel project ls`; the team slug appears in preview hostnames |
| Env var names (never values) | hosting CLI + example file | `vercel env ls production` (names, created age); `.env.example` |
| Token expiry, permissions | the provider's API with the local token | e.g. GitHub `GET /user` → `github-authentication-token-expiration` header, `GET /repos/<o>/<r>` → `permissions` |
| Deploy path | hosting config + git remote | adapter/build config, `git remote -v`, whether pushes to the default branch auto-deploy |
| Design files (mandatory) | project memory, code comments, the user | Figma file key in comments or `.claude` memory; if absent, ask the user for editor and prototype links |
| Content and data sources | repo data folders | raw inputs (`static/raw-data`, `data/`), conversion notebooks, generated outputs; the client contact who supplies them |
| Admin / CMS access | auth config | which env var allowlists admins, which OAuth client, which callback URL, whether a password exists at all |
| End-user access | README, seed scripts | demo credentials only if the template asks; where users are stored and managed |
| Analytics, feedback tooling | root layout, `app.html` | analytics wrapper module, third-party widgets (including ones already removed) |
| Testing approach | repo + honesty | test folders, CI config, lint/check scripts; otherwise "manual QA against the designs" plus any ad-hoc scripts |
| Browser / device support | code | viewport breakpoints in CSS or stores; what was actually tested |
| Compliance | nothing unless an audit exists | "No formal accessibility audit was carried out" when that is the truth |

Common template sections and what goes in them:

- **About / summary** — what the product does, for whom, in two or three lines.
- **Deliverable** — the thing being handed over: app type, main flows, access model,
  where the code is, where it runs.
- **Brand / design / content locations** — links, or "no separate document; styles
  follow the design file, implemented in `<file>`".
- **Timeline** — first commit to last, notable data or release dates, handover date.
- **Links** — live, staging/preview, design file (editor and prototype), repo, Drive
  folder; note branch → environment. The first three are mandatory: ask the user for
  any the inventory did not produce, before filling the doc.
- **Access** — hosting, repo, OAuth client, analytics: which account owns each and how
  a successor gets in.
- **Build / deploy** — where it was built, where it is hosted, what triggers a deploy,
  env vars, how to refresh data, token expiries.
- **Libraries and services** — open-source packages, external services, data sources,
  anything paid, alternative code variants.
- **Testing** — what was actually done, tools used, test logins if requested, where
  feedback was tracked.

## 3. Op shapes for `gdoc-edit.cjs`

```json
[
  { "find": "Summary:", "steps": [ { "press": "Tab" }, { "type": "line one\nline two" } ] },
  { "find": "Website:", "steps": [ { "press": "ArrowRight" }, { "press": "Meta+ArrowRight" }, { "press": "Space" }, { "type": "https://…" } ] },
  { "find": "old sentence exactly as read back", "steps": [ { "type": "new sentence" } ] }
]
```

| Situation | Steps after Find |
|---|---|
| Fill the value cell next to a label in a two-column table | `Tab` (moves to the next cell and selects its content), then `type` |
| Answer on the same line as the label | `ArrowRight` (collapse to end of match), `Meta+ArrowRight` (end of line), `Space`, `type` |
| Answer as a new paragraph under the label | `ArrowRight`, `Meta+ArrowRight`, `Enter`, `type` |
| Replace a sentence or paragraph | `type` (typing replaces the selection) |
| Bulleted list under a label | `ArrowRight`, `Meta+ArrowRight`, `Enter`, `Meta+Shift+8`, `type` with `\n` between items |
| Convert a selected paragraph into a bullet and rewrite it | `Meta+Shift+8`, `type` |
| Bold / italic the selection | `Meta+b` / `Meta+i` — toggles; check the current state first |
| Reset colour, weight, style to document default | `Meta+\` — keeps bullets and hyperlinks |
| Make a selected URL a hyperlink | `Meta+k`, `Enter` |
| Remove a bogus auto-link on a word | `type` the same word again |
| Select from the match to the end of the document | `ArrowLeft`, `Meta+Shift+ArrowDown` |
| Narrow to the last 7 characters of the match | `ArrowRight`, `ArrowLeft`, then `Shift+ArrowLeft` × 7 |
| Delete the selection and join with the previous line | `Backspace`, `Backspace` |

Notes:

- `\n` inside `type` presses Enter. Inside a list it creates the next bullet; inside a
  table cell it creates a new paragraph in the same cell.
- Inline mode leaves a trailing space after the label; harmless.
- A new paragraph under a bold label inherits bold; reset with `Meta+\` afterwards.

## 4. Formatting a filled template

Order that avoids undoing your own work:

1. Restructure content (cells to short lines, paragraphs to bullets).
2. Read back; fix misplaced inserts.
3. Bold the labels the template left regular (`Meta+b` on each label; map the current
   weights first so a toggle does not un-bold one).
4. Colour: `Meta+\` on every paragraph and bullet you wrote; leave template text alone.
5. Links: `Meta+k`, `Enter` on unlinked URLs; retype words that were wrongly linked.
6. Screenshot the editor tab and look at it.

`gdoc-outline.cjs` prints, in document order: table rows as `label ║ value` (`⏎` marks
a cell with several paragraphs), list items as bullets, a `B`/`I` flag pair and the text
colour per line, then a link audit (URLs in the text that are not `<a>` elements, and
`<a>` elements whose text is not a URL or e-mail).

Colours seen in templates: `rgb(0, 0, 0)` body, `rgb(153, 153, 153)` and
`rgb(183, 183, 183)` placeholder/prompt text, `rgb(17, 85, 204)` links. Anything you
typed that reads grey inherited placeholder styling.

Reading right after an edit can return the previous state; the script waits 2 s after
`load`, and a second read settles it.

## 5. Locating the doc in Drive

`gdrive-locate.cjs "<exact title>"` searches Drive, right-clicks the first matching row,
opens **File information → Show file location**, and prints the folder URL and the page
title (`<folder> - <drive>`). Hovering "Organise" does not open its submenu; clicking a
menu item does. Drive's list view also shows the immediate parent in its Location
column, which is enough when the folder name is unique.

## 6. Why not the export URL or the Docs API

- `…/export?format=txt` needs the session cookie (401 otherwise) and, fetched from
  inside a Docs page, fails on CORS because it redirects to `googleusercontent.com`.
  Navigating to it triggers a download instead of a response body.
- The Docs API needs OAuth credentials the session does not have; the Drive connector
  needs authorisation the user grants outside the session. The browser route works
  with what the user already has: a signed-in Chrome.
