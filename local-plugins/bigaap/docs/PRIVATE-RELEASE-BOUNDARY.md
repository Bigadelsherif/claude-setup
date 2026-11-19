# Private-release boundary

What this system is for, what it is not for, and where the edge is.

> **This is not a production automation platform.**
>
> It is an evidence-first analysis tool for controlled private use, run by a
> person who reads its output. It is not a service, not a pipeline component,
> and not something to point at a queue of URLs unattended. Every prompt it
> generates is a draft for a human to review before anything is built from it.

**No claim is made that this system is production-ready.**

---

## Supported workflows

These are exercised end to end by the clean-room suite against an **installed
copy**, not against the checkout.

| Workflow | Notes |
| --- | --- |
| Repository-local installation | The verified path |
| `bigaap doctor` | Nine checks, no browser launched |
| Project initialization | Reports what it created and which paths hold your content |
| Analysis from an existing capture | The offline majority of the tool |
| Screenshot-only analysis | Reduced precision, reported as such |
| Design specification | Projected from the IR |
| Rebuild prompt, **where the gates allow it** | Emitted when the safety gates pass. Missing interactive states are advisory — a warning and a stated limitation — unless `--states` names a non-resting state. See the note below |
| Adaptation prompt | Requires a filled-in target brief |
| Improvement prompt | |
| Readiness and blockers | Fifteen separate decisions, no overall verdict |
| Artifact freshness and verification | |
| Correction proposal and preview | |
| Accepting and rejecting a correction | |
| Correction history | Append-only, never rewritten |
| Recovery inspection | |
| Local diagnostics (`telemetry`) | Off by default, local only |
| Fidelity comparison | Within the tolerance limits below |
| Upgrade, repair, uninstall, packaging | Dry run by default |

### When a rebuild prompt is refused

**Corrected 2026-08-16.** This table previously read *"Blocked without responsive
and state evidence"*, which described a defect as intended behaviour. `def_0046`
established that `recreate` refused every capture in this repository, so the
builder prompt was unreachable through the CLI. The state-default fault was
fixed in Phase 5.15; the original wording and the full account are preserved in
[PHASE-5.10-RESULTS.md](PHASE-5.10-RESULTS.md) §10.

What refuses a prompt today, and what does not:

| | |
| --- | --- |
| Missing hover/focus states | **advisory** — a warning, plus a stated limitation in prompt sections 8, 14, 15 and 16 |
| `--states hover,focus` with no state evidence | **blocking** — an explicit request is refused, never guessed at |
| Primary component anatomy below the threshold | **blocking** |
| A contested critical value | **blocking** |
| An invalid or unreadable artifact | **blocking** |
| Screenshot-only input for `recreate` | **blocking** — the input kind cannot support a rebuild |

A refusal writes `blocked-prompt.md`, which names the gate, the remedy, and
whether re-capturing would change the verdict. It contains no implementation
guidance, deliberately.

## Unsupported workflows

| Workflow | Why |
| --- | --- |
| Authenticated capture | The tool never enters credentials |
| Bypassing CAPTCHA or bot detection | Refused |
| Automatic component-level correction | def_0030: 0.5 recall against a 0.6 bar |
| Cross-implementation component matching | Same |
| Unattended or scheduled execution | Every output needs review |
| Production automation | See the statement at the top |
| Any stack other than `next-tailwind` | Refused, never substituted |
| Figma import/export | Does not exist |
| Collaboration, multi-user, SaaS, billing | Do not exist |
| A hosted dashboard | Does not exist |

## Required user review

**Every generated prompt must be read before anything is built from it.**

Specifically, check:

1. **Claims rendered as approximate.** Only `measured` and `observed` evidence
   renders as an exact value. Anything else is deliberately hedged, and the
   hedge is information.
2. **Coverage and confidence, as a pair.** They are never combined. A high
   confidence over 12% coverage is not a high-confidence result.
3. **`null` scores.** A `null` means no evidence, not a zero.
4. **Unknowns and contested claims.** Both are counted in every result.
5. **Anything the safety gate blocked.** A blocked prompt was blocked for a
   reason the result names.

## Commands safe to use

Read-only, or refuse rather than damage. No browser, no network.

```
version   doctor   help   readiness   blockers   freshness   verify
history   recovery   tasks   package   migrations (dry run)   telemetry status
correction show   correction history
```

## Commands requiring caution

| Command | Why |
| --- | --- |
| `capture`, `reference`, `capture-viewport`, `capture-state` | Launch a browser and fetch a live page |
| `analyze`, `recreate`, `adapt`, `extend`, `improve` | Write artifacts into the workspace |
| `correct`, `correction accept/reject/promote` | Change what the system says |
| `install`, `upgrade`, `repair` with `--apply` | Write files. Dry run without it |
| `uninstall --apply` | Removes files. Preserves your data by default |
| `migrations --apply` | Rewrites configuration. Use `--backup` |
| `telemetry enable` | Starts local recording. Off by default |
| `telemetry export` | Writes a file **you** then choose whether to share |

## Commands that must remain blocked

Not "disabled by a flag" — **absent, or refused by name**:

- Anything performing authentication. There is no `login`.
- Anything applying a component-level correction automatically.
- Anything bypassing bot detection.
- Anything deleting user data without a per-category confirmation by name.
- `--force` on install, upgrade or repair without a backup path is permitted but
  always backs up first regardless.

The command catalog is deliberately free of names that imply capabilities that
do not exist. There is no `fix`, no `apply`, no `deploy`.

---

## Data storage

**Everything is local. Nothing is transmitted. There is no upload path in this
build.**

| What | Where | Removed by |
| --- | --- | --- |
| Project configuration, target brief | `.bigaap-analyzer/` | `uninstall --remove project-config` (confirm by name) |
| Captures, evidence, IR | workspace `analysis/`, `raw/` | `--remove analysis-evidence` (confirm by name) |
| Generated prompts and specs | `output/` | `--remove generated-outputs` |
| Correction history | `feedback/corrections/` | `--remove correction-history` (confirm by name) |
| Local diagnostic events | `.bigaap-observability/` | `telemetry clear --confirm` |

Observability is **off by default**. When enabled it records durations, status
codes, blocker and error **codes**, artifact kinds, hashes and versions — never
URLs, page content, DOM, CSS, screenshots, briefs, prompts, code, cookies or
tokens. Redaction happens at a single choke point on write.

`bigaap init` now tells you which created paths will hold your own content, and
explicitly does **not** write to your `.gitignore` — that file is yours.

## Browser requirements

| | |
| --- | --- |
| Required for | Live capture only |
| Package | `playwright` (a devDependency) |
| Binary | `npx playwright install chromium` — **never run for you** |
| Docker | Not required, not used |

Everything else works with no browser: analysis from existing captures,
validation, prompt generation, corrections, readiness, packaging.

`bigaap doctor` never launches a browser. Browser presence is a filesystem
question with three answers, and *could not determine* is reported as unknown
rather than as no.

## Installation requirements

Node `>=18.17` and a checkout. **No Docker.**

Two installation paths, and they are different mechanisms:

| Path | Command | Produces |
| --- | --- | --- |
| CLI | `bigaap install --mode global --apply` | A working CLI. **Not a loadable plugin** |
| Claude Code plugin | `claude plugin marketplace add ./` + `claude plugin install` | A loadable plugin, verified 2.1.179 |

A version below the requirement is a blocker; an unparseable version string is
*unknown*, not a failure.

## Upgrade requirements

- Dry run by default; `--apply` to perform.
- A file you edited is a **conflict**: named, preserved, exit 3.
- A target brief is never replaced.
- Downgrades are refused unless forced.
- An installation with no manifest is not adopted silently.
- Migrations add or rename; they never reinterpret.

## Recovery behaviour

- A failed install writes **no manifest**, so it cannot look finished.
- `repair` restores what is missing and never overwrites what you edited.
- Every forced replacement is backed up first.
- A malformed correction record is refused **by name and file**, and the rest of
  the analysis proceeds — one bad file cannot make a workspace unusable.
- The live smoke suite refuses to run concurrently (exit 2) rather than
  producing a plausible partial report.

## Correction limitations

- Global values only. Component-level correction is unavailable (def_0030).
- Promotion to a global rule requires **two independent witnesses** or an
  explicit act.
- Promoted rules do not yet affect derivation.
- Correction history is append-only and never rewritten.
- An improvement that costs evidence is not an improvement — `stopOnNewUncertainty`.

## Evidence limitations

- Five statuses: measured, observed, inferred, estimated, unknown. They are not
  interchangeable and are never migrated between.
- Confidence is provenance × coverage, reported as a **pair**.
- Screenshot-only evidence is observed or estimated, never measured.
- Six of seventeen tolerances are not fully validated; one is blocked on
  definition. The register reports this rather than claiming otherwise.
- Region verification can fail, and a failure is reported rather than absorbed.

## Claude Code plugin loading

**Verified 2026-08-14 against Claude Code 2.1.179.** All five components are
discovered. Two things bound it:

**Installation is from a marketplace, not a directory copy.**

```bash
claude plugin validate .
claude plugin marketplace add ./ --scope project
claude plugin install bigaap-ui-forensics@bigaap --scope project
```

`bigaap install --mode global` is a plain CLI installation and does **not**
produce a loadable plugin. The two are separate mechanisms.

**A plugin installation copies the entire source directory** — 1121 files,
47.1 MB here — using neither this repository's package manifest nor its
`.gitignore`. Install from a clean copy, or your own analysis workspaces are
carried into the plugin cache (def_0044).

**Still unverified:** interactive invocation inside a live session. Discovery is
verified; that a command renders as intended in conversation was not driven.

See [PRIVATE-RELEASE-CHECKLIST.md](PRIVATE-RELEASE-CHECKLIST.md) §1 and §6.

## Related

- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)
- [PRIVATE-RELEASE-CHECKLIST.md](PRIVATE-RELEASE-CHECKLIST.md)
- [PHASE-5.10-RESULTS.md](PHASE-5.10-RESULTS.md) — the readiness decisions
