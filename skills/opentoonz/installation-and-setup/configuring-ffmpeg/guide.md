# Configuring FFmpeg (OpenToonz 1.7)

OpenToonz needs FFmpeg installed separately to export animations as **mp4**, **webm**, or **gif** (gif on Mac/Linux only). It's not bundled, so you'll grab it yourself and point OpenToonz to it.

**Windows:** Download a static build from ffmpeg.org — pick the Windows icon, grab the Windows builds link, and hit **Download Build**. The defaults are fine. Unzip the archive, find the **bin** folder inside, and copy its contents into a new folder at **C:\FFmpeg**. That's the path OpenToonz will need.

**Mac:** Same site, but click the Apple icon and grab **Static and Shared builds** (make sure **macOS 64-bit** is selected). Unzip and copy the **bin** contents into **/Applications/OpenToonz/FFmpeg**. On macOS 10.15+, you'll need to right-click each executable (ffmpeg, ffprobe, etc.) and choose **Open With > Terminal** once to clear the Gatekeeper warning — after that you can close Terminal.

**Linux:** Install via your package manager (`pacman -S extra/ffmpeg`, `apt install ffmpeg`, `emerge media-video/ffmpeg`, etc.). Run `which ffmpeg` in a shell to confirm the path — it's usually **/usr/bin**.

Once the binaries are in place, open OpenToonz and go to **File > Preferences…**, then navigate to the **Import/Export** category. You'll see an **FFmpeg Path** field at the top — enter the folder path where you put the executables (e.g., `C:\FFmpeg`, `/Applications/OpenToonz/FFmpeg`, or `/usr/bin`).

Restart OpenToonz, then check **Render > Output Settings…** — in the **File Settings** section, the format dropdown should now include **mp4** and **webm** (plus **gif** on Mac and Linux). You're all set to render video directly.

---

## UI Reference  —  Output Settings Dialog

_Scope: File tab format dropdown where mp4/webm appear after FFmpeg configuration_

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

