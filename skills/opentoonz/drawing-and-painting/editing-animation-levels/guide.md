No images referenced in this file. I have everything I need from the text content to write the guide.

# Editing Animation Levels (OpenToonz 1.7)

The Level Strip is your main workspace for rearranging an animation level. Open it by selecting any cell belonging to the level in the Xsheet/Timeline, or right-click the level in the Scene Cast and choose **Display in Level Strip**. It shows every drawing in the level by numbering order — even frames not currently exposed.

Select frames by clicking, shift-clicking for ranges, or Ctrl/Cmd-clicking to cherry-pick. From there, standard **Cut**, **Copy**, **Paste**, and **Delete** operations work as expected. **Paste Into** overwrites the target selection rather than inserting. **Insert** adds blank frames before your selection and renumbers everything after.

To reorder or repeat frames, look under the **Cells** menu: **Reverse** flips the selection, **Swing** appends a mirror of it, and **Step 2/3/4** repeats drawings for held-frame animation. **Each 2/3/4** thins the selection down. **Duplicate Drawing** copies the first selected drawing into the next frame slot.

When you need room for new drawings, use **Level > Renumber...** to set a custom start frame and step, or **Level > Add Frames...** to inject a numbered range directly. Both fail if the target numbers already exist.

To merge multiple levels into one, select the columns/layers and run **Xsheet > Merge Levels** (for vector or standard raster) or **Xsheet > Merge TLV Levels** (for Toonz Raster). The leftmost column drives the frame count and resolution. Each column must contain only one level.

For image processing, select frames then visit **Level > Adjust**. Options include **Brightness and Contrast...**, **Color Fade...**, **Antialias...**, **Adjust Levels...**, and **Binarize...**. For vector levels only, **Adjust Thickness...** lets you scale, add, or set constant stroke width across a range. All dialogs have a resizable preview area.

If you make a mistake, select the affected frames and hit **Level > Reload** to revert to the last saved version. For cleaned-up Toonz Raster levels, **Level > Revert to Cleaned Up** restores the original cleanup output (requires the backup preference enabled).

Save your work with **Level > Save Level** or **Level > Save Level As...** for a renamed copy. The scene-wide **Save All** also persists all modified levels at once. Enable **Backup Scene and Animation Levels when Saving** in Preferences to keep `_backup` copies automatically.

To export for other software, use **Level > Export Level...**. Pick from BMP, JPG, PNG, TGA, TIF, or TLV (vector-to-TLV only). For vector exports you can set output size, line thickness range, and toggle **No Antialias**. The **Retas Compliant** option auto-names files with four-digit suffixes in TGA format. Exported files are independent copies — the scene still references the original level.

---

## UI Reference  —  Xsheet View & Cell Operations

_Scope: Level Strip frame manipulation, Duplicate Drawing, Create Blank Drawing in right-click menu_

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

