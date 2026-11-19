# `bigaap init`

Creates a project. Launches no browser, fetches nothing, analyses nothing.

```bash
bigaap init --reference https://example.com
```

That writes `.bigaap-analyzer/` beside you: six configuration files, a README,
and five empty directories. See [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md)
for the layout and [CONFIGURATION.md](CONFIGURATION.md) for what each file
governs.

---

## What it will not do

**It will not fabricate.** There are no placeholder analysis artifacts, no
sample evidence, no example IR. The directories are empty because nothing has
been measured, and a directory of plausible-looking placeholders would be worse
than an empty one — you would eventually read one as real.

**It will not write your target brief.** `target-brief.json` is a template and
is **deliberately not schema-valid**. Every required field says
`REQUIRED — replace this text`, and until you do, `adapt` and `extend` report
`requires-user-input` (exit 6) rather than running.

That is the single most deliberate decision in this command. A template that
validated would let `adapt` describe a product nobody described, and the output
would look exactly as confident as one written from a real brief.

**It will not overwrite your configuration.** A re-run adds what is missing and
preserves what exists. Replacing a file requires `--force`, and the result names
every file it replaced.

**It will not create parent directories.** `--dir ./typo/path` fails rather than
quietly scattering a project into a mistyped location.

**It will not rename your project to make it work.** An unusable name is
refused with the reason. Silently sanitising it would mean your project is
called something you did not choose.

---

## Options

| Option | Purpose |
| --- | --- |
| `--reference <url>` | The reference to analyse. Without it the project is `incomplete` rather than ready, and says so. |
| `--name <string>` | Project name. Defaults to the directory name. |
| `--stack <name>` | Stack adapter. `next-tailwind` is the only implemented one; another name is refused, never substituted. |
| `--dir <path>` | Where to create the project. Must already exist. |
| `--force` | Replace existing configuration. Reports exactly what it replaced. |
| `--non-interactive` | Fail rather than prompt. Every answer must be a flag. |
| `--json` | Emit the result contract instead of the summary. |

---

## Behaviour, case by case

| Situation | Result | Exit |
| --- | --- | --- |
| Empty directory | Creates everything. `completed-with-warnings` if no reference was given or the brief is a template. | 0 |
| Existing valid project | Creates nothing, preserves everything. Idempotent. | 0 |
| Existing incomplete project | Creates only the missing files. Existing ones untouched. | 0 |
| Existing invalid project | Preserves the invalid file, reports it as a conflict with its reason. | 0 |
| Unrelated files present | Reported so you know they were seen. Untouched. | 0 |
| Re-running | Safe. Adds what is missing; changes nothing else. | 0 |
| `--force` | Replaces existing files and names each one. | 0 |
| Invalid project name | Refused with the reason. Nothing created. | 1 |
| Missing parent directory | Fails. Does not create it. | 1 |
| Path is a file | Fails. | 1 |
| Filesystem failure | Fails, reporting what had already been written so a partial project is visible. | 1 |

Initialization is **idempotent** wherever it can be. The only non-idempotent
path is `--force`, which is what you asked for.

---

## The result

Beyond the standard contract, `init` reports:

`projectPath` · `projectName` · `alreadyExisted` · `filesCreated` ·
`filesPreserved` · `filesSkipped` · `conflicts` · `unrelatedFilesPresent` ·
`schemaVersions` · `configurationStatus` · `projectDeclaredStatus` ·
`targetBriefStatus` · `directoriesCreated` · `analysisArtifactsCreated` ·
`nextRecommendedCommand`

Two of those are similarly named and answer different questions, so both are
reported:

- **`configurationStatus`** — the roll-up over *required* files. Is the project
  readable and consistent?
- **`projectDeclaredStatus`** — what `project.json` says about its own
  completeness. Has a reference been chosen?

`analysisArtifactsCreated` is always `[]`. It is reported rather than omitted so
the absence is a stated fact rather than something you have to notice.

---

## After init

```bash
bigaap blockers --for analyze
```

That tells you what would stop a run **without capturing anything**. If you
plan to use `adapt` or `extend`, fill in `target-brief.json` first and check it:

```bash
bigaap blockers --for adapt
```

---

## What a project cannot do

Stated here as well as in the project's own README, because a limitation only
found after you have committed to a workflow is a limitation found too late:

- **Authenticated pages.** No command accepts credentials, and none bypasses a
  consent gate, a CAPTCHA or a bot check. A scope decision, not a gap.
- **Automatic component-level correction.** A permanent limitation
  (`def_0030`). The fidelity policy schema refuses to enable it.
- **Unattended execution.** A project directory is not concurrency-safe.
