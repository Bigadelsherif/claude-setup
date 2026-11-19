# Setting Up a Scene (OpenToonz 1.7)

Every new scene inherits settings from its parent project, keeping your production consistent. You can override any setting per-scene, and if you land on values you prefer going forward, lock them in with **File → Project Management → Save Default Settings**.

**Working units** live under **File → Preferences… → Interface**. Set **Unit** for general measurements (inches, mm, cm, fields, or pixels) and **Camera Unit** for how camera dimensions display. You can always override inline by typing a suffix like `cm`, `px`, or `fld` after a value — it converts automatically.

**Frame rate** is set in **Xsheet → Scene Settings…**. Use 24 for cinema, 25 for PAL, 30 for NTSC. The current FPS shows in the Viewer's bottom bar. If you need to deliver at a different rate later, use the **Stretch from FPS: To:** option in Output Settings rather than re-compositing.

**Camera size and resolution** are configured via **Xsheet → Camera Settings…**. You'll see fields for Width/Height (in your chosen Camera Unit), pixel resolution, DPI, and aspect ratio — changing one recalculates the others. Use the lock and radio buttons to pin whichever dimension matters most. The **Use Current Level Settings** button auto-fits the camera to your selected level. Save frequently-used setups with **Add** next to the presets dropdown.

**Color calibration** helps you preview accurate color on your monitor. Enable it in **File → Preferences… → Interface** by toggling **Color Calibration using 3D Look-up Table**, then point it at a `.3dl` file matched to your display. Restart OpenToonz afterward — the LUT then applies across the Viewer, Flipbook, Palette, and Style Editor.

**Memory tuning** keeps things responsive. Under **File → Preferences… → General**, set **Undo Memory Size (MB)** to cap how much RAM undo history consumes. If you work mostly with raster levels (scanned art), enable **Minimize Raster Memory Fragmentation** to reserve a dedicated memory block — but leave it off for vector-heavy projects so that memory isn't wasted. Both memory options require a restart.

---

## UI Reference  —  Output Settings Dialog

_Scope: Camera settings overlap: resolution, A/R, DPI fields in Camera tab_

Opened via Render > Output Settings... (Ctrl+O). Controls render dimensions, file output path, and format. The dialog has three tabs in a left sidebar: Camera, File, More.

## Layout

The Output Settings dialog is a floating window that appears over the main canvas. The left sidebar lists three tabs stacked vertically: **Camera** (top, selected by default), **File**, and **More**. The right area shows the controls for whichever tab is active. A Presets row with a dropdown and Add/Remove buttons sits at the top. A Render button (Ctrl+Shift+R) is at the bottom.

## Camera Tab

### Camera Settings
- **Output Camera** dropdown — Selects which camera (default: Camera1).
- **Name** field — Editable camera name (default "Camera1").
- **Inch** row — Radio button at the left, then width and height in inches (computed as Pixels / DPI). An asterisk suffix (*) indicates a derived value. Two open padlock icons flank the row at left and right ends.
- **A/R** field — Aspect ratio displayed as `width/height` (e.g. `1920/1080`). A red padlock icon sits to its left, indicating the aspect ratio is locked. The red padlock **cannot be click-toggled** — clicking it has no effect. To change the ratio: double-click the A/R field (the red padlock moves to the Inch row as a visual indicator), press Ctrl+A, type a new ratio (e.g. `320/320`), press Return. Height recalculates to match the new ratio.
- **Pixels** row — Radio button (selected by default, filled circle), then Width and Height fields in pixels (default 1920 x 1080). With the AR locked, changing Width auto-adjusts Height to maintain the ratio.
- **DPI** field — Dots per inch (default 120). Shown as two values separated by `=`.
- **Use Current Level Settings** button — Copies resolution from the current level.
- **Preset** dropdown — Save/load named dimension presets via Add/Remove buttons.
- **Frame Start / End / Step** — Render range fields (default 1/1/1).
- **Render** button (Ctrl+Shift+R).

### Camera Tab Quirks
- The red padlock (AR lock) cannot be unlocked by clicking. Edit the A/R field directly to change the ratio.
- Pressing Escape after editing A/R may collapse the Camera Settings sub-panel. Always confirm with Return or Tab.

## File Tab

### Save In
- **Text field** — Shows the current output directory (default `+outputs`). Click, Ctrl+A, type a path, press Enter. Accepts any string including non-existent paths; no validation occurs on Enter.
- **"..." browse button** — Opens a Choose Folder dialog.

### File Tab Additional Controls
- **Name** field — Output filename (default matches scene name).
- **Format dropdown** — File format (default `tif`), with an **Options** button.
- **Resample Balance** dropdown (default: Standard).
- **Channel Width** dropdown (default: 8 bit).
- **Dedicated CPUs** dropdown (default: All).
- **Render Tile** dropdown (default: None).
- **More Settings** collapsible section.
- **Add Clapperboard / Edit Clapperboard** buttons.

### Choose Folder Dialog
Opened by the "..." button next to Save In. Has its own toolbar: Back, Forward, Up One Level, New Folder, Icons View, List View, Export File List.

- **Folder indicator** (read-only label below toolbar) — Shows the currently navigated path. This is the authoritative value that Choose will apply.
- **Left tree** — Shortcuts: My Computer, My Documents, Desktop, Library, History, Project root, sandbox (red dot = active project).
- **Right panel** — Directory contents in list or icon view. Single-click a folder to navigate into it.
- **Folder name field** (bottom) — **DISPLAY ONLY despite accepting keyboard input.** Typing a path here and clicking Choose does NOT work; the dialog ignores typed text. Navigate using the tree or right panel, then click Choose.
- **Choose** button — Applies the Folder indicator path to Save In and closes.
- **Cancel** / Escape — Closes without change.

### File Tab Quirks
- The Folder name field at the bottom of Choose Folder is the primary failure point: it accepts keyboard input but ignores it on Choose.
- Project-relative paths are auto-converted to `+relative` notation (e.g. `+outputs`) when chosen via the dialog.

---

## UI Reference  —  Startup Dialog

_Scope: Scene creation fields: Camera Size preset, Width/Height, Resolution, DPI, Frame Rate, Units dropdown_

The OpenToonz Startup dialog appears on application launch, offering scene creation, project selection, and recent-scene access. It is a modal dialog centred over the main workspace.

## Layout

The dialog's title bar reads "OpenToonz Startup" with a close (X) button at the top right. The body is divided into a left panel and a right panel. The left panel has the OpenToonz logo and branding at the top, then project/scene creation controls. The right panel shows recent scenes. A bottom strip spans the full dialog width with a checkbox and an auto-save field.

## Elements

### Left Panel — Create a New Scene
- **Current Project** dropdown (default: sandbox) — Selects the project context.
- **New Project...** button — Right of the dropdown; opens a project creation dialog.
- **Scene Name** field — Text input for the new scene filename. Required before clicking Create Scene.
- **Save In** path field + **"..."** browse button — Shows the save destination directory. WARNING: typing an absolute path here causes OpenToonz to prepend the project folder, creating an invalid path. Use the "..." browse button instead.
- **Camera Size** dropdown — Scrollable list of ~23 presets ranging from UHD 4K (3840x2160) down to various Cineon formats. **Add** and **Remove** buttons to the right for managing custom presets.
- **Width** field (default: 16") and **Height** field (default: 9") — Physical camera dimensions in the selected unit.
- **Resolution** X field (default: 1920) and Y field (default: 1080) — Pixel resolution.
- **Units** dropdown (default: inch) and **DPI** field (default: 120).
- **Frame Rate** field (default: 24).
- **Create Scene** button — Creates the scene with the specified settings and closes the dialog.

### Right Panel — Recent Scenes
- Headed "Recent Scenes [Project]". Shows recently opened scenes for the current project, or "No Recent Scenes" for a fresh project.
- **Open Another Scene...** button — Opens the Load Scene file-browser dialog on top of the Startup dialog.

### Bottom Strip
- **Show this at startup** checkbox (checked by default) — Controls whether the dialog appears on next launch. Uses positive phrasing (not "Don't show again"). There is no menu item to reopen this dialog mid-session.
- **Automatically Save Every [N] Minutes** field (default: 15).

## Important Notes

- The dialog only appears on application launch. File > New Scene (Ctrl+N) does NOT show this dialog — it creates a scene directly.
- When "Open Another Scene..." opens the Load Scene dialog, the Startup dialog's X button is covered and cannot be clicked. Close the Load Scene dialog first (via its Cancel button or its own X), then the Startup dialog becomes accessible again.
- Escape closes whichever dialog currently has focus (Load Scene first if it is on top, then the Startup dialog).

