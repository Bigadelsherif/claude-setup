# Creating Movements (OpenToonz 1.7)

Every scene object — columns/layers, pegbars, cameras, the table — can be transformed and animated. Set a transformation at a given frame and OpenToonz creates a keyframe; add another keyframe later and in-betweens are interpolated automatically.

Open the Stage Schematic via **Window > Schematic**, then toggle the **FX/Stage** button in the bottom bar until the title reads "Stage Schematic." This node graph shows every object and its parent-child links. Drag from a node's left port to another node's right port to link them — child objects inherit their parent's movement and add their own on top.

To animate, grab the **Animate** tool and select an object (click it in the Viewer with **Pick: Column** or **Pick: Pegbar**, or select its node in the schematic). Set the **Mode** to **All** to get the full on-canvas handle: drag anywhere to reposition, drag the circle tip to rotate, the double-square tip to scale, or the parallelogram tip to shear. Each interaction auto-creates a keyframe for that transformation only — enable **Global Key** in the tool options if you want every property keyed at once.

For path-based motion, click **New Motion Path** in the schematic's bottom bar, draw the path in the Viewer with any drawing tool, then drag the path node's top port onto the object's bottom port. The object snaps to the path start and its position is now expressed as a percentage (0–100%) along the curve. Toggle the square/rotated-square icon on the object's bottom port to choose between preserving orientation or auto-rotating along the path.

Hooks let you pin objects to specific features of an animation level. Select the **Hook** tool, click on a drawing to place a numbered reference point, then in the schematic scroll the column's port numbers (hover the port, drag the double-arrow) to link another object to that hook. For walk cycles, place a hook on the grounded foot and **Alt-drag** to split it when weight transfers — this prevents the classic moon-walk.

To work in 3D, click the **3D View** button in the Viewer title bar. Adjust any object's **Z** value in the Animate tool options to push it farther from or closer to the camera — closer objects composite on top regardless of column order. Use the **SO** field to override stacking order without rearranging columns when you need a layer to pop in front or behind mid-scene.

---

## UI Reference  —  Animate Tool Options Bar

_Scope: Animate tool Object dropdown, Mode selector, X/Y/Z/SO fields, Global Key checkbox, position/rotation/scale/shear handles_

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

_Scope: Keyframe timing refinement for object transforms set via Animate tool_

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

