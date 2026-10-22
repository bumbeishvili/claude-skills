---
name: playwright-repro
description: Reproduce, diagnose, fix and verify web bugs using throwaway Playwright scripts — write a script that makes the bug happen before touching any code, measure real values against ground truth instead of assuming, apply the smallest fix, then re-run the same script to prove it. Use whenever a user reports a bug in a running web app or hands over a round of feedback on one, asks "why is X happening in the browser", asks you to verify a UI change actually works, or when you are about to claim something is fixed without having seen it fixed. Covers auth reuse, console/network capture, reading in-page state, pixel checks, the measurement traps that make a script lie to you, and the before/after report that ends a batch of bugs. Start from template.cjs; playbook.md has the recipes.
---
# Playwright Repro

A discipline for browser bug work. You write a `.cjs` file, run it with `node`, learn
something, and delete it. These are throwaway scripts, not a suite you maintain —
nothing here gets committed.

Follow the active project's `AGENTS.md` for scope, execution permission and
ticket completion. Use Playwright directly for this workflow; Computer Use is not
required. Reuse an authorized server and its configured port.

**Start every investigation by copying [`template.cjs`](template.cjs)** into a
scratch directory. It already wires up console/error/network capture, auth reuse,
and artifact output — you only write the part that reproduces the bug.

- **[`playbook.md`](playbook.md)** — the recipes: auth, waiting, reading state, measuring, soak loops, ground truth, batch report.

## The loop

```
1. Reproduce  → script makes the bug happen, on demand, every run
2. Measure    → get real numbers; compare against a source of truth
3. Fix        → smallest change that addresses what you measured
4. Re-verify  → re-run THE SAME script; bug gone, nothing else broken
5. Clean up   → remove debug hooks from app source, delete the script
```

Each step gates the next. Step 1 produces the evidence your theory has to explain, and
step 4 produces the evidence that the fix worked.

## The four rules

### 1. No repro, no fix

Before you form a theory about the cause, have a script that makes the bug happen.
Once you have exhausted the conditions you can control — data, route, viewport,
account state, timing — report what you tried, name the conditions you could not set,
and ask for them.

### 2. Your measurement is a suspect too

When a script reports something surprising, the script is at least as likely to be
wrong as the app. **Validate the measuring code against a case with a known answer
before trusting it on the unknown one.** A measurement bug reports the same wrong
value on every run, which reads as a stable, real finding.

### 3. Ground truth comes from outside the app

To check that the app shows the right value, fetch the same value straight from its
source — the API response, the file, the database — in plain Node, and compare the
two. Comparing the app against what you expected only tests the expectation, which
can be wrong in the same way the app is.

### 4. Re-run the same script

Re-run the exact file that produced the failure. It is the only thing that can prove
the failure is gone. When shared code changes can affect other consumers, check
those consumers too. A copy-only edit does not need unrelated page checks.

## Practices

- **Check the requested surfaces.** Read the latest ticket comments and attachment
  images before selecting a page, chart or control. A shared copy edit needs one
  browser check; add phone checks when mobile uses different code or layout,
  responsive behavior or interaction changes. Include affected data tables and
  other distinct views in the verification and evidence.
- **Capture the original state first.** For a feature, use the original page or
  empty state, then check the acceptance criteria. If a missing before capture
  requires old code, use an isolated copy; preserve the user's working tree.
- **Run headed.** Every investigation runs with a visible browser window
  (`headless: false`) so you watch the bug happen. The window shows layout jumps,
  flashes of stale data, swallowed clicks and stuck spinners that a log reporting
  `rows: 0` leaves out. Reserve headless for long soak loops, once you already know
  what you are looking at (playbook §0).
- **Read the console.** Capture `console`, `pageerror` and failed requests from the
  first run, including when the bug "is only visual". An error names the failing
  module and line; a failed request names the URL and status.
- **Wait on an observable condition** — `until()`, `waitForSelector`,
  `waitForResponse`. A condition still holds on a slower machine; a fixed sleep passes
  on yours and hides the race (playbook §3). Wait for relevant data, fonts and chart
  transitions before measuring or taking screenshots.
- **Remove every debug hook you add to app source.** `grep` for the hook name before
  you finish, along with `.only`, forced states and hardcoded coordinates (playbook §4).
- **One script per investigation**, named for the bug.
- **Keep scripts in a scratch directory outside the repo**, or delete them before you
  finish.
- **Capture artifacts** (screenshots, JSON dumps) to a folder so you can diff runs.
- **Keep page context in evidence.** Use full viewport screenshots at the same route,
  filters, scroll position and viewport before and after. Mark the responsible area
  with a red rectangle. Put short issue/fix captions below the screenshots, with
  straight quotes and no title banner; keep annotations clear of the UI. Inspect the
  finished image before attaching it. No tight crops or full-page captures.
- **Prefer `getByRole` and visible text over CSS paths.** A selector tied to DOM
  structure breaks on the next refactor and costs the next investigation.

## Reporting a result

State what you ran, what you observed, and what remains unverified:

> Reproduced with `repro.cjs`: 3 of 5 rows render stale totals after the filter
> change. Root cause: the memo key omits `filterId` (`useTotals.ts:42`). After the
> fix the same script shows 5 of 5 correct, console clean. I could not reproduce
> the reported crash on mobile viewport — needs the real device.

Name the parts you could not reproduce. An explicit "unverified" tells the reader what
still needs checking; leaving it out reads as verified.

## Reporting a batch

One bug is reported as in the section above. Two or more — a list of feedback items, a
QA round, several tickets — end with a report file instead: `_raw/report.md` at the
project root, with its screenshots in `_raw/report/`. Create `_raw/` when the project
has none. The file is a Markdown list. Each piece of feedback is one list item with
these four entries and no others:

```markdown
- **Feedback:** the reporter's words
  - **Before:** ![Before](report/<script>-before.png)
  - **After:** ![After](report/<script>-after.png)
  - **Notes:**
```

- **Feedback** — the reporter's words, verbatim: pasted as they arrived, typos and
  original language included.
- **Before** — full viewport from the repro script while the bug still reproduces,
  the issue boxed in red and explained in a caption below.
- **After** — the same view after the fix, the changed spot boxed in red and its
  resulting behavior explained below. Include pairs for affected tables or other
  distinct views; phone pairs follow the change-specific checks above.
- **Notes** — empty, unless the reader has to know something the two screenshots cannot
  show.

The Before screenshot can only be taken until the fix lands, so the report is filled in
during the loop:

- **Before the first fix**, write one list item per piece of feedback: Feedback pasted
  in verbatim, the other three entries empty. When `_raw/report.md` already holds items
  from an earlier batch, add the new ones below them.
- **Loop step 1, reproduce** — call `reportShot(page, target, { captions })` in the script at the
  point where the bug is on screen, and run it with
  `REPORT_DIR=<project>/_raw/report PHASE=before`.
- **Loop step 4, re-verify** — re-run the same script with the same `REPORT_DIR` and
  `PHASE=after`, then put both screenshots in the list item.
- **Loop step 5, clean up** — the scripts and scratch artifacts go; `_raw/report.md`
  and `_raw/report/` stay in the project. Give the user the path to the report.

Every piece of feedback gets a list item. One that never reproduced has an empty
Before, one left unfixed has an empty After, and both get a note.

**Notes stays empty when the two screenshots tell the whole story.** How the fix works
is in the diff. Write one line when:

- the item is unfixed or partly fixed — what remains, and why;
- the bug did not reproduce — what you tried, and what you need to try again (rule 1);
- the reader has to act or decide — a deploy step, a config value, a product decision;
- the fix changes something the feedback did not ask about.

The escaping that keeps Feedback verbatim and the two run commands are in playbook §10.

The local report is separate from the Asana attachment: combine the captioned
before/after views into one review image, then follow the integration skill for
uploading it and verifying the ticket's final state.
