# Uninstall

```bash
node bin/helmy.mjs uninstall
```

Dry run by default. **Removes only plugin code by default.** Your analysis
work, your brief, your corrections and your outputs are preserved unless you
name them.

## The six categories

Each is selected separately. Bundling them behind one flag would mean a user who
wanted the code gone lost their analysis history to the same keystroke, and the
two decisions are nothing alike.

| Category | What it is | Default | Irreversible | Recovery |
| --- | --- | --- | --- | --- |
| `plugin-code` | The installed plugin files | **removed** | no | Reinstall |
| `project-config` | `.helmy-analyzer/` — settings, policies, **your target brief** | kept | **yes** | Nothing recovers a brief you wrote |
| `generated-outputs` | `output/` — prompts and specs | kept | no | Re-run the analysis; every output is a regenerable projection |
| `analysis-evidence` | Captures, evidence maps, IR — what was measured | kept | **yes** | Only by re-capturing, and the reference may have changed |
| `correction-history` | `feedback/corrections/` — what you corrected and why | kept | **yes** | Nothing. This is an append-only record of your decisions |
| `observability-events` | `.helmy-observability/` — local diagnostics | kept | **yes** | Nothing, and nothing describing your work is lost — these are durations and status codes |

## The dry-run report

Shows what goes, what stays, what is unmanaged, the size of each, and which
operations cannot be undone:

```
Dry run. Nothing was removed.

Would remove:
  plugin-code            219 file(s), 2334.9 KB
      The installed plugin files themselves.

Would preserve:
  project-config         3 file(s), 1.2 KB
      .helmy-analyzer/ — project settings, policies and your target brief.
  correction-history     7 file(s), 14.0 KB
      feedback/corrections/ — what you corrected, and why.
  …

Unmanaged, left in place (1):
  package-manifest.json — present but not in the manifest

Total to remove: 219 file(s), 2334.9 KB
```

A report that lists only what it will delete leaves you to work out what
survives, which is the question you actually have.

## Confirming a destructive removal

Every irreversible category must be confirmed **by name**:

```bash
node bin/helmy.mjs uninstall \
  --remove plugin-code,correction-history \
  --apply --confirm correction-history
```

A blanket `--confirm` is refused. Saying yes to removing plugin code is not
consent to losing a correction history.

A **partial** confirmation refuses in full — it does not perform the part you
confirmed:

```
uninstall: requires-user-input
  not confirmed for: project-config. Each irreversible category must be confirmed by name.
```

Exit code 6.

## Unmanaged files

Anything at the plugin root that the manifest does not claim is **reported and
left in place**, never removed. Something is there that this build did not put
there, and deleting it during an uninstall is how a tool takes something that
was never its to take.

## Removing everything

There is no single flag for it, deliberately. Name each category:

```bash
node bin/helmy.mjs uninstall \
  --remove plugin-code,project-config,generated-outputs,analysis-evidence,correction-history,observability-events \
  --apply \
  --confirm project-config,analysis-evidence,correction-history,observability-events
```

Read the dry run first.

## Related

- [INSTALLATION.md](INSTALLATION.md)
- [DATA-RETENTION.md](DATA-RETENTION.md) — clearing observability events specifically
- [PACKAGING.md](PACKAGING.md) — which files are managed
