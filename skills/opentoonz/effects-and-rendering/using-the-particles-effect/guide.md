# Using the Particles Effect (OpenToonz 1.7)

The Particles effect generates rain, snow, smoke, sparkles, or any repeated element from a source image. Parameters are organized across five tabs in the **Fx Settings** pane: **Source**, **Birth Params**, **Environment**, **Animation**, and **Colors**. Built-in presets are a great starting point — tweak from there.

**Setting up particle images:** Link any column/layer node to the **Texture** port on the Particles effect node in the schematic. Each connection opens a new Texture port, so you can feed in multiple source drawings. The particle inherits the column's animation and transformations — if your source spins, the particles spin too.

**Control images** let external artwork drive parameters like source area, speed, or gravity. Connect a column/layer to a **Control** port on the Particles node, then in **Fx Settings**, type that port's number into the relevant Control Image field (type **0** for none). Brightness in the control image maps to parameter intensity; transparent areas count as black.

**Source tab** defines where particles spawn. Set **Center** (X/Y), **Width**, and **Height** for a geometric region, or use a control image to confine birth to its opaque areas. Under Particle Generation, **Birth Rate** controls how many particles appear per frame (decimals work — 0.2 means one every five frames). Use a negative **Starting Frame** to let an effect "pre-roll" before frame 1, so a snowfall already looks full on the first visible frame.

**Birth Params** assigns each particle its lifetime traits. **Speed** and **Speed Angle** (0° = up, clockwise from there) set initial motion. **Size** is a percentage of original (randomized between min/max). **Orientation** rotates the texture, **Mass** matters when gravity is active, and **Lifetime** (in frames) determines when particles vanish. The **Trail** setting duplicates previous positions for a comet-tail look — adjust **Step** to thin it out. **Top Layer** controls z-order: Younger, Older, Smaller, Bigger, or Random.

**Environment tab** adds external forces. **Gravity** accelerates particles (angle 0° = down); point a control image at it and particles gravitate toward bright regions instead. **Friction** opposes motion — crank it high to stop particles dead in a bright area. **Wind** adds constant velocity (no acceleration) at a given angle. **Scattering** introduces random jitter per frame; switch **Swing Mode** to **Smooth** for gentler oscillation over the frame count you set.

**Animation tab** transforms particles over their lifespan. **Rotation Speed** spins all particles uniformly (not a birth attribute), while **Extra Speed** adds per-particle randomness. Enable **Follow Particles Movement** to orient textures along their trajectory. **Opacity** fade-in/fade-out ramps transparency at birth and death over a set frame count. **Size Increase** scales particles each frame — positive grows, negative shrinks.

**Colors tab** tints particles at three life stages. Define a color spectrum (or use a control image) for **Birth Color**, **Fade-in Color**, and **Fade-out Color**, each with its own intensity, spread, and frame range. Enabling **Pick Control Image's Color for Every Frame** re-samples color at the particle's current position rather than locking it at birth.

---

## UI Reference  —  FX Schematic

_Scope: Connecting Texture/Control ports on Particles node, FX Settings tabs (Source, Birth Params, Environment, Animation, Colors)_

The FX Schematic is a node-graph panel for wiring effects into the render pipeline. It is visible in the lower half of the Schematic workspace, or can be opened via Windows > Schematic.

## Layout

The FX Schematic panel has a dark canvas where effect nodes are displayed as labelled rectangular boxes connected by teal/cyan wires showing data flow. In a default scene, two nodes are present: a blue **XSheet** node (representing the column stack) on the left, connected by a wire to a blue **Output** node (the final render target) on the right. A horizontal toolbar runs along the bottom edge of the panel. The toolbar is split into two groups: navigation/view controls on the left, and node-creation/toggle controls on the right.

## Bottom Toolbar (left to right)

Left group:
1. **Selection Mode** (arrow icon) — Click nodes to select them.
2. **Zoom Mode** (magnifier icon) — Left-click zooms in; right-click zooms out.
3. **Hand Mode** (hand icon) — Drag to pan the canvas.
4. **Fit to Window** (four inward arrows icon) — Zooms and re-centres to show ALL nodes. Key recovery tool after inserting off-screen effects.
5. **Focus on Current** — Centres the view on the selected node.
6. **Reorder Nodes** — Auto-layouts all nodes left-to-right.
7. **Reset Size** (labelled "1:1") — Resets zoom to 100%.
8. **Maximize Nodes** — Toggles between compact (name only) and expanded display (shows port labels like Texture1/Control1/Source/Link, a blue preview play triangle, and identity icons).

Right group:
9. **New FX** — Adds an unconnected FX node.
10. **New Output** (Alt+O) — Adds another Output node.
11. **Toggle node icons** — Shows/hides icon buttons on node headers.
12. **Toggle FX/Stage** — Switches between FX Schematic view and Stage Schematic view.

## Adding Effects

### Right-click empty area > Add FX
Drops an unconnected node. The submenu shows 15 effect categories: Background, Blur, Distort, Gradient, Image_Adjust, Layer_Blending, Layer_Blending_Ino, Light, Matte, Noise, Render, Stylize, Toonz_Level, Shaders, Utility. Each category expands to individual effects.

### Right-click node > Insert FX
Inserts the effect inline BETWEEN the selected node and its downstream connections, automatically wiring it in.

### Right-click node > Replace FX
Swaps the selected node for a different effect type, preserving connections.

### Node context menu (additional items)
FX Editor (Ctrl+K), Copy, Cut, Paste Replace, Paste Add, Delete, Disconnect from Xsheet, Create Linked FX, New Output (Alt+O), Preview, Cache FX, Make Macro FX, Save As Preset..., Collapse, Group (Ctrl+G).

## FX Settings Panel

Opens on **double-click** of an effect node, or via right-click > FX Editor (Ctrl+K). Also opens automatically when inserting a new effect. This is a floating window that updates to show the selected node's parameters when a different node is single-clicked.

- Numeric fields require **double-click** to activate text editing, then Enter to confirm.
- Diamond icons (◇) beside fields indicate animatable/keyframeable parameters.

### Example: Particles effect
Five tabs: Source, Birth Params, Environment, Animation, Colors. Key controls include Birth Rate, Speed, Size, Lifetime, Gravity, Wind, Opacity, and colour gradient editors with RGBA swatches. A collapsible Swatch Viewer section provides a live effect preview.

### Example: RGBA Scale effect
Simple single-panel layout with four fields: Red (0–100), Green (0–100), Blue (0–100), Alpha (0–100), all defaulting to 100. Each has a keyframe diamond (◇).

## Important Notes

- After inserting an effect, always click **Fit to Window** to locate it — nodes may appear off-screen.
- **Insert FX** (node context menu) wires the effect inline; **Add FX** (empty area context menu) drops a disconnected node. Both share the same 15-category submenu.
- Scroll wheel zooms the schematic canvas (up = zoom in, down = zoom out).

