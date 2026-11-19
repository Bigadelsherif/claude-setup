# Creating Cutout Animation (OpenToonz 1.7)

Cutout animation works by splitting a character into separate sections — head, body, arms, legs — each on its own Xsheet column or Timeline layer. Instead of drawing new poses, you animate by rotating and moving those pieces.

**Building the skeleton.** Select the **Skeleton** tool and set its mode to **Build Skeleton**. Click a section in the Viewer to select it. Each section gets a handle: drag the **yellow circle** to position the pivot point (e.g., a shoulder joint), then drag the **square** at the top of the handle onto another section to parent it. Work outward from the trunk — set the trunk's pivot, link the arm to the trunk, link the forearm to the arm, and so on. To break a link, drag the square in the middle of the connecting wire away from the parent.

**Using hooks for animated sections.** If a section is itself an animated level (say, a bending trunk), fixed pivot points won't track the drawings. Place hooks on each drawing with the **Hook** tool (enable **Snap** to align hooks across levels precisely). In **Build Skeleton** mode, click a hook's label to promote it to that section's pivot, then drag the handle square to a hook on the parent section. When two hooks overlap perfectly, a shortcut label appears — click it to link instantly.

**Animating the model.** Switch the **Skeleton** tool mode to **Animate**. Click anywhere in the Viewer and drag to rotate the selected section; drag the **green square with four arrows** to translate it. Each adjustment auto-creates a keyframe on that frame. Enable **Global Key** in the tool options bar to keyframe all transforms (position, rotation, scale, shear) together — handy for adding squash-and-stretch later.

**Inverse Kinematics.** Set the mode to **Inverse Kinematics** and just drag any endpoint — the entire limb chain solves automatically. The **pinned center** (shown as a blue square) anchors one joint in place; click any other joint to re-pin it at a different frame, which is essential for walk cycles. **Shift-click** a joint to temporarily pin it for one pose only. To start fresh, right-click the Viewer and choose **Reset Pinned Center**.

Flip through alternate drawings for a section by clicking the **level name label** next to the pivot and dragging up/down. Toggle **Show Only Active Skeleton** in the tool options bar to declutter complex rigs.

---

## UI Reference  —  Animate Tool Options Bar

_Scope: Animate mode rotation/translation transforms, Global Key for keying all channels, column selector for skeleton sections_

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

