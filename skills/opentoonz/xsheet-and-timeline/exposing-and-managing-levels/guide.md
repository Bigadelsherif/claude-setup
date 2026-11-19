# Exposing and Managing Levels (OpenToonz 1.7)

Levels — animation sequences, background images, clips — need to be exposed in the Xsheet (or Timeline) to appear in your scene. Each column holds one level, each row is a frame, and cells are just references to drawings, not copies.

The **File Browser** is your main entry point for bringing assets in. Its left tree gives you **My Computer**, **Library**, **History**, and your **Projectroot** folders. Drag files straight from the browser into the Xsheet, or use **Level > Load Level…** to pick a file and optionally set a frame range with **Load Subsequence Level**. You can also load entire directories via **File > Load Folder…**. Files dragged from Finder/Explorer work too.

When loading assets stored outside your project, OpenToonz asks whether to **Import** (copy into your project's `+drawings`/`+extras` folders) or **Load** in place. Importing is strongly recommended — OpenToonz may overwrite level files on save.

Once loaded, every level lives in the **Scene Cast** regardless of whether it's currently exposed. To expose something from the Cast, select it and choose **Level > Expose in Xsheet**, or just drag it onto a cell. To pull specific frames from a level, display it in the **Level Strip** (right-click in the Cast > **Display in Level Strip**), select the drawings you need, then drag them into the Xsheet.

To swap one level for another while keeping your cell timing intact, select the exposed cells and choose **Level > Replace Level…**, then pick the new file.

Open **Level Settings** (right-click a level in the Xsheet > **Level Settings…**) to adjust the **Name**, **Path**, **DPI**, **Width/Height**, or toggle **Premultiply** and **White As Transparent**. Hit **Use Camera DPI** if the level matches camera size but displays at the wrong scale. **Subsampling** speeds up playback by skipping pixels — handy for heavy raster levels.

Control column visibility with the header toggles: the eye icon shows/hides in the viewer, the filmstrip icon includes/excludes from renders, and the lock prevents edits. Click the triangle for per-column **Opacity** and **Color Filter** overlays.

---

## UI Reference  —  Xsheet View & Cell Operations

_Scope: Loading levels into Xsheet cells, Level Strip cherry-picking, cell drawing references, level exposure workflow_

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

