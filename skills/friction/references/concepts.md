# Core concepts

Verified against the docs pages (Usage, User Interface, Tips, Animation techniques,
Effects) and source (`src/core/Boxes/`, `src/core/*Effects/*menucreator.cpp`,
`src/core/Animators/transformanimator.cpp`, `src/core/canvas.h`, `src/app/GUI/menu.cpp`,
release notes rc.1-rc.3).

## Project, scenes, timeline

- A project holds any number of **scenes** (internally `Canvas`). Each scene: width,
  height, frame range (first/last frame), FPS, background color (can be transparent).
  Scene > Scene Properties edits them; width/height/start/end are also exposed in the main
  window.
- Friction works in **frames**. Seconds in dialogs are converted using FPS.
- Scenes can be **linked** into other scenes (right-click canvas > Link scene). A linked
  scene box can get **Frame Remapping** (adds an animatable `frame` property) - the basis
  for loops and time remaps.
- **Markers**: Scene menu > Add Marker / Clear Markers / Edit Markers (marker editor dialog
  with titles); also Set In / Set Out / Clear In/Out for an in/out range. Undoable since
  rc.3.
- Playback: Play renders to a preview cache then plays in real time; disable View >
  Preview Cache to play uncached (shows handles, may drop below real time).
- Layouts: named canvas/timeline split configurations.

## Objects ("boxes")

Box types in `src/core/Boxes/`: path (`SmartVectorPath`), rectangle, circle, text,
image, image sequence, video, sound, group (`ContainerBox`), layer, linked SVG, internal
link (linked object / linked scene), null object.

- **Group** vs **Layer**: a group only combines transforms (group opacity does not apply).
  A **layer** is a group that is rasterized before drawing; use it when you need opacity,
  raster effects on the group, or blend-mode masking. Right-click a group > promote to
  layer.
- Stacking: top of the Timeline list draws on top. PageUp/PageDown/Home/End reorder.
- **Visibility range**: each object has one visible frame range; Split it (right-click) to
  get multiple ranges (creates a new object).
- **Null object** (F8): invisible reference/controller, typically a target for transform
  effects.
- **Flip book**: on a group/layer, children become frames; an animatable `index` picks
  which child is shown (frame-by-frame animation).
- **Custom Properties**: right-click > Custom Properties shows a `properties` group;
  add single- or two-value properties to drive expressions.

## Paths and nodes

- Tools: Path create (F3), hand-drawn path (F4, automatic/manual fitting), point edit
  (F2). Circles/rectangles/text must be converted (Path > Object to Path, Shift+Ctrl+C)
  for node editing and for Sub-Path/trim effects.
- The whole path shape is one animatable property: keyframe it to morph. Morphing matches
  nodes **by index**; show indices with Ctrl+Shift in point mode.
- **Dissolve nodes**: on animated paths, a node can be dissolved (disabled) at a keyframe
  or "dissolve approximated", and later promoted back to normal - lets shapes with
  different node counts morph. Copy path / paste path between paths auto-handles
  different node counts.
- rc.3 node actions: Remove Node, Split Nodes, Set First Node, Reverse Nodes Order.
- Shift-dragging a node onto another object's node copies its position and handles.
- Dynamic path operations: boolean ops between sub-paths that stay live while animated.
- Fill and Stroke panel: fill/stroke type None, Flat, Gradient (linear/radial), stroke
  width/join/cap.

## Transforms

Every box has a `transform` group (names verified in source): `translation` (x, y),
`rotation`, `scale` (x, y), `shear` (x, y), `pivot` (x, y), `opacity`, plus hidden
`begin event` / `end event` (Interactive SVG Properties). rc.3 adds on-canvas **gizmos**
(position/rotation/scale/shear handles), a **grid**, and **snapping** to canvas, boxes,
nodes, pivots or grid (Shift+Tab toggles; hold Shift to bypass, Ctrl to force).

Canvas keys for selected objects: G move, R rotate, S scale, then X/Y to constrain, type a
number, Enter or release to apply, Esc/right-click to cancel. P toggles local/global pivot.
Align panel (bottom of Properties): align geometry, geometry by pivot, or pivot only,
relative to Scene, Bounding box, Last selected object or Last selected pivot.

## Keyframes and the graph editor

- Click the dot next to a property to start recording (red); keys are added whenever the
  value changes. Insert adds a key at the current frame; Delete removes selected keys;
  clicking the red dot again removes all keys (keeps the current value).
- Timeline: drag keys, copy/paste, Shift+D duplicate-and-move, Ctrl+D duplicate in place.
  Bookmark colors can tag items.
- Default interpolation is linear. In the Timeline select one or more properties
  (Shift-click to add) and press the Graph button. Tools: easing presets (in / out /
  in+out: Sine, Quad, Cubic, Quart, Quint, Expo, Circ, Back, Elastic, Bounce), make segment
  line, make segment curve, symmetric, smooth, corner nodes, fit vertical, fit horizontal.
  Easing presets are implemented as expressions and then applied to the segment.

## Effects

All added from the object's right-click menu; most parameters are animatable.

| Family | Built-in members (source menu creators) | Notes |
|--------|------------------------------------------|-------|
| Raster effects | Blur, Shadow, Motion Blur, Brightness-Contrast, Colorize, Wipe, Noise Fade + custom shader effects | Rendered as pixels; per-effect CPU/GPU toggle; default in Preferences > Hardware. Only Blur and Shadow export to SVG. |
| Path effects (path base, fill, outline base, outline) | Displace, Spatial Displace, Dash, Duplicate, Sub-Path, Solidify, Sum, Lines, ZigZag, Subdivide | Same list for each slot. Sub-Path = trim path (animate min/max length, offset). |
| Transform effects | Track, Follow Path, Follow Object, Follow Object Relative, Parent | Parent = simple parenting (supports influence, rc.3). Only Follow Path exports to SVG. |
| Blend effects | Move, Targeted | Animate an object's stacking position over time. Not the same as blend modes. Not exported to SVG. |
| Text effects | per character / word / line | Combine with transforms and other effects. Not exported to SVG. |

Custom raster effects: GLSL shader effects (see shader-effects.md). The C++ plugin
loaders for custom path/raster effects and custom boxes are disabled in `main.cpp`.

## Blend modes, masks, clipping

- Each object has a blend mode (combo next to its name in the Timeline). Objects blend
  onto their first parent **layer**, so groups must be promoted to layers.
- **Alpha mask**: put the mask object above the content inside one layer and set the mask
  object's blend mode to **DstIn** (keep inside) or **DstOut** (keep outside). Mask color
  should be white; in SVG export grey levels act as partial transparency.
- There is no separate clipping-path object; masking is done with these blend modes.

## Not present

- Onion skin: not available (the only reference is in enve's commented-out paint code).
- Bones / IK rigging: not available; use Parent / Follow Object transform effects and
  clamped expressions.
- Raster painting: enve's paint mode/paint box is disabled in Friction (code commented
  out). Paint in Krita/GIMP and import.
