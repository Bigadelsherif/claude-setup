# Pencil2D app concepts (GUI)

Sources: menu actions in `app/ui/mainwindow2.ui`, dialogs in `app/ui/*.ui`, `core_lib` layer and
manager code, the user manual (https://www.pencil2d.org/doc/user-manual.html) and FAQ
(https://www.pencil2d.org/doc/faq.html). Menu paths are given as they appear in the English UI.

## Canvas and camera

- The canvas is unlimited. The camera field (white rectangle) defines what gets exported; default
  800x600 for new projects. Change it by double-clicking the camera layer (Camera Properties:
  width/height 1-10000).
- Hiding the camera layer hides the passepartout around the field.

## Layer types

| Type | Holds | Notes |
|---|---|---|
| Bitmap | raster keyframes (PNG in the project) | pencil, brush, eraser, bucket, smudge... |
| Vector | Bezier strokes/fills (`.vec`) | colours are palette references; editing a swatch recolours vector art |
| Camera | camera keys (pan, rotate, zoom) | more than one allowed; exports use one (CLI: `--camera` or the last one) |
| Sound | audio clips placed at a frame | WAV, MP3, OGG, FLAC, Opus, AIFF, AAC, CAF, WMA listed in the import filter |

Layers are drawn bottom-to-top as listed in the timeline (top row = in front).

## Keyframes and exposure

- Frames start at 1. A keyframe's drawing is held until the next keyframe on that layer.
- Timeline buttons/menu: Add Frame, Remove Frame, Duplicate Frame; Move Frame Forward/Backward.
- **Add Exposure / Subtract Exposure** lengthen or shorten how long the selected keyframes are held
  (shifting later keys). Also: Reverse Frames Order, Reposition Selected Frames.
- Preference "When drawing on an empty frame": create a new keyframe automatically (user manual).
- Frame rate: timeline FPS box, 1-90. Timeline length up to 9999 frames (`MaxFramesBound`); the FAQ
  advises staying below roughly 1500 frames per file for memory reasons.
- Flip In-Between / Flip Rolling (flipping between keys while drawing).

## Onion skin

Shows previous (red tint) and/or next (blue tint) frames. Options dock: previous/next counts,
Distributed Opacity with Max/Min %, Show On All Layers, Show Keyframes Only, Show During Playback.
The manual allows up to 60 onion frames but recommends 1-2 at 15-50 % opacity.

## Camera motion

- Add camera keys on the camera layer, move/rotate/scale the camera with the camera tool; frames
  between keys are interpolated.
- Right-click a camera key in the timeline: menu "Easing: frame X to Y" offers Linear plus In /
  Out / In-Out / Out-In variants (quad, cubic, quart, quint, sine, expo, circ, elastic, back,
  bounce). The choice governs the move from that key to the next.
- "Show path" draws the camera path; its midpoint handle bends the path (saved as
  `pathCPX/pathCPY`).

## Import (File > Import)

- **Image...**: one picture, centred on the canvas origin, onto the current bitmap/vector layer.
- **Image Sequence...**: many files; option "Import an image every # frame" spaces them (exposure).
- **Image Predefined set...**: files named `prefix<number>.ext`; the number in each name becomes
  its frame and the layer is named after the prefix.
- **Animated Image...**: GIF / WebP animations.
- **Movie Video...**: extracts frames through ffmpeg (`%05d.png` at the project fps); asks
  permission above 200 frames and refuses to go past frame 9999.
- **Movie Audio...**: extracts the soundtrack through ffmpeg (current layer must be a sound layer).
- **Sound...**: audio clip at the current frame on a sound layer.
- **Layers from Project file...**: copy layers from another `.pclx`.
- Palette: Append to Palette / Replace Palette (Pencil2D `.xml` or GIMP `.gpl`).

## Export (File > Export)

- **Image...**: current frame. **Image Sequence...**: PNG/JPG/BMP/TIFF/WEBP, camera choice,
  resolution, transparency, frame range (end = last keyframe or end of sound), "Export keyframes
  only".
- **Movie...**: MP4/AVI/WebM/APNG, camera, resolution, range, FPS, Loop (default on),
  Transparency (tooltip: WebM and APNG only). The dialog prevents invalid MP4 resolutions and refuses
  to export when the project has 63 or more sound clips (`MovieExporter::MAX_SOUND_FRAMES`).
- **Animated GIF...**: dedicated GIF export.
- **Palette**.
- Movie/GIF export needs `plugins/ffmpeg(.exe)` next to the app (bundled by official builds).
- The GUI exposes Loop, keyframes-only and movie transparency; the command line does not (see
  `command-line.md`).

## Saving

- Save as `.pclx` (ZIP) or legacy `.pcl` + `.pcl.data/` folder.
- Saving an existing `.pclx` first copies it to `<name>.backup<N>.pclx` and deletes the backup after
  a successful save.
- Unsaved work lives in `<temp>/Pencil2D/<name>_Y2xD_<random>/`; the app offers recovery from
  there after a crash. The FAQ recommends saving numbered copies at milestones.
