# The prompt contract

**Generated from `src/prompts/contract.mjs` by `node tools/generate-command-docs.mjs`.**

A prompt is the one artifact that leaves this system and becomes somebody else's
instructions. Every other output is read by a person who can go back and check the
evidence; a prompt is handed to an agent that acts on it literally.

That asymmetry is why quality here is **structural** rather than editorial. A style
guide saying "avoid vague adjectives" is advice nobody can enforce and everybody
drifts from. A contract naming sixteen required sections, and a linter that refuses a
prompt missing one, is enforceable — and what it enforces is that the caveats travel
with the instructions rather than being left in a report nobody opened.

## What every prompt states about itself

Before it instructs, a prompt states these — in this order:

- **What was analyzed**
- **Requested mode**
- **Source kind**
- **Evidence status**
- **Coverage**
- **Generated**
- **Limitations**
- **Next**
- **Target stack**
- **Required inputs**
- **Implementation constraints**
- **Unsupported assumptions**

The first eight are the standard artifact header, shared with every human-readable
artifact. The last four are prompt-specific: a reader deciding whether to act on
instructions needs to know what stack they assume, what they need supplied, what
constrains them, and what they are **not** allowed to assume.

## The four contracts

| Prompt | Modes | Sections | Requires a brief | Refused on |
| --- | --- | --- | --- | --- |
| `rebuild-prompt` | recreate, extend | 16 | no | screenshots evidence |
| `adaptation-prompt` | adapt | 12 | yes | screenshots evidence |
| `improvement-prompt` | improve | 11 | no | — |
| `implementation-notes` | recreate, adapt, extend | 4 | no | — |

### `rebuild-prompt`

Instructions to rebuild the measured system.

| # | Section | Contains |
| --- | --- | --- |
| 1 | Objective | derived from reference evidence by a stated rule |
| 2 | Reference evidence | what was measured on the reference |
| 3 | Page structure | what was measured on the reference |
| 4 | Design tokens | what was measured on the reference |
| 5 | Typography | what was measured on the reference |
| 6 | Layout and grid | what was measured on the reference |
| 7 | Components | what was measured on the reference |
| 8 | Component states | what was measured on the reference |
| 9 | Responsive behavior | derived from reference evidence by a stated rule |
| 10 | Motion | what was measured on the reference |
| 11 | Accessibility | derived from reference evidence by a stated rule |
| 12 | Assets and brand boundaries | a standing rule, not derived from this analysis |
| 13 | Technical implementation | derived from reference evidence by a stated rule |
| 14 | Acceptance criteria | derived from reference evidence by a stated rule |
| 15 | Evidence limitations | what was measured on the reference |
| 16 | Forbidden assumptions | a standing rule, not derived from this analysis |

### `adaptation-prompt`

Instructions to apply the measured system to a different product.

| # | Section | Contains |
| --- | --- | --- |
| 1 | Objective | derived from reference evidence by a stated rule |
| 2 | Reference design system | what was measured on the reference |
| 3 | Target product brief | what the target brief asks for — never a measurement |
| 4 | Target information architecture | what the target brief asks for — never a measurement |
| 5 | Preserved design principles | derived from reference evidence by a stated rule |
| 6 | Changed content anatomy | derived from reference evidence by a stated rule |
| 7 | Brand and asset replacement | a standing rule, not derived from this analysis |
| 8 | Implementation requirements | derived from reference evidence by a stated rule |
| 9 | Responsive behavior | derived from reference evidence by a stated rule |
| 10 | Accessibility | derived from reference evidence by a stated rule |
| 11 | Acceptance criteria | derived from reference evidence by a stated rule |
| 12 | Limitations | what was measured on the reference |

**Every important mapping states all three legs:**

- **Reference evidence** — What was measured on the reference.
- **Target requirement** — What the brief asks for, or that it says nothing.
- **Adaptation instruction** — The operation between them, stated rather than implied.

Including when the brief says nothing: *"none stated"* is information. A mapping
that omitted the leg would look like it followed from the reference alone.

### `improvement-prompt`

What is there, what is weak about it, what could be done, and what nobody knows.

| # | Section | Contains |
| --- | --- | --- |
| 1 | Observed reference behavior | what was measured on the reference |
| 2 | Evidence supporting the observation | what was measured on the reference |
| 3 | UX strengths | derived from reference evidence by a stated rule |
| 4 | UX critique | derived from reference evidence by a stated rule |
| 5 | Proposed improvements | a suggestion — never a description of the reference |
| 6 | Reasoning for proposals | a suggestion — never a description of the reference |
| 7 | What must remain unchanged | what was measured on the reference |
| 8 | Implementation requirements | derived from reference evidence by a stated rule |
| 9 | Accessibility | derived from reference evidence by a stated rule |
| 10 | Acceptance criteria | derived from reference evidence by a stated rule |
| 11 | Unknowns | what was measured on the reference |

**Every proposal opens with `**Proposed:**`.** The marker comes first — a
trailing "(proposed)" is read after the sentence has already landed as a statement
of fact, which is exactly the failure it is meant to prevent.

These four are kept structurally apart: **Observed reference behavior**, **UX critique**, **Proposed improvements**, **Unknowns**.

### `implementation-notes`

How the chosen stack expresses values measured elsewhere. Contains no findings.

| # | Section | Contains |
| --- | --- | --- |
| 1 | Stack | a standing rule, not derived from this analysis |
| 2 | Token mapping | a standing rule, not derived from this analysis |
| 3 | What this stack cannot express exactly | a standing rule, not derived from this analysis |
| 4 | What this does not decide | a standing rule, not derived from this analysis |

**This file makes no claims about the reference.** Everything measured lives in the
prompt it accompanies. A finding here would be a finding in a file nothing validates
as evidence.

## What no prompt may contain

### A vague adjective with no measurement, evidence reference or labelled interpretation beside it.

It is then the only instruction, and every reader resolves it differently. The build that comes back is not wrong so much as unrelated.

### A contested critical value rendered as one exact number.

Two sources disagreed and the prompt picked one silently. Nothing downstream says a decision was made, so nobody can revisit it.

### A screenshot estimate rendered the way a measured value is.

It will be built to the tolerance of a measurement, which the evidence never supported.

### A build-generated selector offered as an implementation hook.

It is valid until the reference's next deploy. A build wired to one breaks silently, and the breakage looks like a bug in the new code.

### An instruction to correct components automatically.

Component matching across two builds is an open permanent limitation (def_0030). An automatic correction would act on a match nothing verified.

### A logo, brand name, proprietary copy, distinctive illustration or photograph copied from the reference.

The reference is an analysis target, not a source of assets. Copying its identity is the one failure mode with a legal shape as well as a technical one.

### A product requirement that came from neither the evidence nor a target brief.

It reads identically to a measured one, and there is no way for the builder to tell which parts of the prompt somebody actually decided.

### An unknown value silently replaced by a plausible default.

A gap that announces itself gets a decision. A gap filled with 16px gets built.

## Vague language

These are not banned outright. An adjective carrying visual intent is genuinely
useful — "low visual density" tells a builder something a padding value does not.
What is banned is an adjective standing **alone**, because then it is the only
instruction and every reader resolves it differently.

The rule: keep the adjective, pair it with the measurement.

**Refused:**

> Use a modern, spacious card design.

**Accepted:**

> Use a card with 24px internal padding, 12px radius, a 1px border, and a 24px
> vertical gap. The reference presents the card group with low visual density;
> preserve this through the measured spacing rather than adding unspecified
> decoration.

A statement counts as supported when it carries a number, an evidence reference, a
backticked literal, or an explicit interpretation label.

**Terms checked:** `modern`, `clean`, `generous`, `subtle`, `soft`, `sleek`, `elegant`, `minimal`, `spacious`, `rounded`, `smooth`, `polished`, `premium`, `crisp`, `airy`, `refined`, `beautiful`, `professional`, `sophisticated`, `tasteful`, `balanced`, `harmonious`, `striking`, `bold`, `large`

**Phrases checked:** `generous whitespace`, `subtle shadow`, `rounded cards`, `large typography`, `clean design`, `modern look`, `modern feel`, `plenty of space`, `nice spacing`, `good contrast`, `appropriate sizing`
