# Repository cleanup record

Explicit, recorded removals of files that do not belong in the repository.

A file is not deleted here because it looks like junk. It is deleted after its
path, size and hash are recorded, after it is confirmed not to be managed, and
after it is confirmed not to reach the package — so that the removal can be
reviewed later by someone who no longer has the file.

---

## 2026-08-14 — stray root file from a mangled shell command

### Identity, recorded before removal

| | |
| --- | --- |
| Repository-relative path | `console.log('down'))` |
| Absolute path | `C:\Users\bigo_\Desktop\Jobs\Bigaap\console.log('down'))` |
| Type | Regular file. Not a directory, not a symlink |
| Size | **0 bytes** |
| Content | `""` — empty |
| SHA-256 | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Last modified | 2026-08-13T21:59:06.778Z |

The hash is the canonical SHA-256 of empty input, which independently confirms
the file held nothing.

### Origin

A shell command whose closing fragment `console.log('down'))` was interpreted as
a redirection target rather than as part of the command. The name is the
fragment verbatim, which is what makes the origin identifiable: no tool in this
repository writes a file with parentheses and a quote in its name.

### Confirmed not managed

- **Not in the package manifest.** 226 managed files; this is not one of them.
- The only root-level managed files are `ARCHITECTURE.md`, `README.md` and
  `package.json`, each named individually in `INCLUDED`.
- No `INCLUDED` entry can reach it: the directory entries are
  `.claude-plugin`, `commands`, `agents`, `skills`, `src`, `bin`, `schemas` and
  `docs`, and a root-level file is in none of them.

### Confirmed excluded from the package

It never reaches the package — but it is worth being precise about *why*, because
the two gates are not equally responsible here:

| Gate | Verdict |
| --- | --- |
| Allowlist (`INCLUDED`) | **Excludes it.** No included directory contains it, and it is not one of the three named root files |
| Denylist (`EXCLUDED`) | `isExcluded()` returns `false` — no rule matches it |

So it is kept out by the allowlist alone. That is the allowlist doing exactly
its job, and it is also the reason the denylist is not sufficient on its own:
nobody would have thought to write a rule matching this name. The two-gates-in-
series design is what makes an unanticipated root-level file safe by default.

Verified by test 23 of `tests/phase59-install.test.mjs`, which asserts that no
user data, secret, workspace or unmanaged file reaches the manifest.

### Action taken

Removed as an explicit repository-cleanup action, after the record above was
written. Not removed by `bigaap uninstall`, which reports unmanaged files and
leaves them in place — deleting a file the tool did not create is not something
the tool does.

### Verification after removal

The repository root was re-listed and compared against the expected set. Result
recorded in [PHASE-5.10-RESULTS.md](PHASE-5.10-RESULTS.md).
