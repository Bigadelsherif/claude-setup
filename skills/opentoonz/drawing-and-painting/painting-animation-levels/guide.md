# Painting Animation Levels (OpenToonz 1.7)

Every Toonz level drawing is made of **lines** (strokes from scanned or vector art) and **areas** (regions enclosed by closed lines). You paint both using styles stored in the level's palette.

**Filling areas** is the core workflow. Grab the **Fill** tool, set Mode to **Areas**, pick a style from the Palette, and click inside any closed region. If color won't flood into tight corners on raster drawings, bump up the **Fill Depth** value or Shift-click to use the maximum. For vector drawings, outlines can be a single closed vector or several joined vectors — both work.

To paint many areas at once, switch the Fill type to **Rectangular**, **Freehand**, or **Polyline** and drag a selection — everything fully enclosed gets filled. Combine this with the **Selective** option to only hit unpainted areas, which is great for a final cleanup pass. The **Frame Range** option lets you click the same region on a first and last frame, and OpenToonz interpolates the fill across the whole range automatically.

**Painting lines** works similarly: set the Fill tool's Mode to **Lines** and click a stroke. On Toonz Raster levels, clicking paints the entire continuous line sharing that style. For partial recoloring, activate the **Segment** option (splits lines at thickness/direction changes) or use the **Paint Brush** tool set to **Lines** mode and brush over just the section you want.

When areas won't fill because of gaps in the outline, use the **Tape** tool. For vector drawings, set Mode to **Endpoint to Endpoint** (or **Endpoint to Line**) and drag across the gap. For raster drawings, just click in the viewer — it auto-closes gaps within the set **Distance** and **Angle** thresholds. Enable **View > Gap Check** to preview which gaps the Tape tool can currently detect.

Use **View > Transparency Check** or **Paint Check** to verify coverage — unpainted slivers along antialiased edges become obvious. The **Onion Skin** option on the Fill tool lets you pick styles directly from a previously painted frame and apply them to the current drawing in one click-and-release gesture.

**Match lines** let you merge drawings from two columns. Expose the base level and the match-line level side by side, select both column headers, then choose **Xsheet > Apply Match Lines…**. You can preserve original ink styles, force a single ink, or let OpenToonz merge matching indexes automatically.

For shadow/highlight lines that should auto-match their adjacent fill color, select the line's style in the Palette, open the **Style Editor > Settings** page, and enable **Autopaint for Lines**. Now whenever you fill an area bordered by that style, the line takes on the area's color.

**Color models** serve as your painting reference. Load one via **File > Load Color Model…** (or drag an image into the Color Model viewer). You can click directly on the color model to pick styles without switching tools. Store a color model alongside a Studio Palette entry and it auto-loads whenever that palette is assigned to a level.

---

## UI Reference  —  Right Color/Palette Panel

_Scope: Style picking via palette chips for Fill/Paint Brush tools, current style preview bar, Autopaint for Lines in Settings tab_

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

