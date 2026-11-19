# Project files and programmatic generation

Verified against `src/app/evfileio.cpp`, `src/app/GUI/mainwindow.cpp`,
`src/app/eimporters.h`, `src/core/ReadWrite/{evformat.h,filefooter.cpp,ewritestream.cpp}`,
`src/core/XML/*` on `main` and tag `v1.0.0-rc.3`, plus the Usage docs page.

## Formats

| Extension | Status | Notes |
|-----------|--------|-------|
| `.friction` | Current project format | Binary. Same "ev" stream format as enve, new extension. |
| `.ev` | Legacy enve projects | rc.3: Open/Save accept `.friction` **or** `.ev`. `main`: Open/Save only `.friction`; `.ev` can still be brought in via File > Import (the importer loads its scenes). |
| `.xev` | Dead | Zip of XML (`mimetype` = `application/enve`, `UI/layouts.xml`, thumbnail). Reader/writer exist in `src/core/XML/` but every entry point is commented out (`eXevImporter::supports()` returns false). Do not rely on it. |

The Usage docs confirm: "The file is binary so it can not be read with text editors, but
this may change in the future as there are plans to move into a text based project file."

## What is (and is not) inside

- Saved: all scenes (settings + content), keyframes, expressions (stored as their
  bindings / definitions / script strings), layout (canvas/timeline splits), render queue
  widget state.
- Not saved: linked assets. Images, videos, audio and linked SVGs are referenced by path
  (relative paths since format 21). Keep the project and its assets together.
- Backups: Preferences option "Backup on save" writes `<project>.friction_backup/backup_N.friction`.
  Optional autosave timer exists (`files/AutoSave`, `AutoSaveTimeout`).

## Binary layout (enough to inspect, not to author)

Written by `MainWindow::saveToFile()` with `eWriteStream` (raw native-endian ints/doubles,
Qt strings, `qCompress` blocks for some data, checkpoints and a "future table" of
forward offsets). File ends with a fixed footer (`FileFooter::sWrite`):

```
... content ...
int32   EvFormat version          (little-endian on x86/x64/ARM64)
char[15] "enve ev"   (NUL padded)
char[15] "enve"
char[15] "0.9.0"
```

So the format version is the int32 at `filesize - 49`.

Format versions (`EvFormat` enum): 28 markers, 29 svgBeginEnd, 30/31 formatOptions,
32 subPathOffset, 33 avStretch, **34 grid (max readable by v1.0.0-rc.3)**,
**35 v100 (written by `main` / development snapshots)**.

Opening a newer file shows "Unsupported project version" and refuses. Opening an older
file warns that behaviour may differ; saving it upgrades the file so older Friction
versions can no longer open it.

Read the version without opening Friction (Python, run with `-I`):

```python
import struct, sys
with open(sys.argv[1], "rb") as f:
    f.seek(-49, 2)
    ver, tag = struct.unpack("<i15s", f.read(19))
print("format", ver, tag.rstrip(b"\0").decode())   # e.g. format 34 enve ev
```

## Can projects be generated programmatically?

**Not practically.** There is no published schema, no scripting/automation API, no
command-line import/export, and the stream is a hand-rolled serialization of the internal
object tree whose layout changes with every format version. Writing a valid `.friction`
would mean reimplementing `eWriteStream` plus every `prp_writeProperty_impl` in the C++
tree. Do not attempt to hand-craft or patch `.friction` bytes.

### What can be generated (all plain text, verified formats)

1. **SVG assets** - generate shapes, groups, gradients and text as SVG, then File > Import
   (or drag-drop, or paste SVG markup from the clipboard with Shift+Ctrl+V). Imported SVG
   becomes editable Friction paths/groups; animation is then added in the GUI. Supported
   SVG elements are listed in import-export.md. SMIL animation inside an imported SVG is
   **not** read.
2. **Expression presets** (`.fexpr`, INI) - drop into `%LOCALAPPDATA%\friction\Expressions`
   and restart. Lets you ship reusable motion logic (see expressions.md).
3. **Render output profiles** (`.conf`, INI) - drop into `%LOCALAPPDATA%\friction\OutputProfiles`.
   Example (bundled `001-friction-preset-mp4-h264.conf`):
   ```ini
   [output_profile_v1]
   audio_enabled=false
   format=mp4
   name=MP4 Video
   video_bitrate=9000000
   video_codec=libx264
   video_enabled=true
   video_pixel_format=yuv420p
   video_profile=-99
   ```
4. **Shader effects** (`.gre` XML + `.frag` GLSL) - custom raster effects (shader-effects.md).
5. **Image sequences / video / audio** - render frames elsewhere and import a folder as an
   image sequence, or import video/audio files.

If the end goal is a web animation that must be produced by code, consider writing the
SVG+SMIL (or CSS/JS animation) directly instead of round-tripping through Friction.
