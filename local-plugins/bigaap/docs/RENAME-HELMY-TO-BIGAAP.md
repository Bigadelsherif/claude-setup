# Rename: Helmy → Bigaap

Completed 2026-08-20. This records what changed, what deliberately did not, and
how to reverse it.

## Identifiers

| Role | Old | New |
| --- | --- | --- |
| Product name | Helmy | **Bigaap** |
| Project folder | `Jobs/Helmy-Website-Analyzer` | `Jobs/Bigaap` |
| npm / plugin package | `helmy-ui-forensics` | `bigaap-ui-forensics` |
| Marketplace | `helmy` | `bigaap` |
| CLI binary | `helmy` | `bigaap` |
| CLI entry point | `bin/helmy.mjs` | `bin/bigaap.mjs` |
| Inline bundle | `dist/helmy-inline.js` | `dist/bigaap-inline.js` |
| Project state dir | `.helmy-analyzer/` | `.bigaap-analyzer/` |
| Artifact vendor namespace | `helmy.dev` | `bigaap.dev` |
| Artifact provenance key | `$helmy` | `$bigaap` |
| Generated-file marker | `helmy:ir-hash` | `bigaap:ir-hash` |
| Extractor ids | `helmy/extract`, `helmy/probe`, `helmy/screenshot` | `bigaap/…` |
| In-page globals | `__HELMY_EXTRACT__`, `__HELMY_PROBE__`, `__HELMY_IO__` | `__BIGAAP_…__` |
| Web interface | `Jobs/helmy-studio` (`helmy-studio`) | `Jobs/bigaap-studio` (`bigaap-studio`) |
| Studio env vars | `HELMY_ROOT`, `HELMY_STUDIO_RUNS`, `HELMY_STUDIO_HISTORY` | `BIGAAP_…` |

### Identifier format constraint

The plugin name is not free-form. Claude Code installs by
`<plugin-name>@<marketplace-name>`, and both must be lowercase kebab-case, with
the plugin name matching `.claude-plugin/plugin.json` and the npm `name` field.
`bigaap-ui-forensics@bigaap` satisfies that; a capitalised "Bigaap" would not.
The product name stays `Bigaap` everywhere a human reads it.

## What was deliberately NOT renamed

| Path | Reason |
| --- | --- |
| `~/.claude/plugins/cache/helmy/helmy-ui-forensics/0.1.0` | The installed plugin. A renamed build must not be installed globally until local verification passes — it now has, so installing is a separate, deliberate step. |
| `Jobs/helmy-plugin-backups/` | Rollback backups of the pre-rename build. Renaming a backup destroys the thing that makes it a backup. |
| `~/.claude/projects/…-Helmy-Website-Analyzer/` | Session transcripts and user memory. User data, not project-owned. |
| `bigaap-studio/.runs/history.json.pre-rename.bak` | Pre-repair copy of the run history, kept as a backup. |

## Consequence worth knowing

The project state directory moved from `.helmy-analyzer/` to
`.bigaap-analyzer/`. **No migration was added**, because adding one would be a
behaviour change and this was a rename. Any existing project directory holding a
`.helmy-analyzer/` folder will not be found by this build; rename that folder by
hand, or re-run `bigaap init`.

## Golden outputs

Artifacts stamp the tool's own name into every file they emit, so byte-identical
output and a full artifact-label rename cannot both hold. Equivalence was proved
instead: each analyze/recreate output was rewritten back to the old brand and
compared structurally against the pre-rename run. All ten matched. The only
residual differences were

- content-derived hashes (`irHash`), which follow the branded content they cover;
- key order, because artifacts serialise keys sorted and `$bigaap` sorts before
  `$extensions` where `$helmy` sorted after it;
- one `generatedAt` wall-clock timestamp.

No coverage, confidence, threshold or evidence value changed. `live-smoke`
independently reports the full extraction as byte-identical to its pre-migration
golden apart from timestamps.

## Regenerating what is generated

Run in this order — the report tools rewrite their own docs, so the manifest,
which hashes everything, must be rebuilt last.

```bash
node tools/generate-command-docs.mjs && node tools/build-inline-bundle.mjs && node tools/release-audit.mjs && node tools/live-smoke.mjs && node bin/bigaap.mjs package --write
```

## Rollback

A verified copy of both projects as they were before the rename:

```
C:\Users\bigo_\Desktop\Jobs\rename-rollback-20260820-205150\
  Helmy-Website-Analyzer\   1242 files
  helmy-studio\               36 files
```

To reverse:

```bash
rm -rf "/c/Users/bigo_/Desktop/Jobs/Bigaap" "/c/Users/bigo_/Desktop/Jobs/bigaap-studio" && cp -r "/c/Users/bigo_/Desktop/Jobs/rename-rollback-20260820-205150/Helmy-Website-Analyzer" "/c/Users/bigo_/Desktop/Jobs/helmy-studio" "/c/Users/bigo_/Desktop/Jobs/"
```

The sibling directories renamed alongside the projects
(`bigaap-analysis-work`, `bigaap-plugin-clean`) are reversed with a plain
rename back to `helmy-analysis-work` and `helmy-plugin-clean`.
