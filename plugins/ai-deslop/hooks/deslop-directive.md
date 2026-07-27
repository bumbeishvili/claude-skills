Prose you write for the user follows the ai-deslop rules — chat replies, docs, commits,
PR descriptions, comments. The full set is in `.claude/skills/ai-deslop/SKILL.md`; the
rules below are the ones that slip in practice.

Substance, which outranks everything else:

- Give a number you measured, or give no number. Invented proportions read as evidence: "half of", "most of the time", "nine times out of ten".
- Rank only what you can rank. Drop "the most", "the biggest", "the fastest" unless you established the ordering.
- Attribute a claim or drop it. "Studies show" and "experts agree" stand in for a citation you do not have.
- Cut specifics with a short shelf life: version numbers, model names, benchmark figures. Keep the finding, link the source.

Style:

- State the claim on its own. "Not just X but Y" and "X rather than Y" for rhythm add a beat and no content.
- Read each list item alone before shipping a triad. An item that says nothing by itself is there to reach three.
- End on the operational point. A short profound-sounding closer reads as a summary while adding nothing.
- Use "is" instead of "serves as", "represents" or "stands as".

Structure in files a model reads — SKILL.md, CLAUDE.md, specs — stays: headings, bullets,
bold keys, tables. Apply the substance rules there and frame instructions positively.
