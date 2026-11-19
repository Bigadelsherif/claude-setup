---
name: synfig
description: Synfig Studio, the open-source 2D vector animation app (synfig.org). Covers the `synfig` command-line renderer (exact options, targets such as png, png-spritesheet, ffmpeg/MP4, gif; PNG sequence naming; codec/bitrate rules), the .sif XML format (canvas attributes, layers and their params, waypoints and interpolation, exported values in defs, groups), .sifz (gzip) and .sfg (zip container) files, generating or editing .sif files with Python, Synfig Studio Python plugins (plugin.xml, menu/importer/exporter scripts) and the bundled Lottie exporter, plus bones/skeleton rigging and Studio concepts (animate mode, keyframes, waypoints). Use when the user mentions Synfig or Synfig Studio, .sif/.sifz/.sfg files, rendering a Synfig file from the command line, generating 2D vector animation as Synfig documents, bones or skeleton rigging in Synfig, or writing Synfig plugins.
---

# Synfig

Synfig Studio is a GPL 2D vector animation program. Documents are XML (`.sif`), gzip XML
(`.sifz`) or a ZIP container (`.sfg`). `synfig` (the CLI) renders them; Synfig Studio is the
GUI editor. Current releases: **1.4.5** (May 2024) and **1.5.x** (1.5.5, Mar 2026). Facts here
were checked against the v1.5.5 source tree and synfig-docs; differences from 1.4 are noted.

## Windows setup (user platform)

- CLI: `C:\Program Files\Synfig\bin\synfig.exe` (installer default). Bundled ffmpeg:
  `C:\Program Files\Synfig\bin\ffmpeg.exe`. Not on PATH by default.
- Git Bash: `SYNFIG="/c/Program Files/Synfig/bin/synfig.exe"; "$SYNFIG" file.sif ...`
- PowerShell: `& "C:\Program Files\Synfig\bin\synfig.exe" file.sif ...`
- User plugins: `%USERPROFILE%\Synfig\plugins\`. Bundled plugins:
  `C:\Program Files\Synfig\share\synfig\plugins\`.
- First check the install: `"$SYNFIG" --version`, `--targets`, `--layers`.

## Render quick reference

```bash
"$SYNFIG" scene.sif --canvas-info all                       # load/parse check, prints info
"$SYNFIG" scene.sif -t png --time 1s -o still.png           # one frame
"$SYNFIG" scene.sif -t png -o frames/out.png                # sequence: out.0000.png, out.0001.png ...
"$SYNFIG" scene.sif -t ffmpeg --video-codec libx264 --video-bitrate 8000 -o out.mp4
"$SYNFIG" scene.sif -t gif -o out.gif
"$SYNFIG" scene.sif -t png -w 1920 -h 1080 -T 8 -q -o frames/hd.png
```

Key rules (details in `references/cli.md`):
- Input is the positional argument (or `-i`). `-o` output, `-t` target (guessed from the `-o`
  extension, else `png`). Always pass `-t` to be explicit.
- `-w`/`-h` width/height in px (`-h` is **height**, not help; use `--help`). Same aspect keeps
  framing. `-a` antialias 1..30, `-T` threads, `-c id` render an exported canvas.
- Times: `--time`, `--begin-time`/`--start-time`, `--end-time`, `--fps`. Time strings need units
  (`"1s"`, `"12f"`, `"1s 12f"`); **a bare number is frames**.
- **No `--quality`/`-Q` option** (commented out in source). It is `--targets`, not
  `--list-targets`.
- ffmpeg target: give `--video-codec` and `--video-bitrate` **together** (else error); without
  them it encodes mpeg1video at 200 kbit/s. Codecs: libx264, libx264-lossless, libvpx,
  libvpx-vp9 (keeps alpha), mpeg4, mjpeg, huffyuv, libtheora, flv, wmv1/2, ... For full control
  render PNGs and run ffmpeg yourself.
- Targets that exist: `png, png-spritesheet, ffmpeg, gif, jpeg, bmp, ppm, openexr, mng,
  yuv420p, dv, imagemagick, magick++, libav, null, null-tile` (build-dependent). No vector SVG
  export; for vector web output use the Lottie exporter.
- Image sequences: `<name>.<NNNN>.<ext>`, separator changeable with `--sequence-separator`.
- Non-alpha outputs (most video codecs, GIF) composite over the canvas `bgcolor`; PNG keeps
  transparency. Put a `solid_color` layer at the bottom for a guaranteed background.

## .sif essentials

```xml
<?xml version="1.0" encoding="UTF-8"?>
<canvas version="1.2" width="480" height="270" view-box="-4 2.25 4 -2.25"
        fps="24" begin-time="0f" end-time="2s" bgcolor="1 1 1 1">
  <defs><color id="ink"><r>0.1</r><g>0.1</g><b>0.15</b><a>1</a></color></defs>
  <layer type="solid_color" version="0.1" desc="BG">          <!-- bottom -->
    <param name="color"><color><r>0.96</r><g>0.95</g><b>0.92</b><a>1</a></color></param>
  </layer>
  <layer type="circle" version="0.2" desc="Ball">             <!-- drawn on top -->
    <param name="color" use="ink"/>
    <param name="radius"><real value="0.5"/></param>
    <param name="origin">
      <animated type="vector">
        <waypoint time="0s" before="clamped" after="clamped"><vector><x>-3</x><y>0</y></vector></waypoint>
        <waypoint time="2s" before="clamped" after="clamped"><vector><x>3</x><y>0</y></vector></waypoint>
      </animated>
    </param>
  </layer>
</canvas>
```

- Coordinates are **units**, y up, view-box `"tl_x tl_y br_x br_y"`. Pixels per unit =
  `width / (br_x - tl_x)`: **60 only for the default** 480 px over 8 units. For 1920x1080 at
  60 px/unit use `view-box="-16 9 16 -9"`.
- **First `<layer>` in a canvas is the bottom**, last is the top. Transform layers (translate,
  rotate, zoom, stretch) and filters (blur) affect only layers below them in the same canvas.
- Values: `<real value>`, `<integer value>`, `<bool value>`, `<angle value>` (degrees),
  `<time value>`, `<vector><x/><y/></vector>`, `<color><r/><g/><b/><a/></color>`, `<string>`.
- Animation: `<animated type="...">` with `<waypoint time before after>`. Interpolation XML
  names: `clamped`, `auto` (TCB), `linear`, `halt` (Ease In/Out), `constant`.
- Links: export in `<defs>` with `id`, reference with `use="id"`. Groups (`type="group"`) hold
  an inline `<canvas>` in their `canvas` param plus a `transformation` composite (offset,
  angle, skew_angle, scale — all four required).
- Splines (`region`, `outline`, `advanced_outline`) use `<bline>` entries of
  `<composite type="bline_point">` with all 8 links (point, width, origin, split, t1, t2,
  split_radius, split_angle).
- Write `version="1.2"` (1.5.x) or `"1.1"` (what 1.4.x writes). `"1.0"`/`"0.x"` make the loader
  apply legacy gamma 2.2 to colours.
- Wrong param names/types only warn ("rejected value") and keep defaults; malformed XML,
  undefined `use` ids, or missing composite links make the file fail to load.
- `.sifz` = gzip of the same XML. `.sfg` = ZIP with `project.sifz` + `images/`.

Full format: `references/sif-format.md`. Layer types and params: `references/layers.md`
(confirm on the installed version with `synfig --layer-info <type>`).

## Generating files with Python

Use `scripts/sif_builder.py` (stdlib only) to build documents, then lint with
`scripts/check_sif.py`, then let Synfig load/render. Reference document:
`assets/bouncing-ball.sif`. Workflow and editing tips: `references/generating.md`.

```bash
python ~/.claude/skills/synfig/scripts/sif_builder.py demo.sif
python ~/.claude/skills/synfig/scripts/check_sif.py demo.sif
"$SYNFIG" demo.sif --canvas-info all && "$SYNFIG" demo.sif -t png --time 1s -o check.png
```

Always look at a rendered still before rendering a full animation.

## Plugins (Synfig Studio)

A plugin is a folder with `plugin.xml` + a Python 3 script. Menu plugins get the path of a
saved `.sif` copy as `argv[1]`, edit it in place, and Studio reloads it. Exporters get
`(sif, output_path)`; importers get `(input_file, temp_sif_to_write)`. Python: env
`SYNFIG_PYTHON_BINARY`, else the bundled `<install>/python/python.exe` on Windows.
1.5.x adds `modify_doc`, `current_time`, `selected_layers` attributes and optional `.ui`
dialogs. The bundled **Lottie exporter** (File > Export, `.json`/`.html`) can also run
standalone: `python lottie-exporter.py in.sif out.json` (needs `lxml`). Details, plugin.xml
reference and a sample plugin: `references/plugins.md`.

## Studio concepts and bones

Animate Editing Mode records waypoints; keyframes are pose markers used with Lock Keyframes;
each waypoint has In/Out interpolation. Bones: Skeleton layer (vector artwork, Link to Bone /
Link to Skeleton) and Skeleton Deformation layer (raster mesh warp); Skeleton Tool (Alt+O,
1.5.0+). Rigs are built in Studio; scripts can then animate bone parameters in the saved file.
See `references/studio-concepts.md`.

## Gotchas checklist

1. Time strings without a unit are frames (`"2"` = 2 frames). Write `s`/`f`.
2. Layer order: file order is bottom-to-top.
3. Units, not pixels; y axis points up; Studio's UI shows pixels by default.
4. Angles in degrees; `zoom` layer `amount` is exponential (e^amount; 0 = 100%).
5. MP4 needs `--video-codec libx264 --video-bitrate N` (both).
6. `bgcolor` shows only in non-alpha outputs; use a background layer.
7. Changing aspect ratio with `-w/-h` changes the visible area.
8. Read stderr after rendering generated files: warnings reveal ignored params.
9. Synfig might not be installed — check the path before promising a render; if missing, ask
   the user to install it from synfig.org rather than downloading binaries yourself.

## Reference files

| File | Contents |
|---|---|
| `references/cli.md` | Every CLI option, targets, codecs, naming, recipes |
| `references/sif-format.md` | Canvas, layers, values, animation, defs/linking, gotchas |
| `references/layers.md` | Layer type names and parameters with types/defaults |
| `references/generating.md` | Python generation/editing workflow, batch rendering |
| `references/plugins.md` | plugin.xml, invocation, sample plugin, Lottie exporter |
| `references/studio-concepts.md` | Animate mode, keyframes, waypoints, linking, bones |
| `scripts/sif_builder.py` | Builder library + demo |
| `scripts/check_sif.py` | Static linter |
| `assets/bouncing-ball.sif` | Hand-written example document |
