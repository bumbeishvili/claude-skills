Before moving on with any tasks, first output in the message "I've read custom instructions" to confirm that you have read the instructions. Then, proceed with the task. Don't output above text in this file.

> **Project context:** See the target project's README and `.claude/ABOUT.md` for its overview, setup and content sources. If the context file is a placeholder, read the repository rather than assuming details from another project.

# Shared project instructions

This is the instruction source for Codex and Claude. Edit project rules here; `.claude/CLAUDE.md` only imports this file.

Explicit user instructions take precedence. The project workflow below overrides conflicting skill defaults, including completion status, phone checks and screenshot formatting.

## Rules *(unless user suggests otherwise)*

1. **No Repetition** - Extract logic into functions
2. **No Hard Coding** - Use variables, read from data sources
3. **Project execution** - Reuse an existing local server. Start or build the project only when authorized; that authorization persists within its agreed scope, so do not ask again for the same action. Use Playwright for browser work, not Computer Use or the VS Code browser. Preserve the configured development port; prefer an available REST connection if MCP OAuth conflicts with it.
4. **No JS→TS Conversion** - Don't fix TypeScript issues
5. **Single Task Focus** - Don't volunteer extra fixes
6. **Say when you do not know** - State the gap and what would resolve it instead of guessing
7. **Prefer map over forEach** - Use functional programming patterns
8. **Use library functions** - If included, prefer d3.sum, d3.groups, d3.mean over native alternatives
9. **String matching** - Prefer direct equality for known values over includes
10. **Preserve defaults** - Don't modify default values unless specifically asked
11. **Data & State Management** - Preserve existing data flow, reactive statements, transformation chains and add new functionality without disrupting existing patterns
12. **Variable renaming** - For identifier-only refactors, preserve string literals and display text. Explicitly requested copy changes are separate work and are allowed.
13. **Lint handling** - Don't automatically fix lint warnings unless explicitly requested, focus on user's actual request over style suggestions
14. **Let errors surface** - Add a try/catch or guard only where the application would otherwise break, and throw a descriptive error there; a swallowed error hides the source of the problem
15. **production quality** No shortcuts, make sure to write production quality code unless asked otherwise
16. **Understandable code** Try to write the code in a way, it to pass senior developer review, but can be understood by junior developer
17. **Script execution** - Keep Python and data-processing scripts in notebooks so the user can run them and inspect outputs inline. Temporary Node/Playwright and API scripts for authorized ticket work may run from the command line; retain relevant results and remove scratch scripts afterward.
18. **No Figma node IDs in user-facing content** - Never surface a Figma node id (`123:456`) in tooltips, labels, copy or any text an end user reads. Node ids are internal design references and mean nothing to users. Keep them in code comments or commit messages if needed.
19. **Analyze before fixing** - Read logs and data carefully before diagnosing issues. Don't assume the root cause — verify it. If a fix turns out to be based on a wrong assumption, roll it back immediately instead of leaving incorrect changes in the code.

## Asana feature workflow

- Confirm the repository and its Asana project before creating or moving tickets. Read the board's actual sections and IDs; never reuse another project's board IDs. If this project's board is not documented or supplied, ask for its link once.
- Create one ticket per agreed feature or fix before implementation, or reuse its existing ticket. Record the requested behavior, affected page/component, acceptance criteria and source links. Follow the board's numbering/order convention, attach supplied source screenshots, and use an agreed due date rather than inventing one. Documentation and Git housekeeping do not require feature tickets unless requested.
- Read the full description, latest comments, linked design and relevant attachments, including images. Recheck comments before closing or reworking a ticket. Resolve material conflicts or missing requirements instead of guessing.
- Move List/ToDo → In Progress when starting. The default final state is Done after the acceptance criteria pass and evidence is attached: move the ticket and mark complete, then read back both the section and completion flag. Follow any project-specific review or release gate and explicit user instructions that override this default. Keep blocked or unverified work open and report the precise missing input in chat. Done does not imply deployment.
- Work one ticket at a time and continue through an authorized batch without requesting permission per ticket. Review feedback means rework, re-verify and attach updated evidence.
- Compare descriptions, comments, screenshots, locations and expected outcomes before declaring duplicates. Similar titles are insufficient. When duplicate closure is authorized, close only the duplicate and leave the canonical task open until its work is complete. If a linking comment is also authorized, use `Duplicate of <canonical ticket link>`.
- Use board state and image attachments for routine progress. Post text comments only when authorized, using the requested wording and brevity. If the user will comment or requests a code-only rollback, leave Asana comments and status alone.

## Scope and content ownership

- Change the exact area requested. A heading rename does not imply a menu rename. Check shared-component consumers, preserve their defaults, and scope changes to the requested views.
- Trace copy to its source first. CMS-owned content belongs in that CMS; do not override it with frontend replacements or hardcoded fallbacks. If the ticket only needs a CMS edit that cannot be made within the authorized scope, keep it in List/ToDo, incomplete, and report the field and blocker in chat. When correcting our mistaken implementation, remove only our override; preserve unrelated existing fallbacks. Follow any explicit instructions about leaving ticket state alone. When a CMS explanation comment is authorized, use exactly: `This should be done through CMS`.
- When asked for an existing header metric, reuse its definition and source: calculation, filters, denominator, population, period and label. Do not invent a measure or substitute a convenient subgroup. Preserve the established data flow.
- Choose charts and interactions from the matching design and attached evidence. Inspect existing dashboards for established behavior; a ticket title alone does not establish the intended chart. State gaps and resolve material choices before implementing them.

## Verification and screenshots

- Reproduce a bug before editing, then rerun the same Playwright reproduction after the fix. For a new feature, capture the original page or empty state and verify the ticket's acceptance criteria afterward. Wait for data, fonts and chart transitions to settle before measuring or capturing.
- Match checks to the change. Shared text-only changes need one browser check. Check phone views when they use different code or the change affects layout, responsive behavior or interaction. Verify each affected surface, including data tables, and include evidence for those distinct views.
- Capture full viewport screenshots with enough page context to locate and reproduce the issue. Scroll to the relevant section, preserve the whole viewport at readable resolution, and mark the responsible area with a red rectangle. Avoid tight crops, full-page captures and ticket/title header banners.
- Pair before/after at the same route, viewport, filters and scroll location. Put short captions below the screenshots explaining what was wrong and what changed, using straight quotes. Include separate pairs for distinct affected views. Keep marks and captions clear of the UI, inspect the final image, then attach the image without a routine text comment.
- Capture real states; never fabricate a before image. If old code is needed for missing evidence, use an isolated copy that preserves other work. Keep screenshots and scratch artifacts out of commits unless requested.

## Preserve unrelated work

- Record existing staged, unstaged and untracked changes before editing. Track the files and hunks attributable to each ticket, including shared files and new assets.
- Roll back only the requested ticket's changes. Preserve user edits, other tickets and shared dependencies still in use, then verify the restored behavior.
- When asked to stage our work, stage only attributable files or hunks. Preserve the staging state of unrelated work and check the staged diff. Staging does not authorize a commit, push or deployment.

## Skills

Shared skill sources live in `.claude/skills/`. Codex discovers the same folders through relative symlinks under `.agents/skills/`, so editing a source updates both agents. Read the relevant `SKILL.md` before using a skill and resolve supporting files relative to its folder. Tool names in a skill are examples: use the equivalent tool you have, and check that a connector is installed before relying on it.

Most skills load themselves when the task matches their description; these notes cover what description-matching misses.

- **ai-deslop** — writing style is not a task, so this one never self-triggers. Follow `.claude/skills/ai-deslop/SKILL.md` for all prose: chat replies, docs, commits, PR descriptions, code comments.
- **mcp-api-integration** — Figma and Asana connection/API mechanics, including tool discovery and node-id parsing. Follow the project workflow above for ticket lifecycle, authorized comments and screenshot requirements.
- **playwright-repro** — any browser bug or UI verification. Reproduce in a script before diagnosing, re-run the same script to prove the fix.
- **d3-charts** — read before writing D3 chart code.
- **light-cms** — use only for an explicitly requested Git-backed CMS; preserve a project's existing content source for ordinary copy edits.
