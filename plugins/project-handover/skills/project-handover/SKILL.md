---
name: project-handover
description: Fill a project handover document in Google Docs from the codebase and its hosting. Given only the doc link, read the template, gather the facts (timeline from git history, stack from the package manifest, live/staging URLs and env var names from the hosting CLI, design files, data sources, access accounts, deploy steps, testing approach), draft one answer per field marking unknowns as TBC, then fill and format the doc through the user's signed-in browser with Playwright and verify by reading it back. Use when a user shares a handover, offboarding or technical-documentation Google Doc and asks you to fill it in, complete it, update it or tidy its formatting, or asks where such a doc lives in Drive. Start with gdoc-browser.cjs; the field checklist and key sequences are in playbook.md.
---

# Project handover

A handover doc is a template of labels and prompts that a developer fills before
leaving a project. This skill fills it from evidence: every statement traces to a
file, a command output or a URL you fetched, and every field with no evidence says so.
The document is edited in Google Docs through the user's own browser, since a Docs
link is usually all you get — no API credentials, no Drive connector.

## Workflow

1. **Read the template.** Run `gdoc-outline.cjs` on the doc id (the segment after
   `/document/d/` in the link). Note the two shapes a field takes: a two-column table
   row (label cell, empty value cell) and a bare label paragraph, sometimes followed by
   an italic grey prompt explaining what is wanted.
2. **Inventory the project.** Work through the fact sources in
   [`playbook.md` §2](playbook.md); each yields the answers to a set of fields. Prefer a
   command's output over memory: git for dates, the manifest for versions, the hosting
   CLI for URLs, aliases and env var names, the browser for anything the user says is live.
3. **Draft every answer before typing any.** One block per field, in the template's
   order, checked against the writing rules below. Three links are mandatory — the
   **dev/staging URL**, the **live URL** and the **design file** — so if the inventory
   does not surface all three, ask the user for them before filling anything. Ask
   likewise for what only the user knows; for anything else you cannot find, write
   `TBC` plus what is needed.
4. **Fill one field, read it back, then batch the rest** with `gdoc-edit.cjs`. Table
   cells take short lines; long answers under a label become a bulleted list; short
   values (a URL, a login) stay inline after the label.
5. **Format.** Bold every label the template left regular; reset your own text to the
   default colour and weight; keep the template's prompt styling (grey, italic) as
   found so filled content reads differently from template text; make every URL a
   hyperlink and unlink the filenames Docs auto-linked. Order and shortcuts in
   [`playbook.md` §4](playbook.md).
6. **Verify.** Read the outline back and compare each field; screenshot the editor tab
   for the look. Report what you filled, what is `TBC`, and what you left for the user.

## Writing rules for the answers

- **Dev, live and design links are never `TBC`.** A handover without a staging URL, a
  production URL and the design file link is not usable by the next developer. When
  any of the three is missing from the repo, hosting CLI or memory, stop and ask the
  user for it; fill the doc only once you have all three.
- **Evidence or `TBC`.** No dates, versions, counts or URLs from memory. Any other
  field you cannot answer gets `TBC — needs <what>`, which is more useful than a guess.
- **Personal fields stay empty** (location, last day of contract, contact numbers)
  unless the user gives them.
- **Credentials only where the template asks for them**, and tell the user they are in
  the doc so they can decide about rotation. Never add credentials to fields that did
  not ask.
- **Say how access is handed over**, not just where it is: which env var lists the
  admins, which account owns the hosting project, which redirect URL the OAuth client
  needs when the domain changes, when a token expires.
- **Name the deploy path in steps someone else can run**: what triggers a deploy, where
  env vars live, how data or content is refreshed.
- **State the test reality.** "No automated test suite; manual QA against the designs"
  is a valid answer. Do not list browsers or compliance standards nobody tested.
- **Plain prose, short lines.** Follow the ai-deslop rules if installed: measured
  numbers, checkable claims, no filler.

## Driving Google Docs

The editor is a canvas; there is no DOM to fill. Docs' Find box addresses text, keyboard
shortcuts act on the selection, and the `mobilebasic` view of the same document is
what you read back. One headed Chrome on a persistent profile stays open in the
background with a CDP port (`gdoc-browser.cjs`); the user signs in there once. Every
other script connects over CDP, does one thing, and exits with `process.exit(0)`, so
nothing blocks and the user never sees a "stuck" window to close.

Rules that keep the edits landing where intended:

- **A `find` that matches nothing leaves the previous selection in place**, and the
  steps then edit the wrong spot. Dry-run one field; read back after every batch.
- **Take `find` strings from the read-back**, not from what you typed: Docs curls
  quotes, capitalises sentence starts and may have auto-linked or split text.
- **Query the whole label or sentence.** Find is case-insensitive and substring-based;
  `Date:` also matches `Due date:`. Identical queries hit the same occurrence — reach a
  second one through its surrounding text and `Shift+Arrow` narrowing.
- **Typed text inherits the formatting of the character before it**: bold labels, grey
  placeholders, italics. Check the formatting map, then reset your text with `Cmd+\`,
  which keeps bullets and links.
- **Toggle shortcuts (`Cmd+B`, `Cmd+I`) flip the current state.** A template's prompts
  may already be italic; map the formatting before toggling anything.

## Traps

- **`@` opens the people picker.** A scoped package name typed as `@scope/package`
  inserts a person chip and swallows the next Enter. Write such names without `@`.
- **Filenames get auto-linked** (`app.js`, `README.md`, `site.io`) because Docs treats
  the extension as a TLD. Select the word and retype it.
- **A URL ending a paragraph is not auto-linked.** Select it, `Cmd+K`, `Enter`.
- **The export URL is not a reading path**: 401 without the session, CORS failure from
  inside the page. Read through `mobilebasic`.
- **Click the editor at x ≈ 700 with `force: true`**; the outline sidebar overlaps its
  left edge.

## Where the doc lives

Handover templates usually sit in a shared drive, which is why the filled copy does
not appear under My Drive. `gdrive-locate.cjs "<title>"` searches Drive, opens
File information → Show file location, and prints the folder URL and
`<folder> - <shared drive>`.
