# Previewing and Rendering (OpenToonz 1.7)

Before committing to a full render, you can preview your animation directly in the Viewer or in a separate Flipbook window. Toggle preview mode with the **Preview** button in the Viewer title bar — the framebar color-codes progress: dark grey for rendered frames, light red for pending, light green for the frame currently computing.

To speed things up, define a **Sub-camera** (smaller than the full camera frame) using the **Define Sub-camera** button in the Viewer bottom bar. Only that region renders during preview, saving significant time on complex scenes.

For a standalone preview window with its own settings, go to **Render > Preview Settings…** to configure resolution, frame range, shrink, and step independently of your final output. Then hit **Render > Preview** to open the Flipbook. You can freeze, clone, or compare previews by right-clicking inside the window. Caching an effect node in the FX Schematic (right-click a node > **Cache FX**) stores its compositing result in memory so subsequent previews skip recomputation.

When you're ready for final output, open **Render > Output Settings…**. Set your camera, frame range, file format (TIF, PNG, MP4, MOV, etc.), save location, channel width, and resample balance. MP4 and WebM require FFmpeg installed separately. For transparent backgrounds, set the alpha of **Camera BG Color** to 0 in **Xsheet > Scene Settings…** and choose a format that supports alpha (TIF 32/64-bit, TGA 32-bit, or MOV with Animation codec).

Kick off the render with **Render > Render**. For background processing, use the Tasks pane — add scenes via **Add Render**, configure priority and dependencies, then hit **Start**. Tasks can be split into chunks for render-farm distribution via the **Frames Per Chunk** property. Task status is color-coded: grey (waiting), yellow (running), green (done), red (failed).

---

## UI Reference  —  FX Schematic

_Scope: Output node activation for selecting render target branch_

The FX Schematic is a node-graph panel for wiring effects into the render pipeline. It is visible in the lower half of the Schematic workspace, or can be opened via Windows > Schematic.

## Layout

The FX Schematic panel has a dark canvas where effect nodes are displayed as labelled rectangular boxes connected by teal/cyan wires showing data flow. In a default scene, two nodes are present: a blue **XSheet** node (representing the column stack) on the left, connected by a wire to a blue **Output** node (the final render target) on the right. A horizontal toolbar runs along the bottom edge of the panel. The toolbar is split into two groups: navigation/view controls on the left, and node-creation/toggle controls on the right.

## Bottom Toolbar (left to right)

Left group:
1. **Selection Mode** (arrow icon) — Click nodes to select them.
2. **Zoom Mode** (magnifier icon) — Left-click zooms in; right-click zooms out.
3. **Hand Mode** (hand icon) — Drag to pan the canvas.
4. **Fit to Window** (four inward arrows icon) — Zooms and re-centres to show ALL nodes. Key recovery tool after inserting off-screen effects.
5. **Focus on Current** — Centres the view on the selected node.
6. **Reorder Nodes** — Auto-layouts all nodes left-to-right.
7. **Reset Size** (labelled "1:1") — Resets zoom to 100%.
8. **Maximize Nodes** — Toggles between compact (name only) and expanded display (shows port labels like Texture1/Control1/Source/Link, a blue preview play triangle, and identity icons).

Right group:
9. **New FX** — Adds an unconnected FX node.
10. **New Output** (Alt+O) — Adds another Output node.
11. **Toggle node icons** — Shows/hides icon buttons on node headers.
12. **Toggle FX/Stage** — Switches between FX Schematic view and Stage Schematic view.

## Adding Effects

### Right-click empty area > Add FX
Drops an unconnected node. The submenu shows 15 effect categories: Background, Blur, Distort, Gradient, Image_Adjust, Layer_Blending, Layer_Blending_Ino, Light, Matte, Noise, Render, Stylize, Toonz_Level, Shaders, Utility. Each category expands to individual effects.

### Right-click node > Insert FX
Inserts the effect inline BETWEEN the selected node and its downstream connections, automatically wiring it in.

### Right-click node > Replace FX
Swaps the selected node for a different effect type, preserving connections.

### Node context menu (additional items)
FX Editor (Ctrl+K), Copy, Cut, Paste Replace, Paste Add, Delete, Disconnect from Xsheet, Create Linked FX, New Output (Alt+O), Preview, Cache FX, Make Macro FX, Save As Preset..., Collapse, Group (Ctrl+G).

## FX Settings Panel

Opens on **double-click** of an effect node, or via right-click > FX Editor (Ctrl+K). Also opens automatically when inserting a new effect. This is a floating window that updates to show the selected node's parameters when a different node is single-clicked.

- Numeric fields require **double-click** to activate text editing, then Enter to confirm.
- Diamond icons (◇) beside fields indicate animatable/keyframeable parameters.

### Example: Particles effect
Five tabs: Source, Birth Params, Environment, Animation, Colors. Key controls include Birth Rate, Speed, Size, Lifetime, Gravity, Wind, Opacity, and colour gradient editors with RGBA swatches. A collapsible Swatch Viewer section provides a live effect preview.

### Example: RGBA Scale effect
Simple single-panel layout with four fields: Red (0–100), Green (0–100), Blue (0–100), Alpha (0–100), all defaulting to 100. Each has a keyframe diamond (◇).

## Important Notes

- After inserting an effect, always click **Fit to Window** to locate it — nodes may appear off-screen.
- **Insert FX** (node context menu) wires the effect inline; **Add FX** (empty area context menu) drops a disconnected node. Both share the same 15-category submenu.
- Scroll wheel zooms the schematic canvas (up = zoom in, down = zoom out).

---

## UI Reference  —  Output Settings Dialog

_Scope: Output Settings Camera tab (resolution, frame range, Render button), File tab (Save In path, format dropdown, Choose Folder dialog)_

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

