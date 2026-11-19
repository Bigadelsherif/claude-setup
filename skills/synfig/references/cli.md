# `synfig` command-line renderer

Verified against `synfig-core/src/tool/optionsprocessor.cpp`, `joblistprocessor.cpp`,
`main.cpp` at tag **v1.5.5** (identical option set on `master`, Nov 2026) and v1.4.5.

## Binary location

| Platform | Path |
|---|---|
| Windows installer default | `C:\Program Files\Synfig\bin\synfig.exe` (NSIS `InstallDir "$PROGRAMFILES64\Synfig"`, tool goes in `$INSTDIR\bin`) |
| Windows ffmpeg used by the ffmpeg target | `C:\Program Files\Synfig\bin\ffmpeg.exe` (bundled; the target looks next to `synfig.exe` first) |
| Linux/macOS | `synfig` on PATH (distro/AppImage/app bundle) |

In Git Bash: `"/c/Program Files/Synfig/bin/synfig.exe"`. In PowerShell:
`& "C:\Program Files\Synfig\bin\synfig.exe" ...`.

## Syntax

```
synfig [options] <input.sif|.sifz|.sfg> [options]
```

The first non-option argument is the input file (or pass `-i FILE`). Running `synfig` with no
arguments prints usage and exits with an error code.

## Settings options

| Option | Short | Argument | Meaning |
|---|---|---|---|
| `--target` | `-t` | module | Output target. If omitted, guessed from the `-o` extension; if still unknown, `png`. |
| `--output-file` | `-o` | filename | Output path. If omitted: input name with the target's default extension. |
| `--input-file` | `-i` | filename | Input path (alternative to the positional argument). |
| `--width` | `-w` | NUM | Output width in px (0 = file default). If only one of w/h is given, the other is scaled to keep aspect. |
| `--height` | `-h` | NUM | Output height in px. **`-h` is height, not help** — use `--help`. |
| `--span` | `-s` | NUM | Diagonal size of the image window, in units. |
| `--antialias` | `-a` | 1..30 | Antialias amount for the parametric renderer (a*a samples/px). |
| `--threads` | `-T` | NUM | Number of render threads. |
| `--renderer` | | string | Rendering engine id (list with `--renderers`). 1.5.x only. |
| `--sequence-separator` | | string | Separator before the frame number in image sequences (default `.`). |
| `--canvas` | `-c` | id | Render an exported child canvas (by id) instead of the root. |
| `--fps` | | NUM | Override frame rate. |
| `--time` | | time | Render a single frame at this time (e.g. `"1s"`, `"0s 6f"`, `"30f"`). |
| `--begin-time` / `--start-time` | | time | Override start time. |
| `--end-time` | | time | Override end time (e.g. `"1m 10s 12f"`). |
| `--dpi`, `--dpi-x`, `--dpi-y` | | NUM | Physical resolution (metadata). |
| `--repeats` | | NUM | Render the same job N times (benchmarking). 1.5.x only. |

In v1.4.x the help text for the time options says "seconds"; the value is parsed as a Synfig
time string in both versions (see "Time strings" below).

**There is no `-Q`/`--quality` option.** It is commented out in the source; quality is fixed at
the tool default (`DEFAULT_QUALITY 2`).

## Switches

| Option | Short | Meaning |
|---|---|---|
| `--verbose` | `-v` NUM | Verbosity level (e.g. `-v 2`). |
| `--quiet` | `-q` | No progress / time-remaining output. |
| `--benchmarks` | `-b` | Print render timings. |
| `--extract-alpha` | `-x` | Two outputs: the image with alpha reduced, plus a `-alpha`-suffixed alpha matte. |

## Misc

| Option | Meaning |
|---|---|
| `--append FILE` | Append the layers of FILE on top of the composition before rendering. |
| `--canvas-info FIELDS` | Print canvas details and exit. FIELDS is comma-separated, or `all`. Valid: `time_start, time_end, frame_rate, frame_start, frame_end, w, h, image_aspect, pw, ph, pixel_aspect, tl, br, physical_w, physical_h, x_res, y_res, span, interlaced, antialias, clamp, flags, focus, bg_color, metadata`. |
| `--canvases` | List exported child canvases and exit. |

`--canvas-info all` is a cheap **load/parse check**: any XML or parse error makes the file fail
to load ("Unable to load file") with `file:<element>:line: error:` messages on stderr.

## FFmpeg target options

| Option | Meaning |
|---|---|
| `--video-codec CODEC` | Codec for the `ffmpeg` target. |
| `--video-bitrate N` | Bitrate in kbit/s. |

**Both must be given together** or the tool aborts ("Both video codec and bitrate parameters are
necessary."). Allowed codecs (hard-coded list; `--target-video-codecs` prints it):
`flv, h263p, huffyuv, libtheora, libx264, libx264-lossless, mjpeg, mpeg1video, mpeg2video,
mpeg4, msmpeg4, msmpeg4v1, msmpeg4v2, wmv1, wmv2, libvpx, libvpx-vp9`.

Without these options the ffmpeg target uses **`mpeg1video` at 200 kbit/s** (low quality, even
for `.mp4`). For MP4 always pass `--video-codec libx264 --video-bitrate <N>`.

- `libx264-lossless` = libx264 with `-qp 0 -tune fastdecode`.
- Alpha is kept only for codecs `libvpx-vp9` (from the CLI list); all others are rendered in
  "fill" mode, i.e. composited over the canvas `bgcolor`.
- Audio: if the document has Sound layers, the target exports a temporary WAV and muxes it
  (PCM). `.gif`/`.mng` outputs get no audio.

## Info options (print and exit)

`--help`, `--version`, `--info` (build info), `--license`, `--layers` (layer type names),
`--layer-info NAME` (param names/descriptions of one layer type), `--modules`, `--targets`,
`--renderers` (1.5.x), `--target-video-codecs`, `--valuenodes` (converter type names),
`--importers`.

Note: it is `--targets`, not `--list-targets`. `--layer-info circle` is the authoritative way to
check a layer's parameter names on the installed version.

## Targets

Registered in `synfig-core/src/modules/*/main.cpp` (+ `synfig/target.cpp`). What exists in a
given build depends on which modules were compiled — run `synfig --targets` to confirm.

| Target (`-t`) | Default ext | Notes |
|---|---|---|
| `png` | png | Single image, or numbered sequence for an animation. Keeps alpha. |
| `png-spritesheet` | png | All frames in one sheet. Layout params (rows/columns/direction) are not exposed on the CLI. |
| `ffmpeg` | mpg | Pipes frames to ffmpeg. Extension map: avi, flv, mkv, mpg, mpeg, mp4, ogv, rgb, wmv, yuv. |
| `gif` | gif | Native animated GIF writer (palette). |
| `jpeg` | jpg | Also maps `.jpeg`. |
| `bmp` | bmp | |
| `ppm` | ppm | |
| `openexr` | exr | |
| `mng` | mng | |
| `yuv420p` | yuv | Raw YUV. |
| `dv` | dv | Needs external encodedv. |
| `imagemagick` | miff | Via ImageMagick; maps many exts (jpg, tif, tga, psd, pdf, eps, svg, ...). |
| `magick++` | gif | Via Magick++. |
| `libav` | - | libavcodec target (if built). |
| `null`, `null-tile` | - | Render and discard (built into core) — useful for timing/validation. |

There is **no vector SVG export target**; `.svg` maps to ImageMagick (raster). For vector web
output use the Lottie exporter plugin (see `plugins.md`).

Extension guessing (`-o out.mp4` without `-t`) uses the extension map, where later-loaded modules
can overwrite earlier ones. Pass `-t` explicitly to be deterministic.

## Output naming for animations

When `end-time > begin-time`, image targets write one file per frame:
`<name><separator><4-digit frame>.<ext>` — e.g. `-o out.png` gives `out.0000.png`,
`out.0001.png`, ... Frame numbers start at the start frame. Change the separator with
`--sequence-separator _` (gives `out_0000.png`). Render one frame with `--time`.

## Size and framing

`-w/-h` keep the view-box framing when the aspect ratio is unchanged (the canvas is loaded with
the image span locked), so `-w 1920 -h 1080` on a 480x270 file renders the same picture at 4x.
A different aspect ratio changes the visible area.

## Time strings

Parsed by `synfig::Time(const String&, fps)` (`synfig-core/src/synfig/time.cpp`):
- Units: `h`, `m`, `s`, `f` (frames), combinable with spaces: `"1m 10s 12f"`, `"2.5s"`, `"48f"`.
- `HH:MM:SS` and `HH:MM:SS.FF` (FF = frames) also accepted.
- `SOT`/`BOT` = start of time, `EOT` = end of time.
- **A bare number with no unit is FRAMES** (when fps is known) with a warning: `"2"` = 2 frames,
  not 2 seconds. Zero is fine without unit. Always write a unit.

## Recipes

```bash
SYNFIG="/c/Program Files/Synfig/bin/synfig.exe"   # Git Bash on Windows

# Validate / inspect
"$SYNFIG" scene.sif --canvas-info all
"$SYNFIG" --layer-info advanced_outline

# Single still at 1s, 1920x1080
"$SYNFIG" scene.sif -t png --time 1s -w 1920 -h 1080 -o still.png

# PNG sequence (frames/out.0000.png ...), 8 threads, quiet
mkdir -p frames
"$SYNFIG" scene.sif -t png -o frames/out.png -T 8 -q

# Same, underscore separator and a sub-range
"$SYNFIG" scene.sif -t png -o frames/f.png --sequence-separator _ --begin-time 12f --end-time 2s

# MP4 (H.264) through the bundled ffmpeg
"$SYNFIG" scene.sif -t ffmpeg --video-codec libx264 --video-bitrate 8000 -o out.mp4

# WebM with alpha
"$SYNFIG" scene.sif -t ffmpeg --video-codec libvpx-vp9 --video-bitrate 4000 -o out.webm

# Animated GIF
"$SYNFIG" scene.sif -t gif -o out.gif

# Sprite sheet
"$SYNFIG" scene.sif -t png-spritesheet -o sheet.png
```

For best control over MP4 encoding (CRF, pixel format, audio), render a PNG sequence and encode
with ffmpeg yourself:

```bash
ffmpeg -framerate 24 -i frames/out.%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4
```

PowerShell equivalent:

```powershell
& "C:\Program Files\Synfig\bin\synfig.exe" scene.sif -t png -o frames\out.png -q
```

## Exit behaviour

Parse errors abort the job ("Unable to load file 'x'"). Non-fatal warnings (e.g. a layer
"rejected value for parameter" because of a wrong type/name) are printed and the parameter keeps
its default — read stderr after every render of generated files.
