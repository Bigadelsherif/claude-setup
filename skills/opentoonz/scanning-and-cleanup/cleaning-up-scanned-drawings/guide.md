# Cleaning Up Scanned Drawings (OpenToonz 1.7)

Scanned drawings need cleanup before you can paint or edit them in OpenToonz. The process autocenters drawings to pegbar holes, recognizes line art, and crops/resizes everything to fit your camera. The output is a TLV level with a paired TPL palette.

Open the cleanup dialog via **Scan & Cleanup > Cleanup Settings…**. You'll see three sections: Cleanup, Processing, and Camera. Dial in settings on one drawing, then apply them to the whole level.

**Autocenter** aligns drawings using pegbar holes captured during scanning. Enable the checkbox, pick which side the **Pegbar Holes** are on, and choose the matching **Field Guide** (e.g., Acme or Oxberry). Preview with **Scan & Cleanup > Preview Cleanup** to confirm registration is correct. Use **Rotate** and **Flip** if drawings were scanned at a different orientation.

For **Line Processing**, set the mode to **Greyscale** (black lines) or **Color** (colored lines). Key sliders: **Sharpness** controls edge hardness, **Despeckling** removes small dust spots (value = max pixel size removed), **Brightness** controls line thickness (lower = thicker), and **Contrast** controls antialiasing solidity. Toggle **Scan & Cleanup > Opacity Check** (Alt+1) to visualize solid pixels in black, antialias in red, and despeckled areas in green.

For color line processing, add up to 7 colors with the **+** button. Each color gets its own **H Range** (hue tolerance) and **Line Width**. Use the RGB Picker tool to sample colors directly from your scan.

The **Camera** section sets the crop and resolution of cleaned output. Match it to your scene camera or make it larger if you need overflow. Adjust the **N/S** and **E/W** offsets to shift the center. Use **Scan & Cleanup > Camera Test** to see a red crop box overlaid on your drawing and drag its handles to resize interactively.

Save settings as CLN files via the **Save** button at the bottom of the dialog. Name a CLN file identically to a level and store it in the same folder — OpenToonz will auto-load it for that level. Hit **Reset** to revert to scene defaults.

When you're ready, select drawings in the Xsheet and run **Scan & Cleanup > Cleanup**. A per-frame dialog lets you **Cleanup**, **Skip**, **Cleanup All**, or **Cancel**. Processed cells turn green. For background processing, add scenes as cleanup tasks in the **Tasks** pane using the **Add Cleanup Task** button, then hit **Start**.

Enable **File > Preferences… > Drawing > Keep Original Cleaned Up Drawings As Backup** to store originals in a `nopaint` subfolder — you can revert anytime via **Level > Revert to Cleaned Up**.

---

## UI Reference  —  Right Color/Palette Panel

_Scope: Cleanup Palette Settings tab: Brightness, Contrast, ColorThres, WhiteThres sliders_

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

