# Gotchas

Each item is backed by upstream source or docs (checked 2026-11-08 against `main` and tag
`v1.0.0-rc.3`).

## Versions and files

1. **Format upgrades are one-way.** rc.3 reads/writes project format 34; `main` and the
   development snapshots write 35 (`EvFormat::v100`). rc.3 refuses format 35 files
   ("Unsupported project version"). Saving an older project asks before upgrading it.
   Keep one Friction version per project, or keep copies.
2. **`.friction` is binary and undocumented.** Do not try to generate, diff, merge or
   patch it. Version-control it as a binary blob. The XML "XEV" format is disabled.
3. **Linked media is not embedded.** Images, video, audio and linked SVG are referenced by
   path. Moving the project alone breaks them; use the Assets panel > Replace to relink.
4. **`.ev` handling differs by build.** rc.3 opens `.ev` directly; `main` only opens
   `.friction` and imports `.ev`. Old enve projects load with a "might behave
   differently" warning; features removed from enve (e.g. paint) will not come back.
5. **Backups go next to the project** (`<name>.friction_backup/`) when "Backup on save" is
   enabled - not into a temp folder.

## Expressions

6. **Property is `translation`.** `transform.translate.x` (used in the docs' tips section)
   does not resolve; use `transform.translation.x`.
7. **No `var`, no constants in Bindings.** Only `name = source`. Constants go in Calculate.
8. **Binding lookup ignores hidden properties.** Custom properties must be made visible
   (right-click > Custom Properties) before `properties.x` resolves. Lookup is by exact
   property/object names walking up from the property's parent; rename objects to simple
   identifiers (no dots) to keep paths readable.
9. **`$frame` is relative.** It is the owner's relative frame (after visibility shifts and
   frame remaps), not necessarily the scene's absolute frame.
10. **`$value` is the base value**, i.e. the keyframed/constant value under the expression.
11. **Return a number.** Arrays, strings, `undefined` -> "Invalid return type".
12. **Globals persist inside one expression's engine.** Unscoped assignments survive
    between frames; the bundled `noise()` reads a global `time`, so assign
    `time = frame / fps;` without `var` first. Use `var`/`let` for scratch values to avoid
    surprises.
13. **No `valueAtTime()`**; you cannot sample another frame (FAQ: maybe v1.1).
14. **Global definitions leak into every expression.** All enabled presets'
    `definitions` are prepended to every expression, so a broken or colliding function in
    a user `.fexpr` can break all expressions. Disable the preset or fix the file.
15. **Presets load only at startup**, and duplicate `id`s are ignored.

## SVG export

16. **Viewer != SVG.** Only Blur/Shadow raster effects, the Follow Path transform effect,
    and blend-mode masks/mix-blend-modes survive. Everything else in the warning dialog is
    dropped. Read the warnings; use Preview SVG (Ctrl+F12) in the real target browser.
17. **Bake unsupported motion with expressions.** Expressions are sampled into spline
    keyframes at export; e.g. replace a Track effect with the `trackObject` expression.
18. **Text depends on installed fonts.** Convert text to path for reliable output.
19. **Video/image sequences bloat SVGs** (every frame embedded as base64). Use JPEG/WEBP
    and lower quality in the export dialog, or avoid raster video in web exports.
20. **Plus blend mode exports as invalid CSS** (`plus-ligher` typo in `skBlendModeToSVG`
    on `main`).
21. **Object names become element ids.** Duplicate or odd names make the SVG hard to
    script; name things deliberately.
22. **Group opacity needs a layer.** Plain groups ignore opacity; promote to layer.

## Rendering and platform

23. **No CLI or headless render.** Only `friction.exe <project>` is honored. Batch
    rendering means queueing several scenes in the GUI render queue.
24. **No GIF output.** Render MP4 or PNG sequence and convert.
25. **Alpha requires both** a transparent scene background (alpha 0) and an
    alpha-capable profile (PNG, ProRes 4444 `yuva444p10le`, WebM VP9 `yuva420p`, EXR).
26. **Unsigned Windows binaries** trigger SmartScreen; verify the `.sha256` first.
27. **GPU is mandatory** (OpenGL 3.3 core). If GPU init fails Friction reports "Your GPU
    drivers do not seem to be compatible"; it also warns when the driver lacks threaded
    OpenGL. Expect trouble on VMs or remote sessions without a real GL driver.
28. **Portable mode needs a writable folder** containing `portable.txt`; otherwise config
    silently goes to `%LOCALAPPDATA%\friction`.
29. **Shader folder name**: docs say `ShadersEffects`, source default is `ShaderEffects`;
    check Preferences > Shaders.
30. **macOS is still "experimental"** per release notes; ProRes with alpha does not decode
    on Apple Silicon.

## Docs vs. reality

- Docs Expressions page still mentions an "Easing" tab in the dialog; rc.1 removed it
  (easing presets live in the Graph view).
- Docs list Link as working for bitmaps; in `main` the Link dialog filters to `*.svg` -
  bitmaps are always linked anyway when imported.
- Many docs videos/tutorials refer to enve; most still apply, but menus and toolbars were
  reorganized (rc.2 ToolBox, rc.3 gizmos/snapping).
