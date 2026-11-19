---
name: friction
description: Friction (friction2d, friction.graphics) - the open-source 2D vector/raster motion graphics app forked from enve. Covers install (Windows focus), the binary .friction / legacy enve .ev project files and what can and cannot be generated programmatically, importing SVG/images/video/audio, animated SVG + SMIL export for the web (options and which features survive), FFmpeg video/image-sequence rendering via the render queue and output profiles, JavaScript (ECMAScript) expressions ($frame, $value, $scene.*, property-path bindings, .fexpr presets), GLSL shader effects (.gre/.frag), core concepts (scenes, boxes/layers, paths and nodes, transforms, keyframes and graph editor, raster/path/transform/blend effects, blend modes and DstIn/DstOut masking, markers), CLI facts and gotchas. Use when the user mentions Friction, friction2d, friction.graphics, enve, .friction or .ev project files, .fexpr expression presets, exporting SVG animation from Friction, or doing 2D motion graphics in Friction.
---

# Friction (friction2d)

Friction is a GPL-3.0 2D motion graphics application ("vector and raster animations for
web and video"). It is a fork of enve (forked Feb 2023), built on Qt, Skia, OpenGL 3.3 and
bundled FFmpeg libraries. It is a GUI application: there is no scripting API for building
scenes and no headless/command-line renderer (see "CLI" below).

- Repo: https://github.com/friction2d/friction (mirror: https://codeberg.org/friction/friction)
- Site / docs: https://friction.graphics , https://friction.graphics/documentation/
- Latest published release (verified 2026-11-08): **v1.0.0-rc.3**, 31 Dec 2025. The `main`
  branch reports version 1.0.0 (stable not yet tagged). Development snapshots exist on the
  download page.
- Platforms: Windows 10/11 x64, macOS 11+ universal (still "experimental"), Linux x86_64
  (tar.xz, AppImage, RPM, Flatpak repo). Requires OpenGL 3.3 GPU and an AVX x86_64 CPU.

Verified against upstream source (`src/app`, `src/core`) and the docs site. Where docs and
source disagree, source wins and the difference is flagged.

## Reference files

Read the one that matches the task:

| File | Read when |
|------|-----------|
| [references/install-windows.md](references/install-windows.md) | Installing/running on Windows, portable mode, config folders |
| [references/project-files.md](references/project-files.md) | .friction / .ev format, version compatibility, generating content programmatically |
| [references/import-export.md](references/import-export.md) | Import formats, SVG import limits, SVG/SMIL export options and support matrix, video/image-sequence rendering, output profiles, Lottie |
| [references/expressions.md](references/expressions.md) | Writing expressions: bindings, definitions, script, built-in helpers, presets (.fexpr), baking |
| [references/concepts.md](references/concepts.md) | Scenes, boxes/groups/layers, paths/nodes, transforms, keyframes/graph, effects lists, masks, markers, linking scenes, flip book |
| [references/shader-effects.md](references/shader-effects.md) | Writing custom GLSL raster effects (.gre + .frag) |
| [references/gotchas.md](references/gotchas.md) | Before telling the user something "should work" - docs/source mismatches and pitfalls |

## What Friction can and cannot do (quick answers)

- **Project file**: `.friction`, a **binary** stream (enve "ev" format, footer `enve ev`).
  Not human-readable, no published spec. A text/XML zip format ("XEV") exists in source but
  is commented out and unusable. Generating `.friction` files from code is **not practical**.
- **Practical automation path**: generate the *assets* as text and import them: SVG
  (shapes, gradients, text), `.fexpr` expression presets, render output profiles (`.conf`
  INI), shader effects (`.gre` XML + `.frag` GLSL). Then animate/render in the GUI.
- **Import**: `.svg` (converted to editable paths/groups), images (png jpg jpeg bmp webp),
  video (mp4 mov mkv webm avi gif and more), audio (mp3 wav aiff flac m4a oga), image
  sequences (pick a folder), other `.friction`/`.ev` projects. SVG can also be *linked*
  (stays external, reloads) or pasted from clipboard (Shift+Ctrl+V). ORA import is disabled.
- **Export**: animated **SVG with SMIL** (`<animate>`, `<animateTransform>`,
  `<animateMotion>`), optionally wrapped as an HTML preview; **video/audio/image sequences**
  via the render queue using bundled FFmpeg (MP4/H.264, ProRes 4444, WebM/VP9, PNG, TIFF,
  EXR presets; many more via custom profiles). **No Lottie** (FAQ: no plans; "a plugin is
  under development"). **No GIF** preset - render MP4/PNG sequence and convert externally.
- **Expressions**: per-property JavaScript (Qt QJSEngine, ECMAScript). Bindings such as
  `frame = $frame;`, `fps = $scene.fps;`, `x = transform.translation.x;`. No
  `valueAtTime()` (FAQ: maybe v1.1). Expressions are **baked to keyframes on SVG export**.
- **Not available**: onion skinning (enve's paint-mode onion skin code is commented out),
  bones/rigging (use Parent transform effect), raster painting, Lottie, CLI rendering.

## Core workflow (GUI)

1. New project -> Scene Properties dialog: width/height (px), frame range (Friction works
   in frames; seconds are converted with FPS), FPS, background color (alpha 0 = transparent).
   A project can hold many scenes.
2. Create shapes with tools (F1 transform, F2 point/path edit, F3 path create, F4 draw,
   F5 circle, F6 rectangle, F7 text, F8 null) or import/link assets (Ctrl+I import,
   Ctrl+L link). Docs advise designing assets in Inkscape/Affinity/Krita and importing.
3. Animate: click the record dot next to a property (turns red) to enable keyframes; change
   values at other frames; Insert adds a key. Interpolation defaults to linear; edit curves
   and apply easing presets in the Graph view of the Timeline.
4. Add effects via right-click on an object (raster, path, fill, outline, transform, blend).
5. Output: File > Export SVG (Shift+F12), Preview SVG in browser (Ctrl+F12), or Add to
   render queue (F12) -> pick profile/format/destination -> Render.

Key shortcuts: Ctrl+Space command palette, Ctrl+G group, Ctrl+Shift+G ungroup,
Shift+Ctrl+C object to path, G/R/S move/rotate/scale (X/Y to constrain, type numbers,
Enter to apply), Shift+D duplicate key and move, Ctrl+D duplicate, P pivot local/global,
Shift+Tab toggle snapping (rc.3+).

## Expressions in 30 seconds

Right-click a single numeric property in Timeline/Properties > **Set Expression**. The
dialog has three parts:

- **Bindings** - one `name = source;` per line (or `;`-separated). Sources: `$frame`,
  `$value`, `$scene.fps`, `$scene.width`, `$scene.height`, `$scene.rangeMin`,
  `$scene.rangeMax`, or a dotted property path (`transform.rotation`,
  `OtherObject.transform.translation`, `properties.speed`). No constants, no `var`.
- **Definitions** - JavaScript functions.
- **Calculate** (script) - function body; must `return` a number.

```text
Bindings:
frame = $frame;
fps = $scene.fps;
base = $value;

Calculate:
return base + Math.sin(frame / fps * 2 * Math.PI) * 40;
```

Two-value properties bind as arrays: `pos = transform.translation;` gives `pos[0]`,
`pos[1]`. Built-in helpers available everywhere: `clamp(x, lo, hi)`, `lerp(a, b, t)`, and
`Math.easeInOutQuad(t, b, c, d)`-style easing functions; `noise()` and `oscillation()` are
available when the bundled presets are installed. Full details and caveats:
[references/expressions.md](references/expressions.md).

## SVG export in 30 seconds

Supported in SVG output (docs + source): transforms (translation, rotation, scale, shear,
pivot, opacity), keyframes with graph curves (as `calcMode="spline"` + `keySplines`),
expressions (baked), gradients, images/videos (embedded base64 per frame), text, shape
morphing, path effects such as Sub-Path/trim, Follow Path transform effect
(`animateMotion`), Blur and Shadow raster effects, masking via blend mode DstIn/DstOut,
CSS `mix-blend-mode` (opt-in), visibility ranges, interactive begin/end events (click,
mouseover, ...).

Flagged as unsupported by Friction's own pre-export check: all other raster/shader effects
(Motion Blur, Colorize, Brightness-Contrast, Wipe, Noise Fade, custom shaders), all blend
*effects* (Move, Targeted), transform effects other than Follow Path (Track, Parent, Follow
Object, Follow Object Relative), text effects; text is recommended to be converted to path.
Workaround from the docs: recreate unsupported motion with an expression - expressions are
sampled into keyframes at export. Options: Background, Fixed Size, Loop
(`repeatCount="indefinite"` vs `fill="freeze"`), Optimize for Web (built-in optimizer,
rc.3+), Mix Blend Modes, SVG 1.1 Colors (hex instead of rgba), raster image format
PNG/JPEG/WEBP + quality, frame range. See
[references/import-export.md](references/import-export.md).

## CLI

Verified in `src/app/main.cpp` (main and v1.0.0-rc.3):

- `friction.exe "C:\path\project.friction"` - the first argument is opened as a project.
  That is the only general argument. The Windows installer registers `.friction` with
  `"friction.exe" "%1"`.
- `--xdg-install` / `--xdg-remove` - Linux only, portable/AppImage builds only (desktop
  integration).
- **No** headless render, no `--help`, no export flags. A `--renderer` mode is stubbed
  (`isRenderer = false; // todo`) but not implemented. Rendering requires the GUI.

## Windows essentials

Installer `friction-1.0.0-rc.3-setup-win64.exe` (installs to `C:\Program Files\Friction`)
or portable `friction-1.0.0-rc.3-windows-x64.7z`. Needs Visual C++ Redistributable 2017+
on Windows 10. Binaries are unsigned, so expect a SmartScreen warning. User data lives in
`%LOCALAPPDATA%\friction\` (`Expressions`, `ShaderEffects`, `OutputProfiles`). Portable
mode: a `portable.txt` next to `friction.exe` in a writable folder moves config to
`<app>\config`. Details: [references/install-windows.md](references/install-windows.md).

## Top gotchas (full list in references/gotchas.md)

1. The property is `transform.translation`, not `transform.translate` (the docs tip is
   wrong). Bindings cannot use `var`.
2. Property-path bindings only resolve **visible** properties and only numeric or 2D-point
   animators; enable Custom Properties before binding `properties.*`.
3. `$frame` is the object's **relative** frame (after time shifts), not always the scene
   frame.
4. Saving in a newer build upgrades the project format irreversibly: rc.3 writes format 34;
   `main`/dev snapshots write 35 and rc.3 refuses those files.
5. What you see is not what SVG export gives you; run Preview SVG (Ctrl+F12) and read the
   warnings dialog before promising web output.
6. Linked assets (images, video, audio, linked SVG) are **not** embedded in `.friction`;
   move them together.
7. Docs say custom shaders go in `ShadersEffects`; source uses `ShaderEffects`.
