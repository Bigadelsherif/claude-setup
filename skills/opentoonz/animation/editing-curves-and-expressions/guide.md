# Editing Curves and Expressions (OpenToonz 1.7)

The **Function Editor** is your control center for keyframes and interpolations. Open it via **Windows > Function Editor**. The left pane shows either a Spreadsheet (numeric columns) or a Graph Editor (visual curves); the right side holds the interpolation controls and the objects/effects tree. Both views reflect the same data — edits in one appear in the other.

In the objects/effects tree, expand a folder (Stage or FX) and click a parameter icon to show its curve or column. Animated parameters display a wavy-line icon; static ones show a dotted line. Right-click a folder and choose **Show Animated Only** to filter clutter.

To add a keyframe in the Spreadsheet, double-click a cell, type your value, and press **Enter**. In the Graph Editor, Ctrl-click (Cmd-click on Mac) directly on the curve, or navigate to the desired frame and click the **Set Key** button in the toolbar. Drag control points to reposition them; Shift-click to multi-select.

Each segment between two keyframes carries an interpolation type. Select a segment, pick from the **Interpolation** dropdown (Linear, Speed In / Speed Out, Ease In / Ease Out, Ease In / Ease Out %, Exponential, Expression, File, Constant, or Similar Shape), then hit **Apply**. For Speed In / Speed Out, drag the Bezier handles on each control point — right-click a point and choose **Unlink Handles** to break tangent symmetry, or **Reset Handles** to recover collapsed ones.

For expression-driven segments, choose **Expression** as the interpolation type and write a formula in the text field. Use `t` (0–1 across the segment), `f` (current frame), or reference other objects like `col1.x` or `fx.blur2.value`. Standard math (`sin()`, `clamp()`, `random(min,max)`) and conditionals (`(f>10)?1:0`) are supported. Color-coded syntax highlighting confirms valid terms; errors show in red. Hit **Enter** to validate, then **Apply**.

To loop an animation, right-click the dashed tail past your last keyframe and choose **Activate Cycle**. You can also save any parameter's curve via right-click > **Save Curve** (exports a .curve file) for reuse across scenes, or **Export Data** to produce a .dat file for external tools.

When multiple curves are visible in the Graph Editor, the strip below the frame ruler lets you move shared keyframes and adjust Ease/Speed markers across all visible parameters simultaneously — handy for syncing a camera truck with an effect animation in one drag.

---

## UI Reference  —  Function Editor

_Scope: Spreadsheet cells, Set Key button, interpolation dropdown, scene tree, keyframe navigation arrows, value spinbox_

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

