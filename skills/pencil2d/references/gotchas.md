# Pencil2D gotchas and limits (source-verified)

File references are to https://github.com/pencil2d/pencil (`master`, same behaviour in `v0.7.2`
unless noted).

## Frame numbering

- Frames are **1-based** everywhere. `Layer::addNewKeyFrameAt` rejects positions <= 0, bitmap frame
  getters assert `frameNumber >= 1`, the CLI resets `--start` < 1 to 1, and new layers get their
  first key at frame 1. Never write `frame="0"`.
- Image-sequence export names use the timeline frame number, 4-digit padded (`name0001.png`), so
  `--start 25` produces `name0025.png` first, not `name0001.png`.
- A keyframe holds until the next keyframe on the same layer. Two `<image>` elements with the same
  `frame` on one layer: the later one replaces the earlier (`Layer::loadKey`).

## Positions and sizes

- Canvas origin (0,0) is the centre of the default camera field; y points down. `topLeftX/Y` are
  integers (parsed with `toInt`). Centred W x H picture: `-W/2, -H/2` (C++ integer division:
  `-(W//2)` in Python for odd sizes).
- Camera field: `QRect(-width/2, -height/2, width, height)`. The camera layer **must** have `width`
  and `height` attributes; missing ones load as 0 and the CLI then renders a 0x0 image.
- Camera `dx/dy` is the translation applied to the canvas: the canvas point (-dx, -dy) is shown at
  the frame centre. Moving the camera right means decreasing dx.
- `s` (zoom) must be > 0 (asserted in `Camera`).
- Export size different in aspect from the camera stretches the picture (no letterboxing).
- Pencil2D auto-crops bitmap keyframes when saving, so a re-saved project has smaller PNGs with
  shifted `topLeft` values. Do not assume saved PNGs are camera-sized.

## Loading rules

- `.pclx` is only unzipped if the extension is `.pclx`; `main.xml` and `data/` must be at the ZIP
  root. The `mimetype` entry is optional (`tests/data/empty.pclx` has none).
- `main.xml` needs `<!DOCTYPE PencilDocument>` and root `<document>` containing `<object>`.
- No XML comments (or other non-element nodes besides whitespace) inside `<projectdata>`: the
  parsing loop in `FileManager::loadProjectData` never advances past them and Pencil2D hangs.
- Layer `type` must be 1, 2, 4 or 5. Anything else hits `Q_UNREACHABLE` (crash / undefined).
- Layer `id`s must be unique: keyframe files are named after them.
- `src` must be relative and resolve inside `data/` (`validateDataPath`); otherwise the key is
  skipped. A `src` that points to a missing file loads as an **empty frame without any error**
  (`empty.pclx` references a PNG that is not in the archive). Verify every referenced file exists.
- `.vec` files need `<!DOCTYPE PencilVectorImage>` and `<image type="vector">`.
- Vector `colourNumber` indexes `data/palette.xml` (or the built-in default palette). Changing or
  dropping the palette recolours vector art.
- Projects without a camera layer get one on load (size from the user's saved camera preference,
  else 800x600) - CLI output size then depends on that machine's settings. Always include one.
- On save Pencil2D renames keyframe files to `%03d.%03d.png|vec` (layer id and frame, zero-padded to at least 3 digits), writes
  `palette.xml`, a `<version>` element and the `mimetype` entry. Opening a file saved by a newer
  version only logs a warning.

## Command-line export

- `--end` defaults to `last` = last keyframe position (camera and drawing layers; sounds only with
  `last-sound`). Held drawings after the final key are cut; pass `--end` explicitly.
- The CLI prints "Done." and exits 0 even if the movie or image export failed (status is ignored).
  Check the output files.
- If the Pencil2D GUI is already running, a release build shows a modal warning; the default
  answer exits 0 **without exporting**.
- `--transparency` only affects PNG/TIFF/WEBP sequences. For movies it prints a warning and renders
  a white background, even for WebM/APNG (the GUI can do transparent WebM/APNG).
- GIF from the CLI does not loop; APNG plays once. There is no flag to change this.
- MP4 uses `yuv420p`: odd `--width`/`--height` makes ffmpeg fail (silently, see above).
- TIFF: pass `.tiff`. With `-o x.tif` the files become `x.tif0001.tiff`.
- No fps option: movie fps comes from `<fps>` in the project.
- Missing ffmpeg (`plugins/ffmpeg.exe` next to `pencil2d.exe` on Windows) breaks MP4/AVI/WebM/GIF/APNG
  but not image sequences.
- Output folders are not created for you.

## Limits

| Limit | Value | Source |
|---|---|---|
| Timeline length / movie import end | 9999 frames | `MaxFramesBound` in `pencildef.h`; `timelinepage.cpp`; `movieimporter.cpp` |
| Recommended max per file | ~1500 frames | FAQ (memory) |
| FPS (timeline box) | 1-90 | `timecontrols.cpp` |
| Camera size (dialog) | 1-10000 px each side | `camerapropertiesdialog.ui` |
| Sound clips for movie export | GUI refuses at >= 63 | `MovieExporter::MAX_SOUND_FRAMES`, `actioncommands.cpp` |
| Onion skin frames | up to 60 | user manual |
| Movie import prompt | asks above 200 frames | `movieimporter.cpp` |

Values outside the UI ranges can be written into `main.xml`; the loader does not clamp them, but
behaviour there is untested.
