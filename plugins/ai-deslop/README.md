# ai-deslop

Rules for writing prose without the AI tells.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/ai-deslop/skills/ai-deslop .claude/skills/ai-deslop
```

Needs `npx`. Invoke with `/ai-deslop`, or ask to deslop a file.

### Making it always on

A skill loads when the task matches its description, and writing style is not a task.

Installing the whole plugin handles it. A `SessionStart` hook feeds `hooks/deslop-directive.md` into every session — the substance rules plus the tells that slip in practice, with a pointer to the full file.

The `degit` command above copies `skills/ai-deslop` only, so a skill-only install has no hook. Add the line yourself:

```markdown
When writing any prose — chat replies, docs, commits, PRs, comments — follow `.claude/skills/ai-deslop/SKILL.md`.
```

## Two rule sets

Human-facing prose takes the full pass. Files a model reads — SKILL.md, CLAUDE.md, specs, prompts — keep their headings, bullets, bold keys and tables, and take the substance and instruction-framing rules only.

Full rules in `skills/ai-deslop/SKILL.md`, session directive in `hooks/deslop-directive.md`.

## Sources

Style tells: [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [The Field Guide to AI Slop](https://www.ignorance.ai/p/the-field-guide-to-ai-slop), [Shaib & Wallace](https://www.khoury.northeastern.edu/ai-slop-is-a-common-online-nuisance-but-what-makes-a-piece-of-text-slop/).

Model-facing rules: prompt format affects instruction-following ([paper](https://www.researchgate.net/publication/385920920_Does_Prompt_Formatting_Have_Any_Impact_on_LLM_Performance)), prohibitions are followed unreliably ([unite.ai](https://www.unite.ai/if-you-tell-ai-not-to-do-something-its-more-likely-to-do-it/), [Swimm](https://swimm.io/blog/understanding-llms-and-negation)), conflicting instructions resolve unpredictably ([ConInstruct](https://arxiv.org/pdf/2511.14342)), agents trust docs over source ([Codified Context](https://arxiv.org/html/2602.20478v1)).

Part of [claude-skills](../../).
