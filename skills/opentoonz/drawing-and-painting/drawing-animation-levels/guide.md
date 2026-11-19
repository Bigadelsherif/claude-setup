Here's the guide:

# Drawing Animation Levels (OpenToonz 1.7)

OpenToonz supports three level types: **Toonz Vector** (PLI, resolution-independent), **Toonz Raster** (TLV, bitmap with palette), and **Raster** (TIF sequences). Set your default via **File > Preferences… > Drawing** under **Default Level Type**.

To create a new level, select an empty Xsheet/Timeline cell and choose **Level > New > New Level…** — pick your type, set frame count, step, and increment, then hit OK. Alternatively, set **Autocreation** to **Enabled** in Preferences and just start drawing on an empty cell; a level is created automatically. The **Use Xsheet as Animation Sheet** autocreation mode mimics traditional workflow — keys first, then breakdowns and inbetweens, with drawing numbers taken from the scene frame.

The **Brush** tool supports pressure sensitivity for variable-thickness strokes. Adjust **Size Min/Max** with Ctrl+Alt drag (horizontal for max, vertical for min). The **Geometric** tool draws rectangles, ellipses, circles, polygons, polylines, and arcs with constant thickness. Both tools offer **Snap**, **Pencil** mode, and **Cap/Join** options for vector work.

For vector animation, duplicate a drawing via **Cells > Duplicate Drawing**, then reshape it with the **Pinch**, **Pump**, **Bender**, or **Iron** tools — paint fills follow shape changes automatically. The **Inbetween** command interpolates between two key drawings: select a frame range in the Level Strip, click the vertical **INBETWEEN** bar, choose an easing (Linear, Ease In, Ease Out, Ease In/Out), and confirm.

**Onion Skin** lets you see adjacent frames as ghosted overlays. Click the diamond markers left of the Xsheet frame column for relative mode (moves with the cursor), or the ghosted markers further left for fixed mode (stays on a specific frame). Customize transparency and tinting under **File > Preferences… > Onion Skin**. Right-click the viewer and choose **Extend Onion Skin to Scene** to see all columns, or **Limit Onion Skin to Level** for just the active one.

**Shift and Trace** simulates a light table for inbetweening. Enable **View > Shift and Trace** on the target frame, then activate **View > Edit Shift** to reposition the previous/next reference drawings — drag inside the bounding box to move, outside to rotate, or Ctrl-drag to create a path-of-action line that aligns both references automatically. Toggle **View > No Shift** to compare, and **View > Reset Shift** to start over.

---

## UI Reference  —  Right Color/Palette Panel

_Scope: Level Strip filmstrip for navigating and rearranging frames in the current level_

The right-side panel in Drawing mode contains three stacked sections: Cleanup Palette (colour editor), Level Palette (style list), and Level Strip (frame filmstrip). Together they occupy the right edge of the window from below the room tabs down to the bottom playback area.

## Layout

The panel is docked to the right side of the window. At the top is the Cleanup Palette header bar showing the active style index and name (e.g. "#1 : color_1"). Below it are two tabs: **Color** (default, active) and **Settings**. The Color tab contains a large hexagonal colour wheel, followed by H/S/V/A slider rows, an Auto/Apply button row, colour swatches, and utility buttons. Below the Cleanup Palette section is the Level Palette style list. The far-right narrow column is the Level Strip filmstrip. At the very bottom of the Level Strip are five small navigation buttons.

## Elements

### Cleanup Palette — Color Tab

- **Hexagonal colour wheel** — Large hexagon occupying most of the upper section. Click or drag inside to set Saturation (horizontal axis) and Value/brightness (vertical axis). Hue is NOT set by clicking the wheel; it changes only via the H slider. When H changes, the displayed colours in the hexagon rotate accordingly. A small crosshair dot marks the current S/V position.
- **H slider row** (0–360) — Hue. Contains: a numeric field (double-click to edit, type value, press Enter), left/right step buttons (±1 per click), and a full-width rainbow gradient bar. Scroll wheel over the slider adjusts ±3 per tick.
- **S slider row** (0–100) — Saturation. Same layout as H. Gradient bar runs from grey to the current hue at full saturation.
- **V slider row** (0–100) — Value/brightness. Gradient bar runs from black to the current hue at full brightness. Scroll wheel adjusts the value.
- **A slider row** (0–255) — Alpha/opacity. Default 255 (fully opaque). Gradient bar runs from transparent to fully opaque.
- **R/G/B slider rows** (0–255 each) — Hidden by default. Enable via the Show/Hide hamburger button (☰). Three additional rows for Red, Green, and Blue. Editing RGB updates HSV and vice versa.
- **Auto button** — Left button in the Auto/Apply row below the sliders. Toggle: when ON, every slider or wheel change immediately commits to the palette style. When OFF, only the Apply button commits.
- **Apply button** — Right of the Auto button. Manually commits the current colour values to the selected style.
- **Current Style preview bar** — Wide solid-colour bar to the right of Auto/Apply, showing the committed colour of the active style. Read-only.
- **New-colour / Old-colour swatches** — Two small squares at the far left below the Auto/Apply row. Left swatch shows the pending-edit colour; right swatch shows the last-committed colour. Side-by-side before/after comparison.
- **Toggle orientation button** (⟺ icon) — Small button at the right end of the swatch row. Switches the Color tab layout between vertical (wheel on top, sliders below — default) and horizontal (wheel on left, sliders in a column on right).
- **Show/Hide button** (☰ hamburger icon) — Immediately right of the Toggle Orientation button. Opens a checklist dropdown with: Wheel (checked), HSV (checked), Alpha (checked), RGB (unchecked by default). Unchecking a section hides it; enabling RGB adds R/G/B slider rows.

### Cleanup Palette — Settings Tab

- **Autopaint for Lines** checkbox (unchecked by default)
- **Brightness** slider and numeric field (default 0)
- **Contrast** slider and numeric field (default 50)
- **ColorThres** slider and numeric field (default 70)
- **WhiteThres** slider and numeric field (default 10)

### Level Palette

Style list for the current level, located below the Cleanup Palette section. Shows "- No Styles -" when no level is loaded.

- **Freeze button** (‖ pause icon) — At the right end of the Level Palette header row. Locks the display so it does not update when a different level is selected.
- **Right-click context menu** on the style list: Copy (Ctrl+C), Paste Color & Name, Paste Color, Paste Name, Paste Insert (Ctrl+V), Cut (Ctrl+X), Delete (Del), Palette Gizmo, Style Editor, Name Editor.
- **Palette Gizmo dialog** (via right-click > Palette Gizmo) — Batch adjustment: Value/Saturation/Hue/Alpha rows with Scale% and Shift controls; Blend, Full Alpha, Zero Alpha buttons; Fade to Color section with R/G/B/A fields and a percentage slider.

### Level Strip

Vertical filmstrip of frame thumbnails in a narrow column at the far right. A dropdown at the top selects the current level (shows "- No Current Level -" when none is loaded).

- **Navigation buttons** (bottom of strip, left to right): Previous Key, Set Key, Next Key, New Style, New Page.
- **Right-click context menu** on frame cells: Select All (Ctrl+A), Invert Selection, Cut, Copy, Paste Insert, Delete, Reverse, Swing, Step 2/3/4, Each 2/3/4, Duplicate Drawing (D), Expose in Xsheet, Panel Settings ▶ (Toggle Orientation / Show/Hide Drop Down Menu / Show/Hide Level Navigator).

