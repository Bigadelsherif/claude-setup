# Managing Palettes and Styles (OpenToonz 1.7)

Every Toonz Vector and Toonz Raster level carries its own palette — styles are linked by index, so editing a color instantly updates every line and fill that uses it. Raster levels share a single **Raster Drawing Palette** stored in the project's **+palettes** folder.

The **Palette Editor** shows styles for the active level. Toggle the thumbnail size with the option button in the top bar or zoom with **+**/**-** keys. Click the **Switch** button in the title bar to freeze the editor on one palette while you work elsewhere. Add styles with **New Style**, organize them into pages via **New Page**, and drag styles between pages with Ctrl/Cmd+drag. Right-click and choose **Remove Unused Styles** to clean house.

The **Studio Palette** (under **Windows > Studio Palette**) is your production-wide color library. It splits into **Global Palettes** (available in every session) and **Project Palettes** (scoped to the current project). Drag a level's palette handle into the Studio Palette tree to store it, then later right-click a stored palette and choose **Load into Current Palette** or **Merge to Current Palette** to bring colors back. Imported styles show a small white square; right-click and choose **Toggle Link to Studio Palette** to keep them synced with the master.

To animate palette colors, select a frame in the Xsheet/Timeline and click the **Key** button in the Palette Editor's top bar. Navigate keys with the **Previous Key** / **Next Key** arrows. Animation is tied to absolute Xsheet timing, independent of level length.

Open the **Style Editor** via **Windows > Style Editor** (or double-click any style). Tabs include **Color**, **Texture**, **Vector** (Generated, Trail, Vector Brushes), and **Raster**. Use the color wheel or HSV/RGB sliders to tweak colors; the **Alpha** slider controls opacity. Toggle **Auto** to apply edits live, or leave it off and hit **Apply** manually. To revert, click the old-color swatch at the bottom-right corner.

For batch adjustments, select multiple styles, right-click, and open **Palette Gizmo** — it lets you scale or shift hue, saturation, value, and alpha across the selection, blend between endpoints, or fade toward a target color. The **Name Editor** (also in the right-click menu) helps standardize style names with preset Character, Part, and Suffix tokens.

---

## UI Reference  —  Right Color/Palette Panel

_Scope: Level Palette style list, Palette Gizmo, color wheel, HSV/RGB sliders, Auto/Apply buttons, New Style/New Page, Freeze button_

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

