Here's the reference guide:

# Working with Columns, Layers, and Cells (OpenToonz 1.7)

The Xsheet (vertical) and Timeline (horizontal) are two views of the same data. Columns in the Xsheet correspond to layers in the Timeline; rows are frames. Stacking order runs left-to-right in the Xsheet and bottom-to-top in the Timeline — stuff on the right/top renders in front.

Each column/layer header shows a **Name**, a **Render toggle** (include in output), a **Camera Stand toggle** (show/hide in viewer), and a **Lock toggle** (prevent edits). Click the triangle icon to adjust **Opacity** or apply a **Color Filter** for viewing. Double-click the name area to rename a column.

To select columns, click a header; Ctrl/Cmd-click to add more, or Shift-click to extend. Drag selected headers to reorder them. Right-click a header for **Cut**, **Copy**, **Paste**, **Delete**, or **Insert** empty columns. You can also **Fold Column** from that menu to collapse columns you don't need visible, and click the fold marker later to unfold.

Cells hold references to level drawings — editing a drawing updates every cell that points to it. Click-drag across cells to select a range, or click the strip on the left (Xsheet) / top (Timeline) to grab a whole level chunk. Drag that strip to move cells; hold Ctrl/Cmd to duplicate, Shift to insert, or Alt to overwrite at the destination.

The **Cells** menu has handy timing tools: **Reverse**, **Swing**, **Step 2/3/4**, **Each 2/3/4**, **Increase Step**, **Decrease Step**, **Roll Up/Down**, and **Repeat** (loop a selection N times). Use the **Fill Handle** — the small tab at the bottom/right of a selection — to smart-extend or shorten sequences by dragging.

To retime globally, select cells and choose **Cells → Time Stretch…**, set your new frame range, and hit **Stretch**. For whole-scene timing changes, use **Xsheet → Insert Frame** or **Xsheet → Remove Frame** — these shift all columns and any animation keys together.

Sub-Xsheets let you nest an entire scene inside one column. Collapse selected columns via **Xsheet → Collapse**, or load a saved TNZ with **File → Load As Sub-Xsheet…**. Open one with **Xsheet → Open Sub-Xsheet**, close with **Xsheet → Close Sub-Xsheet**. Use **Xsheet → Explode Sub-Xsheet** to flatten it back out, or **Clone Sub-Xsheet** to get an independently editable copy.

---

## UI Reference  —  Timeline Layer Header Icons

_Scope: Per-layer Preview Visibility, Camera Stand Visibility, Lock toggles, Opacity/Color Filter settings, global header row_

Each layer row in the Timeline view has four small header icons controlling visibility, locking, and per-layer settings. A global header row above all layer rows applies the first three toggles to all layers at once.

## Layout

The Timeline view runs along the bottom of the Drawing workspace (or fills the centre in the Animation workspace). Layer rows are stacked vertically on the left side of the timeline, with frame numbers running horizontally to the right. Each layer row has a narrow icon area at its left edge containing four icons arranged left to right. Above all layer rows, a global header row contains three "All" variant icons in the same positions as the first three per-layer icons. Camera-type rows (e.g. Camera1) at the bottom of the layer stack replace the standard icons with a single button.

## Per-Layer Icons (left to right in each row)

1. **Preview Visibility Toggle** (1st icon) — Shows or hides the layer in preview playback only. Does NOT affect camera-stand rendering or final output. Right-click context menu: ON This Only, ON Selected, ON All, OFF All, OFF Selected, Swap ON/OFF.

2. **Camera Stand Visibility Toggle** (2nd icon) — Shows or hides the layer from the camera-stand composite — this is what renders to file. Toggling OFF immediately removes the layer from the main viewport. Right-click context menu: Show This Only, Show Selected, Show All, Hide All, Hide Selected, Toggle Show/Hide, Hide Upper Columns.

3. **Lock Toggle** (3rd icon) — Locks the layer against editing. Does not affect visibility or rendering. When locked, a closed padlock icon is shown and drawing/editing tools are blocked on that column. Right-click context menu: Lock This Only (Shift+L), Lock Selected (Ctrl+Shift+L), Lock All (Ctrl+Alt+Shift+L), Unlock Selected (Ctrl+Shift+U), Unlock All (Ctrl+Alt+Shift+U), Swap Lock/Unlock.

4. **Additional Column Settings** (4th icon) — Opens a flyout panel with:
   - **Opacity** slider and numeric field (0–100%, default 100).
   - **Filter** dropdown: None (default), Red, Green, Blue, DarkYellow, DarkCyan, DarkMagenta.

## Global Header Row

The row immediately above all layer rows contains three "All" variant icons:
- **Preview Visibility Toggle All** (1st position) — Toggles preview visibility for all layers at once.
- **Camera Stand Visibility Toggle All** (2nd position) — Toggles camera-stand visibility for all layers at once.
- **Lock Toggle All** (3rd position) — Locks or unlocks all layers at once.

## Camera Rows

Camera1 (and all camera-type columns) completely replace the standard three toggle icons with a single **"Click to select camera"** button spanning the icon area. Clicking this selects the camera for rendering but does not toggle visibility or lock.

## Important Notes

- **Camera Stand Visibility** is the icon that controls render output, not Preview Visibility. The two are independent — disabling Preview Visibility does not affect what the camera renders.
- Preview Visibility uses ON/OFF terminology in its context menu; Camera Stand Visibility uses Show/Hide terminology.
- The icons are small and closely spaced; the Camera Stand Visibility icon is in the second position (not the first).

---

## UI Reference  —  Xsheet View & Cell Operations

_Scope: Cell format, Fill In Empty Cells, drag-to-extend handle, right-click context menu, Step/Each/Reverse/Swing/Roll operations_

The Xsheet is a spreadsheet-style exposure sheet where columns represent animation layers and rows are frame numbers. Cells display drawing references as `LevelName DrawingNumber` (e.g. `A  1`).

## Layout

The Xsheet view fills the left portion of the Xsheet workspace (or appears as a docked panel in other rooms). At the top is a status bar showing scene info and current selection in the format `Scene: name :: N Frames  Level: LevelName :: Selected: N frames * M columns`. Below the status bar is a toolbar row of icon buttons. Column headers (Col1, Col2, ..., Camera1) run horizontally across the top; frame numbers run vertically down the left edge. Each cell at the intersection of a column and frame number shows a drawing reference. Filled Toonz Raster Level cells have a green background; empty cells are dark grey.

## Key Concepts

- **Cell format**: `LevelName  DrawingNumber` (e.g. `A  1`). The level name is assigned when creating the level; the drawing number is the frame/drawing index within that level.
- A level must be created first (Level > New > New Level...) before cells can show drawing references. Typing into an empty cell does not create a drawing.

## Fill In Empty Cells (Critical Command)

Propagates the topmost filled drawing downward into all empty cells in the selection. Access: Cells > Fill In Empty Cells (last item in the Cells menu), or right-click a cell > Fill In Empty Cells.

**The selection MUST include the filled source cell.** Selecting only empty frames makes this command a no-op — nothing happens.

### Recommended workflow for exposing a drawing across many frames
1. Level > New > New Level... — creates a level and places a drawing reference in frame 1.
2. Click the frame 1 cell to start selection.
3. Drag down to the target frame (e.g. frame 100).
4. Cells > Fill In Empty Cells — all selected frames are now filled with the drawing reference from frame 1.

### Drag-to-Extend Handle
A small horizontal bar appears just below the last filled cell in a contiguous block. Drag it downward to extend the fill incrementally without re-invoking the menu. Best for small extensions (5–20 frames).

### Repeat Dialog
Cells > Repeat... — Opens a dialog with "Times" and "Up to Frame" fields. Set "Up to Frame" to a target frame number and click Repeat to fill.

## Right-Click Cell Context Menu
Load Level..., New Level..., Level Settings..., Reframe ▶, Step ▶, Each ▶, Edit Cell Numbers, Fill In Empty Cells, Autonumber, Replace Level, Set Key (Z), Shift Keys Down, Shift Keys Up, Cut, Copy, Paste Insert, Paste Special, Delete, Insert, Create Blank Drawing (Alt+D), Duplicate Drawing (D), Info..., View..., Apply Lip Sync Data to Column (Alt+L), Import Toonz Lip Sync File...

## Important Notes

- Xsheet and Timeline views show the same scene data; cell fill operations work identically in both.
- Use `drag_to()` for range selection when automating (Shift+click is not available via MCP).
- The drag-extend handle at the bottom of a filled block is distinct from drag-selecting cells — the handle extends an existing fill, while drag-selecting creates a new selection that requires Fill In Empty Cells to populate.

