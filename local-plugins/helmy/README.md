# Helmy UI Forensics

Reverse-engineers a reference interface into **measured evidence**, then projects
that evidence into implementation-ready prompts.

The problem it solves: most "analyze this site and write me a prompt" tools look
at a screenshot and produce adjectives — *clean, modern, generous whitespace*.
Feed that to a builder and you get a generic template that doesn't resemble the
reference. This measures instead, and enforces the difference mechanically.

> Cards use a 12px border radius `[ev_0072]` — not "cards are nicely rounded".

**Status:** in development, for controlled private use. **Not production-ready,
and no claim to the contrary is made.** Progress is recorded phase by phase in
[`docs/PHASE-5-PROGRESS.md`](docs/PHASE-5-PROGRESS.md); the architecture is in
[`ARCHITECTURE.md`](ARCHITECTURE.md) and what the tool deliberately does not do
is in [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

## Install

Node `>=18.17` and a checkout. **No Docker.**

```bash
node bin/helmy.mjs doctor
node bin/helmy.mjs help
```

A checkout *is* an installation. For a global or project-local Claude Code
plugin, and for upgrade, repair and removal:

| | |
| --- | --- |
| [`docs/INSTALLATION.md`](docs/INSTALLATION.md) | Quick start, the four modes, offline behaviour, troubleshooting |
| [`docs/UPGRADE.md`](docs/UPGRADE.md) | What migrates, what is preserved, what is refused |
| [`docs/UNINSTALL.md`](docs/UNINSTALL.md) | Six categories; your data is kept by default |
| [`docs/REPAIR.md`](docs/REPAIR.md) | Verifying an installation, and `helmy doctor` |
| [`docs/PACKAGING.md`](docs/PACKAGING.md) | What ships, and what never does |
| [`docs/VERSIONING.md`](docs/VERSIONING.md) | Every version this build declares |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | What this build can read |

Live capture additionally needs Playwright and a browser binary. Neither is
installed for you — see [`docs/INSTALLATION.md`](docs/INSTALLATION.md). Everything
else works without them.

## The spine

```
CAPTURE → EVIDENCE → COVERAGE → REGION VERIFICATION → IR → SAFETY GATE → outputs
```

Two rules govern it:

**The IR is the product.** Everything in `output/` is a projection of
`analysis/ir.json` and is regenerated, never edited. To change a claim you
correct the *evidence* and re-project.

**A valid IR is not automatically safe for prompt generation.** Learned from a
real site: every claim validated, carried evidence, and was locally defensible —
and the whole analysis described a navigation menu. Validity asks whether claims
are well-formed; safety asks whether they describe what you asked about.

A run that cannot answer the second question is **blocked**, and blocking is a
successful outcome:

| Status | Prompt generated |
|---|---|
| `usable` | yes |
| `usable-with-warnings` | yes, concerns recorded |
| `insufficient-coverage` | no — partial spec only |
| `unsafe-for-prompt-generation` | no — `blocked-prompt.md` explains why |

Confidence is `provenance × coverage`. A perfectly-read measurement of the wrong
page region earns no confidence at all.

## Try it

```bash
node --test tests/
```

131 tests, no network. To capture a live page (Playwright injects through CDP,
so a strict CSP cannot block it):

```bash
node tools/capture-playwright.mjs --url https://example.com --slug example-1440
```

To reproduce the pipeline end to end:

```bash
node bin/helmy.mjs init --source http://localhost:4174/ --out .ui-analysis/demo
node bin/helmy.mjs ingest --workspace .ui-analysis/demo --raw fixtures/raw/fixture-1440.raw.json --probe fixtures/raw/fixture-1440.probe.json
node bin/helmy.mjs analyze --workspace .ui-analysis/demo
node bin/helmy.mjs validate --workspace .ui-analysis/demo
```

To watch the correction loop close — analyse without probe data so the
documented trap fires, then correct it:

```bash
node bin/helmy.mjs init --source http://localhost:4174/x --out .ui-analysis/degraded
node bin/helmy.mjs ingest --workspace .ui-analysis/degraded --raw fixtures/raw/fixture-1440.raw.json
node bin/helmy.mjs analyze --workspace .ui-analysis/degraded    # radius.card = 16px, inferred
node bin/helmy.mjs correct --workspace .ui-analysis/degraded --file fixtures/corrections/corr_0001.json
```

The corrected value propagates to every projection; the superseded evidence is
retained, not deleted.

## Commands

```
helmy init       --source <url> [--out <dir>] [--viewport 1440]
helmy ingest     --workspace <dir> --raw <file> [--probe <file>]
helmy analyze    --workspace <dir> [--mode aggregate-only] [--strict]
helmy validate   --workspace <dir> [--strict]
helmy correct    --workspace <dir> --file <correction.json>
helmy regenerate --workspace <dir>
helmy promote    --workspace <dir> [--id corr_0001]
```

In Claude Code: `/analyze-reference <url>`, `/correct-analysis`, `/validate-analysis`.

## The five statuses

| Status | Means | Confidence base |
|---|---|---|
| `measured` | Read off rendered geometry | 1.00 |
| `observed` | Read from a declared style | 0.95 |
| `inferred` | Pattern across ≥3 samples | 0.75 |
| `estimated` | Reconstructed, never exact | 0.45 |
| `unknown` | Not determined | 0 |

`estimated` and `unknown` never render as exact measurements and never reach the
token file. `unknown` is a legitimate output — a recorded gap tells you what to
check; a silent omission looks like completeness.

## The gates

Seven validation rules run on every analysis. Three matter most:

- **V3** — every claim line carries a value, a status, and an evidence reference.
- **V4** — estimated and unknown values never masquerade as measurements.
- **V6** — every generated file is stamped with the IR hash it came from, so a
  hand-edited or stale output fails validation.

Telling a model to be precise is a suggestion. A gate that refuses to ship an
unannotated claim is a guarantee.

## Ground truth

`fixtures/controlled/` is a page whose every measurement is declared in
`truth.json`. `tests/truth.test.mjs` asserts the pipeline recovers them. It also
contains a deliberate trap — a transparent wrapper at 16px radius over a painted
surface at 12px — that catches the most common real extraction error.

The golden capture in `fixtures/raw/` was produced by an actual browser run
against that fixture. It is never hand-written: fabricating a measurement is the
one thing this project exists to prevent.

## Brand safety

Reproduces the *system* — spacing, type scale, colour roles, layout logic,
interaction patterns. Never reproduces the *identity* — logos, wordmarks, brand
names, proprietary copy, photography, or licensed fonts. Generated prompts carry
an explicit non-goals section saying so.

## Layout

```
commands/     slash commands
agents/       the capture subagent
skills/       the orchestrating skill + reference docs
src/          extract · evidence · ir · project · validate · correct
schemas/      the contracts
fixtures/     controlled ground truth + golden captures + correction records
tests/        101 tests, browser-free
docs/         phase specifications
.helmy-analyzer/  project-local config (read from the HOST project)
```
