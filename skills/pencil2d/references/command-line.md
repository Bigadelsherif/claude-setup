# Pencil2D command line (export / render)

Verified against `app/src/commandlineparser.cpp`, `app/src/commandlineexporter.cpp`,
`app/src/pencil2d.cpp`, `core_lib/src/util/fileformat.cpp`, `core_lib/src/movieexporter.cpp`,
`core_lib/src/structure/object.cpp` (`exportFrames`/`exportIm`), `core_lib/src/util/util.cpp`
(`ffmpegLocation`) and the shipped zsh completion `app/data/_pencil2d`. The CLI code is identical in
tag `v0.7.2` (latest release, March 2026) and `master` (Nov 2026).

## Synopsis

```
pencil2d [options] [input]
```

- `input` (positional): the `.pclx` or `.pcl` project. Without any `-o`, the GUI opens it.
- With one or more `-o`, Pencil2D runs headlessly: opens the project, renders, exits. No GUI window.

## Options (complete list; nothing else exists)

| Option | Argument | Meaning / behaviour in source |
|---|---|---|
| `-h`, `--help` | | Qt help text |
| `-v`, `--version` | | version |
| `-o`, `--export` | `output_path` | Render to this path. **Repeatable**: every `-o` is rendered in the same run. Format chosen from the extension. |
| `--export-sequence` | `output_path` | Hidden backwards-compat alias of `-o`. |
| `--camera` | `layer_name` | Name of the camera layer to render through. Not found: warning, falls back. Default: the **last** camera layer in the layer list. |
| `--width` | integer | Output width. Default: camera layer width. Non-integer: warning, ignored. |
| `--height` | integer | Output height. Default: camera layer height. |
| `--start` | frame | First frame. Default 1. Values < 1 are reset to 1 with a warning. |
| `--end` | frame, `last`, `last-sound` | Last frame (inclusive). Default `last`. `last` = highest keyframe position over all non-sound layers (camera layer included). `last-sound` = same, also counting the end of sound clips. `end < start` is clamped to `start`. |
| `--transparency` | (flag) | Transparent background for **image sequences** only (PNG/TIFF/WEBP). JPG/BMP force it off. For any movie format it only prints "Transparency is not currently supported in movie files". |

## Output formats (by extension, case-insensitive)

From `detectFormatByFileNameExtension` + `isMovieFormat`:

| Extension | Kind | Notes |
|---|---|---|
| `.png` | image sequence | default if extension missing/unknown (warning "Using PNG") |
| `.jpg`, `.jpeg` | image sequence | always opaque (white background) |
| `.tif`, `.tiff` | image sequence | files are written with `.tiff` (see naming) |
| `.bmp` | image sequence | always opaque |
| `.webp` | image sequence (static WebP per frame) | needs Qt's WebP image plugin in the build |
| `.mp4` | movie via ffmpeg | `-pix_fmt yuv420p`, so width and height must be even |
| `.avi` | movie via ffmpeg | `-q:v 5` |
| `.webm` | movie via ffmpeg | |
| `.gif` | animated GIF via ffmpeg | `palettegen`/`paletteuse`; from the CLI it does **not loop** (`-loop -1`) |
| `.apng` | animated PNG via ffmpeg | from the CLI `-plays 1` (plays once) |

Movie/GIF/APNG frame rate = the project's `fps` (from `main.xml` `<projectdata><fps value>`). There
is no CLI fps option. Sound layers (visible ones) are mixed into the movie by ffmpeg.

### Image-sequence file naming

`exportFrames` strips the extension, then appends the frame number zero-padded to 4 digits plus the
canonical extension:

```
-o C:\out\shot.png    ->  C:\out\shot0001.png, shot0002.png, ...
-o C:\out\shot_.png   ->  shot_0001.png ...         (add your own separator)
-o C:\out\shot.tif    ->  shot.tif0001.tiff ...     (only ".tiff" is stripped; use .tiff)
```

Frames past 9999 simply get more digits. The output directory must already exist.

### Rendering details

- Background is white unless `--transparency` (image sequences only).
- Hidden layers (`visibility="0"`) are not rendered. Hidden sound layers are not mixed.
- Size: the camera rectangle is mapped onto the whole output with `QPainter::setWindow`, so an
  output aspect ratio different from the camera's **stretches** the image. Keep `--width/--height`
  proportional to the camera size.
- Camera motion/rotation/zoom keys are applied (interpolated) per frame.

## ffmpeg dependency

Movie, GIF and APNG export (and movie/audio *import*) shell out to ffmpeg (`ffmpegLocation()`):

- Windows: `<app dir>\plugins\ffmpeg.exe` only (the official installer ships it there:
  `util/installer/pencil2d.wxs` installs `plugins\ffmpeg.exe`).
- macOS: `<Pencil2D.app>/Contents/MacOS/plugins/ffmpeg`.
- Linux: `<app dir>/plugins/ffmpeg`, `<app dir>/../plugins/ffmpeg`, then `ffmpeg` on `PATH`.

Image sequences need no ffmpeg.

## Windows

- Installer path: `C:\Program Files\Pencil2D\pencil2d.exe` (`ProgramFiles6432Folder\Pencil2D`, exe
  name `pencil2d.exe`; nightly builds use `Pencil2D Nightly\pencil2d-nightly.exe`). Portable ZIP:
  wherever it was unpacked; `plugins\ffmpeg.exe` must sit next to the exe.
- The installer registers an "App Paths" entry, so `start pencil2d` resolves, but call the full path
  in scripts.
- It is a Qt GUI application, so a shell may not wait for it or show its console text (inferred
  from the build config, not tested). Use `Start-Process -Wait` and capture output to files:

```powershell
$exe = "C:\Program Files\Pencil2D\pencil2d.exe"
$p = Start-Process -FilePath $exe -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput "$env:TEMP\p2d-out.txt" -RedirectStandardError "$env:TEMP\p2d-err.txt" `
      -ArgumentList '"C:\work\walk.pclx"', '-o', '"C:\work\render\walk.mp4"', '--width', '1920', '--height', '1080'
"exit $($p.ExitCode)"; Get-Content "$env:TEMP\p2d-out.txt", "$env:TEMP\p2d-err.txt"
Test-Path "C:\work\render\walk.mp4"
```

Git Bash / cmd equivalent: `"/c/Program Files/Pencil2D/pencil2d.exe" walk.pclx -o render/walk.mp4`.

## Examples

```bash
# PNG sequence, transparent, frames 1-48, camera size
pencil2d walk.pclx -o render/walk_.png --transparency --start 1 --end 48

# Several outputs in one run (shared --start/--end/--width/--height/--camera)
pencil2d walk.pclx -o render/walk.mp4 -o render/walk.gif -o render/frames/walk_.png

# Half-size preview through a specific camera layer, up to the end of the sound
pencil2d walk.pclx -o preview.mp4 --camera "Camera Layer" --width 960 --height 540 --end last-sound
```

## Behaviour that bites (all from source)

1. **"Done." does not mean success.** `exportMovie`/`exportImageSequence` ignore the exporter's
   status: missing ffmpeg, odd MP4 size or an ffmpeg error still print "Done." and exit 0. Always
   check that the output exists (and is non-empty).
2. **Exit codes:** 0 after a completed run; 1 if no input path was given with `-o` or the project
   failed to open (error title/description/details go to stderr).
3. **Another Pencil2D instance open** (release builds): the CLI tries a lock file
   (`<AppData>/Pencil2D/pencil2d-process.lock`); if the GUI is running it shows a modal
   "An instance of Pencil2D is already open" box. Choosing Close (the default) exits 0 **without
   exporting**. Close the GUI before scripted exports.
4. **`--end last` ends at the last keyframe.** A drawing held after its keyframe is cut. Pass
   `--end N` explicitly, or put a keyframe on the final frame.
5. The CLI loads a full main window internally; it needs a desktop session. Headless Linux may work
   with `QT_QPA_PLATFORM=offscreen` (standard Qt, not tested here).
6. Known issue listed in the 0.7.0 release notes: CLI export uses more memory than exporting from
   the editor (issue #1117).
7. No CLI option exists for fps, loop, quality/bitrate, keyframes-only export, a single layer, or
   saving/converting projects. Use the GUI export dialog for those, or post-process with ffmpeg.
