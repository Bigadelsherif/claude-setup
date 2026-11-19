# Import and export

Verified against `src/core/filesourcescache.cpp`, `src/core/actions.cpp`,
`src/app/eimporters.h`, `src/core/svgimporter.cpp`, `src/core/svgexporter.cpp`,
`src/core/svgexporthelpers.cpp`, `src/core/Animators/{graphanimator,qrealanimator,transformanimator}.cpp`,
`src/core/Boxes/boundingbox.cpp`, `src/core/canvasselectedboxesactions.cpp`,
`src/ui/dialogs/exportsvgdialog.cpp`, `src/app/presets/render/*.conf`, and the docs pages
Export, Usage, FAQ and release notes rc.1-rc.3.

## Import

File > Import (Ctrl+I), drag-and-drop onto the canvas, File > Import Image Sequence, or
File > Link (Ctrl+L).

| Kind | Extensions (exact list from source) | Becomes |
|------|-------------------------------------|---------|
| Vector | `svg` | Editable paths/groups (Import) or an external SVG link box (Link) |
| Image | `png jpg jpeg bmp webp` | Image box, always linked (not embedded) |
| Video | `avi mp4 mov mkv m4v webm flv vob wmv 3gp rmvb gif mpeg mpg mp2 mpv` | Video box (decoded by bundled FFmpeg), with its audio |
| Audio | `mp3 wav aiff flac m4a oga` | Sound layer |
| Image sequence | a **folder** of images | Image sequence box |
| Project | `friction`, `ev` | Loads that project's scenes |

ORA (OpenRaster) and other layered formats: importer code exists but is commented out -
not supported. Note `gif` is imported as video.

Assets panel: right-click a linked asset to Reload, Replace or Remove it. Linked SVGs
update when the file changes on disk.

Paste SVG markup from the clipboard: Shift+Ctrl+V (rc.2+).

### SVG import coverage

Elements the importer handles: `svg`, `g`, `defs`, `path`, `rect`, `circle`, `ellipse`,
`line`, `polyline`, `polygon`, `text` / `tspan` (incl. Inkscape `sodipodi:role="line"`),
`linearGradient`, `radialGradient` (`stop`). Not handled (absent from the importer):
`image`, `use`, `symbol`, `clipPath`, `mask`, `pattern`, `filter`, `marker`, and any SMIL
`<animate*>` elements. Flatten/expand those in Inkscape (Object to Path, Unlink Clone,
release clips) before importing.

## SVG + SMIL export (web animation)

File > Export SVG (Shift+F12) opens the dialog; File > Preview SVG (Ctrl+F12) exports the
current scene with default options to the temp folder as an HTML page and opens it in the
default browser. Before export Friction scans the scene and shows warnings for
unsupported items.

### Export dialog options (source: exportsvgdialog.cpp, stored under settings group `exportSVG`)

| Option | Default | Effect |
|--------|---------|--------|
| Scene / First Frame / Last Frame | active scene, scene range | What to export |
| Image format: PNG / JPEG / WEBP + quality % | PNG | Encoding of raster content, embedded as `data:` URIs |
| Background | on | Include scene background color rect |
| Fixed Size | off | Write width/height (docs: "adds width and height to viewBox") |
| Loop | on | `repeatCount="indefinite"`; off = play once and `fill="freeze"` |
| Optimize for Web | off | Built-in optimizer (`src/core/svgo.cpp`, rc.3+; replaced the external SVGO tool). Not applied to previews. |
| Notify when done | on | Popup when finished |
| Mix Blend Modes | on | Writes `style="mix-blend-mode: ..."` for non-normal blend modes |
| SVG 1.1 Colors | off | Hex colors instead of `rgba()` |

### How animation is written

- Animated numeric properties -> `<animate>` / `<animateTransform>` with
  `calcMode="spline"`, `values`, `keyTimes`, `keySplines` derived from the graph-editor
  Bezier curves (segments are split at extrema). Duration = (frames - 1) / fps.
- Follow Path transform effect -> `<animateMotion>` with `<mpath href="#path-id">`,
  optional `rotate="auto"`.
- Visibility ranges -> `<animate attributeName="visibility">`.
- Expressions -> sampled and fitted to keyframes at export time (`QrealAnimator::saveQrealSVG`
  calls `applyExpression` on a copy), so expression-driven motion survives.
- Videos and image sequences -> every frame embedded as a base64 image with visibility
  toggling; files get huge quickly.
- Element `id`s come from object names (filtered); name objects meaningfully if web code
  will target them.
- Interactive playback: each object's transform has hidden "begin event" / "end event"
  properties (enable via right-click > Interactive SVG Properties). Values: none, click,
  dblclick, mousedown, mouseenter, mouseleave, mousemove, mouseout, mouseover, mouseup.
  They become `begin`/`end` attributes on that object's transform animations.

### Support matrix

Docs "Supported features": transforms (translation, rotation, scale, shear, pivot,
opacity), gradients, images, texts, keyframes, graph, expressions, transform effects
(Follow Path), path effects ("trim path and more"), raster assets (images/videos), Blur
effect, Shadow effect, shape morphing, masking (blend mode DstIn and DstOut), mix blend
modes (opt-in).

Warned as unsupported by the pre-export check (`Canvas::checkForUnsupportedBoxSVG`):

- Raster effects other than Blur and Shadow: Motion Blur, Brightness-Contrast, Colorize,
  Wipe, Noise Fade, every custom/shader effect.
- Transform effects other than Follow Path: Track, Parent, Follow Object, Follow Object
  Relative. (Workaround: drive rotation/position with an expression - see the
  `trackObject` preset - because expressions are baked.)
- Any enabled blend effect (Move, Targeted).
- Text effects. All text boxes also get "For best compatibility convert text to path"
  (fonts are not embedded).

Mix-blend-mode mapping: plus, multiply, screen, overlay, darken, lighten, color-dodge,
color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color,
luminosity; anything else exports as normal. Source bug on `main`: Plus maps to
`plus-ligher` (typo), which browsers ignore.

SMIL caveats: SMIL runs in browsers when the SVG is inline, in `<object>`/`<embed>`, or
opened directly; when used through `<img src>` or CSS `background-image`, animation runs
but interactivity (begin events) does not. Always check in the target browser.

## Video, audio and image-sequence rendering

Rendering uses Friction's bundled FFmpeg libraries (no external ffmpeg needed).

1. Add to render queue (F12) - loads the active scene into the Queue panel.
2. Per job: Scene Properties (name, frame range, resolution, FPS), Profile (saved
   presets), Format (container, codecs, bitrate, pixel format, audio), Destination path.
3. Render - processes all queued jobs; progress and cancel available.

Bundled output profiles (`src/app/presets/render/`), installed to
`%LOCALAPPDATA%\friction\OutputProfiles` by the first-run wizard:

| Profile file | format | codec | pixel format |
|--------------|--------|-------|--------------|
| 001 mp4-h264 | mp4 | libx264 | yuv420p |
| 002 mp4-h264-mp3 | mp4 | libx264 + mp3 | yuv420p |
| 003 prores-444 | mov | prores_ks | yuva444p10le (alpha) |
| 004 prores-444-aac | mov | prores_ks + aac | yuva444p10le |
| 005 png | image2 | png | rgba |
| 006 tiff | image2 | tiff | - |
| 007 webm | webm | libvpx-vp9 | yuva420p (alpha) |
| 008 exr | image2 | exr | gbrapf32le |

Notes:

- Image sequences name frames with `%05d` (00001, 00002, ...).
- PNG output is unassociated (straight) alpha; TIFF is associated (premultiplied) (rc.2).
- Exported video is constant frame rate (rc.3) for NLE compatibility.
- No GIF output; docs suggest MP4 -> GIFTuna or PNG sequence -> Gifski.
- macOS: ProRes with alpha is not decodable by Apple Silicon decoders (known issue).
- Transparent background: set the scene background alpha to 0 and use an alpha-capable
  profile (PNG, ProRes 4444, WebM VP9 yuva420p, EXR).

## Lottie

Not supported. FAQ: "Currently we have no plans to support Lottie ... A plugin is under
development." No Lottie importer/exporter exists in the source tree.
