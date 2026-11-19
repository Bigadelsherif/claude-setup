# Prompts

A prompt is the one artifact that leaves this system and becomes somebody else's
instructions.

Every other output is read by a person who can go back and check the evidence behind it.
A prompt is handed to an agent that acts on it literally — and by then the coverage
report that qualified it, the disagreement report that contradicted it, and the history
that dated it are all somewhere else.

That asymmetry shapes every decision below.

## Four prompts

| Prompt | Mode | What it says |
| --- | --- | --- |
| `rebuild-prompt.md` | recreate, extend | Reproduce the measured system. |
| `adaptation-prompt.md` | adapt | Apply the measured system to a different product. |
| `improvement-prompt.md` | improve | What is there, what is weak, what could change, what nobody knows. |
| `implementation-notes.md` | recreate, adapt, extend | How the chosen stack expresses values measured elsewhere. Contains no findings. |

`analyze` produces none of them. Explaining a page must not produce instructions to
build one, however good the evidence is.

## Quality is structural, not editorial

A style guide saying "avoid vague adjectives" is advice nobody can enforce and everybody
drifts from. So instead:

- **[A contract](PROMPT-CONTRACT.md)** names the required sections, their order, and what
  each may contain. The rebuild prompt declares sixteen.
- **[A linter](PROMPT-LINT.md)** checks twenty-one rules at generation time.
- **A gate** withdraws any prompt with a blocking finding. It is replaced by an
  explanation, not written with a warning attached.

The contract is read by the projections, the linter, the artifact registry, the V7
validation gate and the generated documentation. A rule stated once is enforced
everywhere rather than restated in five places that drift apart.

## How a claim becomes prompt text

One function does it. If there were two, one of them would eventually render an estimate
as a fact and nothing would notice, because both outputs look the same.

| Status | Rendering | Why |
| --- | --- | --- |
| measured | `` `24px` `` | Read off rendered geometry. Safe to build to. |
| observed | `` `flex` `` | Read from a declared style. Safe to build to. |
| inferred | `24px *(inferred — …)*` | Reasoned to, not read. The derivation is stated. |
| estimated | `~24px *(estimated — …)*` | Never backticked. |
| contested | `**contested** — dom: 24px vs screenshot: 22px` | Both candidates, neither settled. |
| unknown | `**not determined**` | A gap, stated as a gap. |
| proposed | `**Proposed:** …` | Marked before the content. |

**The backtick is doing real work.** An agent reading a prompt treats a backticked token
as a literal to copy. The estimated rendering deliberately never produces one, so a value
that could not support being copied exactly cannot be copied exactly by accident.

Every rendered claim also carries its evidence ids, the source kinds behind it, and its
confidence — on the same line. A caveat on a different line from its claim gets separated
the first time anybody quotes the prompt.

## Three structural rules

**The adaptation triad.** Every important mapping in an adaptation prompt states what was
measured, what the brief asks for, and the operation between them. All three appear even
when the brief is silent — *"none stated"* is information, and a mapping missing the leg
would look like it followed from the reference alone.

**Proposals are marked first.** In an improvement prompt every proposal opens with
`**Proposed:**`. A trailing "(proposed)" is read after the sentence has already landed as
a statement of fact, which is exactly the failure it is meant to prevent.

**Implementation notes make no claims.** Everything measured lives in the prompt they
accompany. A finding in the notes would be a finding in a file nothing validates as
evidence.

## Acceptance criteria

Every implementation prompt states criteria a reviewer can check. Two kinds of evidence
produce no criterion at all, and say so rather than being quietly omitted:

- **Unknown** — a criterion here would test a number nobody established.
- **Contested and critical** — a criterion would assert whichever candidate happened to
  be chosen.

An estimated value produces a *degraded* criterion: "approximately 12px — verify by eye,
not by pixel". Building to an estimate at pixel tolerance is building to a guess at a
precision the evidence never had.

## Stacks

One adapter is implemented: Next.js / React / TypeScript / Tailwind. Everything else is
refused rather than approximated — see [STACK-ADAPTERS.md](STACK-ADAPTERS.md). A prompt
containing plausible-looking Svelte for a stack nobody implemented is worse than one
containing none, because the reader cannot tell which parts were checked.

## Related

- [PROMPT-CONTRACT.md](PROMPT-CONTRACT.md) — the four contracts, section by section
- [PROMPT-LINT.md](PROMPT-LINT.md) — every rule, its severity, and whether it blocks
- [STACK-ADAPTERS.md](STACK-ADAPTERS.md) — the implemented adapter and what it cannot express
- [ARTIFACTS.md](ARTIFACTS.md) — how prompts fit the wider artifact registry
- [MODES.md](MODES.md) — which mode produces which prompt
