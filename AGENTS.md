Before moving on with any tasks, first output in the message "I've read custom instructions" to confirm that you have read the instructions. Then, proceed with the task. Don't output above text in this file.

> **Project context:** See [.claude/ABOUT.md](.claude/ABOUT.md) for project overview, tech stack, structure, and key details.

# Shared project instructions

This is the instruction source for Codex and Claude. Edit project rules here; `.claude/CLAUDE.md` only imports this file.

## Rules *(unless user suggests otherwise)*

1. **No Repetition** - Extract logic into functions
2. **No Hard Coding** - Use variables, read from data sources
3. **No VS Code Browser** - Don't run/build projects
4. **No JS→TS Conversion** - Don't fix TypeScript issues
5. **Single Task Focus** - Don't volunteer extra fixes
6. **Say when you do not know** - State the gap and what would resolve it instead of guessing
7. **Prefer map over forEach** - Use functional programming patterns
8. **Use library functions** - If included, prefer d3.sum, d3.groups, d3.mean over native alternatives
9. **String matching** - Prefer direct equality for known values over includes
10. **Preserve defaults** - Don't modify default values unless specifically asked
11. **Data & State Management** - Preserve existing data flow, reactive statements, transformation chains and add new functionality without disrupting existing patterns
12. **Variable renaming** - Only update actual variable names and identifiers, not string literals, text content, or display text
13. **Lint handling** - Don't automatically fix lint warnings unless explicitly requested, focus on user's actual request over style suggestions
14. **Let errors surface** - Add a try/catch or guard only where the application would otherwise break, and throw a descriptive error there; a swallowed error hides the source of the problem
15. **production quality** No shortcuts, make sure to write production quality code unless asked otherwise
16. **Understandable code** Try to write the code in a way, it to pass senior developer review, but can be understood by junior developer
17. **No running scripts directly** - Don't execute Python scripts or data processing code directly via command line. Update the notebook and let the user run it themselves. Notebook cell execution is fine. Reason: the user needs to see outputs inline, catch errors immediately, and have a documented record of what was run and what it produced. Running scripts silently hides all of that.
18. **No Figma node IDs in user-facing content** - Never surface a Figma node id (`123:456`) in tooltips, labels, copy or any text an end user reads. Node ids are internal design references and mean nothing to users. Keep them in code comments or commit messages if needed.
19. **Analyze before fixing** - Read logs and data carefully before diagnosing issues. Don't assume the root cause — verify it. If a fix turns out to be based on a wrong assumption, roll it back immediately instead of leaving incorrect changes in the code.

## Skills

Shared skill sources live in `.claude/skills/`. Codex discovers the same folders through relative symlinks under `.agents/skills/`, so editing a source updates both agents. Read the relevant `SKILL.md` before using a skill and resolve supporting files relative to its folder. Tool names in a skill are examples: use the equivalent tool you have, and check that a connector is installed before relying on it.

Most skills load themselves when the task matches their description; these notes cover what description-matching misses.

- **ai-deslop** — writing style is not a task, so this one never self-triggers. Follow `.claude/skills/ai-deslop/SKILL.md` for all prose: chat replies, docs, commits, PR descriptions, code comments.
- **mcp-api-integration** — Figma and Asana, over MCP or REST. It owns those rules, including the Figma tool namespace, node-id parsing and which Asana writes are safe. Prefer it over Figma or Asana guidance restated anywhere else.
- **playwright-repro** — any browser bug or UI verification. Reproduce in a script before diagnosing, re-run the same script to prove the fix.
- **d3-charts** — read before writing D3 chart code.
- **light-cms** — the git-backed SvelteKit CMS.