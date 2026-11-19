# Animating with the Plastic Tool (OpenToonz 1.7)

The **Plastic** tool deforms drawings via a triangular mesh controlled by a skeleton. Select the column/layer containing your artwork, activate the **Plastic** tool, and click **Create Mesh** in the Tool Options bar. Adjust **Mesh Edges Length** for density — lower values give smoother bends but cost more to compute — then hit **Apply**. A purple mesh column appears in the Xsheet, linked to your texture column.

To refine the mesh, set **Mode: Edit Mesh**. You can drag mesh points, or right-click an edge to **Swap Edge**, **Collapse Edge**, **Split Edge**, or **Cut Mesh** for finer local control.

Switch to **Mode: Build Skeleton** to lay down vertices. Your first click places the root (solid purple square, static during animation). Each subsequent click adds a connected child vertex. Insert mid-bone vertices by clicking directly on a connecting line; branch by selecting an existing vertex before clicking a new position. Enable **Snap To Mesh** to lock vertices precisely to mesh points.

With the skeleton built, set **Mode: Animate**. Select a vertex, drag it to a new pose, and a keyframe is created automatically at the current frame. Advance frames and repose to build your motion. Enable **Keep Distance** to lock bone lengths, or **Global Key** to keyframe every vertex when you move just one. Right-click a vertex for **Set Rest Key** (resets one vertex) or **Set Global Rest Key** (resets the whole skeleton to its build pose).

For overlapping limbs, type a **SO** (Stacking Order) value in the Tool Options bar per vertex — higher values render on top.

Use **Mode: Paint Rigid** to brush rigidity directly onto the mesh. Paint with **Rigid** (turns areas red and stiff) or **Flex** (restores green, bendable areas). Adjust **Thickness** to control brush size.

A mesh can hold multiple skeletons — press **+** beside the **Skeleton:** dropdown to add one, useful for turnarounds or shape changes. Delete unwanted skeletons with **-**. Keyframes in the Function Editor live under **Plastic Skeleton** and expose per-vertex **Angle**, **Distance**, and **SO** channels. You can link vertices with expressions like `vertex(2, "Shoulder_right").angle * -1` for automatic mirrored motion.

Right-click the Viewer while the Plastic tool is active to toggle display of **Show Mesh**, **Show Rigidity**, **Show SO**, and **Show Skeleton Onion Skin** independently.

---

## UI Reference  —  Animate Tool Options Bar

_Scope: Global Key checkbox, SO (Stacking Order) field for overlapping limbs_

The Animate tool (shortcut A, topmost icon in the left tool sidebar — depicted as a running figure) populates the Tool Options bar with inline-editable numeric fields for transforming the selected column's position, scale, rotation, shear, or centre point.

## Layout

The Tool Options bar is a single horizontal strip that runs across the top of the canvas area, directly below the status line. When the Animate tool is active, this bar shows (left to right): a Column selector dropdown, a Mode selector dropdown, numeric parameter fields that change depending on the selected mode, and a Global Key checkbox at the far right.

## Elements

- **Column selector** dropdown — Leftmost control. Selects which column/peg to transform (e.g. "Col1").
- **Mode selector** dropdown — Second control, with an icon that changes per mode. Opens a list: Position, Rotation, Scale, Shear, Center, All.

### Position Mode Fields
- **X** field (mm) — First numeric field after mode selector, labelled "X:".
- **Y** field (mm) — Second, labelled "Y:".
- **Z** field (fld) — Third, labelled "Z:", unit is fields not millimetres. A parenthetical duplicate value appears immediately after.
- **SO** field — Stagger Offset, labelled "SO:", rightmost numeric field.

### Scale Mode Fields
- **Global** field (%) — First field, labelled "Global:".
- **H** field (%) — Horizontal scale, labelled "H:". A lock icon sits between H and V and may couple them.
- **V** field (%) — Vertical scale, labelled "V:".
- **Maintain** dropdown — Rightmost before Global Key. Options: None (default), A/R (maintain aspect ratio), Mass.

### All Modes
- **Global Key** checkbox — Far right of the options bar. When checked, committing any value sets a keyframe on ALL transform parameters simultaneously.

## Numeric Field Editing

- **Single click** activates inline text editing (a cursor appears in the field).
- **Ctrl+A** selects all text in the field.
- **Enter**, **Tab**, or clicking the canvas commits the value.
- **Tab** advances focus to the next field (e.g. X to Y in Position mode).

## Critical Quirks

- **Minus sign for negative values**: Must use `key_press('minus')` separately BEFORE typing the digit string. Using `type_text('-100')` silently drops the minus. Correct sequence: Ctrl+A, `key_press('minus')`, `type_text('30')`, Enter — commits `-30 mm`.
- **Scale H first-click quirk**: Clicking the H field for the first time after switching to Scale mode may open the Function Editor panel (highlighting Scale H in its parameter tree) instead of activating inline editing. Click the H field a second time to enter edit mode.

---

## UI Reference  —  Function Editor

_Scope: Driving Plastic vertices with expressions using vertex() syntax in Function Editor_

The Function Editor panel provides spreadsheet-style keyframe editing and a curve graph for animating parameter channels. Access via Windows > Function Editor, or it appears embedded in Animation/Schematic/Xsheet workspaces.

## Layout

The Function Editor is a floating or docked panel. Its top bar contains (left to right): a **Value spinbox** showing the active channel's value with unit suffix (e.g. "100 %"), a **Previous Key** button (left-pointing triangle), a **Set Key** button (orange diamond, lit when keyed), a **Next Key** button (right-pointing triangle), and a **Frame number** field. Below the top bar, the panel is split into a left spreadsheet area and a right configuration area. The spreadsheet has rows for frame numbers and columns for selected parameter channels. The right area has an Interpolation dropdown, From/To/Step fields, an Apply button, and a scene tree (Stage > Camera1, Table with X/Y/Z/SO/posPath/Rotation/Scale H/Scale V/Scale/Shear H/Shear V).

## Elements

### Top Bar
- **Value spinbox** — Leftmost field. Shows the active channel's numeric value at the current frame with a unit suffix (e.g. `100 %`). Click to edit, Enter to confirm.
- **Previous Key** (left triangle) — Navigates to the previous keyframe on the active channel.
- **Set Key** (orange diamond ◆) — Creates or confirms a keyframe at the current frame. Lit orange when a keyframe exists at this frame; dim (hollow ◇) when no keyframe.
- **Next Key** (right triangle) — Navigates to the next keyframe.
- **Frame number field** — Editable; typing a number and confirming changes the active frame.

### Spreadsheet (left panel)
- Rows represent frame numbers; columns represent selected parameter channels.
- **Single-click** a row navigates to that frame (does NOT open edit mode).
- **Double-click** a cell opens in-place editing; existing value is fully selected (blue highlight). Typing immediately replaces the old value.
- After editing, press **Enter** to confirm. The cell turns orange with a keyframe marker.

### Right Panel
- **Interpolation** dropdown: Linear, Speed In/Speed Out, Ease In/Ease Out, Ease In/Ease Out %, Exponential, Expression, File, Constant, Similar Shape.
- **From / To / Step** frame range inputs.
- **Apply** button.
- **Scene tree**: hierarchical parameter browser (Stage > Camera1, Table with all transform channels).

### Cell context menu (right-click)
Cut (Ctrl+X), Copy (Ctrl+C), Paste Insert (Ctrl+V), Delete (Del), Insert (Ins).

## Critical Quirks

- **Minus sign rejected in text input**: The `-` character is intercepted as a global OpenToonz shortcut. Typing `-50` directly is silently dropped — the minus never reaches the input field. **Workaround**: double-click cell, press BackSpace to clear the selected content, then use `key_press('minus')` to insert the minus sign, then type the digit string, then press Enter.
- **Value spinbox deferred sync**: After confirming a cell edit with Enter, the Value spinbox in the top bar continues to show the old value. Single-click the cell row again to force the spinbox to sync.

