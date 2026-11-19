# Applying Special Effects (OpenToonz 1.7)

All effects live in the **FX Schematic** — open it by clicking the schematic toggle in the bottom bar of the Schematic window until the title bar reads **FX Schematic**. Every column/layer appears as a node flowing rightward into the **Xsheet** node, then to the **Output** node. Effects slot in between.

To add an effect, select a column node and choose **Xsheet > New FX…** (or click the **New FX** button in the schematic's bottom bar) to open the FX Browser. Pick an effect and hit **Insert** to splice it into the existing link, or **Add** to branch a new link from the node. You can also right-click any node and use **Insert FX** / **Add FX** / **Replace FX** from the context menu.

Wire nodes by dragging an output port to an input port. To quickly re-route, **Alt-click and drag** an effect node onto a link to insert it, or away from a link to extract it. Delete a link by selecting it and pressing Delete.

To tweak parameters, double-click the effect node (or right-click > **Edit FX…**) to open the **FX Settings** window. Adjust sliders, color pickers, or spectrums as needed. A swatch preview at the bottom lets you check results — toggle it with the **Preview** or **Camera Preview** buttons. Some effects also expose gadgets directly in the Viewer; just select the node and drag the on-canvas handles.

Animate any parameter by clicking its small **Set Key** button (turns orange when a keyframe is set). Use the **Next Key** / **Previous Key** arrows to jump between keyframes. If no keys are set, values apply to the entire scene.

Save a tuned effect as a preset: right-click the node > **Save As Preset**, give it a name, and it appears inside the effect's folder in the FX Browser for future reuse. To build a reusable combo, select multiple effect nodes, right-click > **Make Macro FX** — the nodes collapse into a single macro node editable via tabs. Save the macro the same way (**Save As Preset**) and it shows up under the **Macro** folder in the browser.

---

## UI Reference  —  FX Schematic

_Scope: FX Schematic node graph, Insert FX/Add FX/Replace FX, FX Settings panel, Macro FX, Output nodes, bottom toolbar_

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

