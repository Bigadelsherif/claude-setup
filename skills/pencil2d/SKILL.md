---
name: pencil2d
description: Pencil2D, the open-source 2D hand-drawn / frame-by-frame animation app. Covers rendering projects from the command line (pencil2d -o/--export with --width, --height, --start, --end, --camera, --transparency to PNG/JPG/TIFF/BMP/WebP sequences or MP4/AVI/WebM/GIF/APNG via ffmpeg), the .pclx project format (ZIP with main.xml plus data/ PNG and .vec keyframes) and legacy .pcl, generating or editing Pencil2D projects with scripts (e.g. a .pclx from a folder of PNGs), and app concepts (layer types, keyframes and exposure, onion skin, camera motion and easing, import/export). Use when the user mentions Pencil2D, .pclx or .pcl files, frame-by-frame animation in Pencil2D, exporting a Pencil2D animation from the command line, or generating Pencil2D projects.
---

# Pencil2D

Pencil2D (https://www.pencil2d.org, source https://github.com/pencil2d/pencil) is a Qt app for
traditional frame-by-frame animation with bitmap and vector layers, a camera layer and sound.
Latest release: v0.7.2 (March 2026). Everything below was checked against the upstream source
(the CLI and file-format code are identical in `v0.7.2` and `master`).

## Reference files

| File | Read when |
|---|---|
| [references/command-line.md](references/command-line.md) | rendering/exporting from a terminal or script, ffmpeg, Windows invocation |
| [references/pclx-format.md](references/pclx-format.md) | reading, writing or generating `.pclx`/`.pcl`, main.xml, `.vec`, camera keys |
| [references/app-concepts.md](references/app-concepts.md) | explaining GUI features: layers, exposure, onion skin, camera easing, import/export menus |
| [references/gotchas.md](references/gotchas.md) | before shipping a generated project or an export pipeline; limits table |
| [scripts/png_folder_to_pclx.py](scripts/png_folder_to_pclx.py) | turn a folder of PNG frames into a `.pclx` (stdlib only) |

## Command-line export (quick reference)

```
pencil2d <project.pclx|.pcl> -o <output> [-o <output2> ...]
         [--camera <layer name>] [--width N] [--height N]
         [--start N] [--end N|last|last-sound] [--transparency]
```

These are all the options (`app/src/commandlineparser.cpp`); plus `-h/--help`, `-v/--version`,
and a hidden `--export-sequence` alias of `-o`. Without `-o` the GUI opens instead.

- Format from the output extension: `.png .jpg/.jpeg .tif/.tiff .bmp .webp` = image sequence;
  `.mp4 .avi .webm .gif .apng` = movie through ffmpeg. Unknown/no extension = PNG sequence.
- Sequence naming: `-o out/walk_.png` writes `out/walk_0001.png`, `walk_0002.png`, ... (frame number,
  4-digit padded, extension stripped then re-added).
- Defaults: size = camera layer size; start = 1; end = last keyframe; camera = last camera layer;
  fps (movies) = project fps (no CLI option).
- `--transparency` works for PNG/TIFF/WEBP sequences only; movies always get a white background
  from the CLI.
- ffmpeg is looked up only at `<app dir>/plugins/ffmpeg(.exe)` on Windows/macOS (Linux also
  checks `PATH`). Official builds ship it.

Windows (installer default): `C:\Program Files\Pencil2D\pencil2d.exe`. It is a GUI-subsystem app,
so use `Start-Process -Wait` in PowerShell (example in command-line.md), then confirm the output
exists.

```bash
"/c/Program Files/Pencil2D/pencil2d.exe" shot.pclx -o render/shot.mp4 --width 1920 --height 1080 --end 96
```

### Must-know CLI behaviour

1. "Done." and exit code 0 do **not** prove success: export errors (no ffmpeg, odd MP4 size) are
   ignored. Check the files.
2. Close the Pencil2D GUI first: if an instance is open, the CLI shows a modal warning and, on the
   default answer, exits without exporting.
3. `--end last` stops at the last keyframe; a held final drawing gets cut. Pass `--end`.
4. Keep `--width/--height` in the camera's aspect ratio (it stretches otherwise) and even for MP4.
5. CLI GIFs do not loop and APNGs play once; use the GUI export dialog or post-process with ffmpeg
   if you need loop control.

## The .pclx format (quick reference)

ZIP archive (the loader only unzips files whose suffix is `.pclx`):

```
mimetype           application/x-pencil2d-pclx (stored, first; optional on load)
main.xml           <!DOCTYPE PencilDocument> <document><projectdata/><object>layers</object></document>
data/palette.xml   optional colour palette (vector colours index into it)
data/002.001.png   bitmap key: layer id 2, frame 1  ("%03d.%03d.png")
data/003.001.vec   vector key                         ("%03d.%03d.vec")
data/sound_*.wav   sound clips
```

Legacy `.pcl` = the same XML as a plain file, with keyframes in `<name>.pcl.data/`.

`main.xml` essentials:

```xml
<projectdata><fps value="24"/></projectdata>
<object>
  <layer id="1" name="Camera Layer" visibility="1" type="5" width="1920" height="1080">
    <camera frame="1" dx="0" dy="0" r="0" s="1"/>              <!-- optional easing="0..40" -->
  </layer>
  <layer id="2" name="Ink" visibility="1" type="1">             <!-- 1 bitmap, 2 vector, 4 sound, 5 camera -->
    <image frame="1" src="002.001.png" topLeftX="-960" topLeftY="-540" opacity="1"/>
  </layer>
  <layer id="3" name="Lines" visibility="1" type="2">
    <image frame="1" src="003.001.vec" opacity="1"/>
  </layer>
  <layer id="4" name="Audio" visibility="1" type="4">
    <sound frame="1" src="sound_20260101_120000_000.wav" name="dialogue.wav"/>
  </layer>
</object>
```

Key facts:

- Frames are 1-based. A keyframe holds until the next keyframe on its layer.
- Canvas origin is the camera centre; `topLeftX/Y` (integers) place the PNG's top-left pixel. A
  W x H image centred on the camera has `topLeft = (-W/2, -H/2)`.
- Layer order in `<object>`: first = bottom of the stack.
- Camera key `dx/dy` translate the canvas: the point (-dx, -dy) is at frame centre; `r` degrees,
  `s` zoom; `easing` index applies from this key to the next.
- Layer ids must be unique; `src` must be relative inside `data/`. Missing files load as empty
  frames with no error.

Full schema, `.vec` structure, easing table and a hand-written minimal project:
[references/pclx-format.md](references/pclx-format.md).

## Generating a project from PNG frames

```bash
python ~/.claude/skills/pencil2d/scripts/png_folder_to_pclx.py frames/ shot.pclx --fps 24 --hold 2
python ~/.claude/skills/pencil2d/scripts/png_folder_to_pclx.py frames/ shot.pclx --camera 1920x1080
```

Creates one camera layer (id 1, sized to the first PNG unless `--camera`) and one bitmap layer
(id 2) with each PNG as a keyframe every `--hold` frames, centred like Pencil2D's own image
import. It prints the `--end` value to use if the last image is held.

Workflow for generated projects:

1. Generate frames (any tool) as PNGs, ideally at camera size with transparency where wanted.
2. Run the script (or write `main.xml` yourself following pclx-format.md).
3. Sanity-check: `python -c "import zipfile;z=zipfile.ZipFile('shot.pclx');print(z.namelist())"`.
4. Render with the CLI, passing `--end`, and verify the outputs exist. Or open the file in Pencil2D
   to keep animating by hand.

## Editing an existing project

Unzip to a folder, change `main.xml` (add layers/keys, change `fps`, camera size, camera keys) and
`data/` files, then re-zip with `main.xml` and `data/` at the archive root. Pencil2D normalises
file names and auto-crops bitmaps on its next save, so expect changed `src` names and `topLeft`
values after a round trip through the app.

## App concepts (one-liners)

- **Layers**: bitmap (raster), vector (Bezier strokes; colours tied to palette swatches), camera
  (pan/rotate/zoom keys, interpolated with selectable easing), sound (clips starting at a frame).
- **Exposure**: how many frames a drawing is held; Add/Subtract Exposure adjusts selected keys.
- **Onion skin**: previous frames tinted red, next frames blue; counts and opacity in the Onion
  Skin options.
- **Import**: Image, Image Sequence (with "every # frame" spacing), Image Predefined set (frame from
  the number in the filename), Animated Image (GIF/WebP), Movie Video and Movie Audio (ffmpeg),
  Sound, Layers from Project file, palettes.
- **Export**: Image, Image Sequence (keyframes-only option), Movie (MP4/AVI/WebM/APNG with loop and
  WebM/APNG transparency), Animated GIF, Palette.

Details: [references/app-concepts.md](references/app-concepts.md).

## Limits

Timeline and movie import up to frame 9999; FAQ recommends staying under ~1500 frames per file;
fps box 1-90; camera 1-10000 px per side; GUI movie export refuses 63+ sound clips. See
[references/gotchas.md](references/gotchas.md) for the full list with sources.

## Not verified / out of scope

- No live Pencil2D run was done when writing this skill; behaviour comes from reading source.
- The Windows console/wait behaviour of `pencil2d.exe` is inferred from it being a Qt GUI build.
- Headless Linux rendering (`QT_QPA_PLATFORM=offscreen`) is a standard Qt approach, untested here.
- There is no scripting/plugin API inside Pencil2D; automation means generating files and the CLI.
