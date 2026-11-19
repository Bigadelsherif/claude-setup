# Synfig Studio concepts (brief)

Sources: synfig-docs `main_concepts/{animation_mode,keyframes,waypoints,linking,exported_parameters}.rst`,
`layers/{skeleton,skeleton_deformation}.rst`, `tools/skeleton.rst`, `quick_start/bones_cutout.rst`,
`interpolations/*.rst`. Menu labels can differ slightly between versions.

## Animation model

- **Everything is a parameter.** A layer's parameters are constant values until you animate
  them; an animated parameter becomes a value node of waypoints (`<animated>` in the file).
- **Animate Editing Mode** (round button at the right end of the timebar, canvas gets a red
  border): every parameter edit creates a waypoint at the current time. With the mode off,
  edits apply to the whole timeline; editing an already-animated parameter outside animate
  mode asks whether to offset the whole animation. The button only shows when `end-time > 0`.
- **Waypoints** appear in the Timetrack panel per parameter (and as summaries on parent rows).
  Drag to retime, right-click for Duplicate/Remove and In/Out/Both interpolation.
  Each waypoint has an In and Out interpolation: Clamped, TCB, Constant, Ease In/Out, Linear
  (XML: `clamped`, `auto`, `constant`, `halt`, `linear`). The default for new waypoints is the
  dropdown at the bottom of the canvas window; a per-parameter default can be set via
  right-click on the parameter.
- **Keyframes** (Keyframes panel, dashed lines on the timetrack) are named markers of a moment;
  they store no data on their own. With **Lock Keyframes** (past/future/all, toggle at the
  bottom of the canvas window) enabled, editing a parameter in animate mode also adds waypoints
  at the neighbouring keyframes so poses at those keyframes are preserved. Keyframes can be
  duplicated (copies the pose to the current time), dragged (retimes all waypoints between),
  and deactivated.
- **Time cursor / timebar**: frames are shown per the time format preference; files store
  time strings (`"1s 12f"`).

## Groups, linking, exporting

- **Group layer** (`group`) holds an inline canvas and has a transformation widget
  (offset/angle/skew/scale) plus `time_offset` and `time_dilation` for reusing animation.
- **Transform layers** (translate/rotate/scale) affect every layer *below* them in the same
  canvas. Encapsulate to limit their scope.
- **Linking**: select two or more layers, select the same parameter (e.g. Color) in the
  Parameters panel, right-click > Link. Linked parameters share one value node.
- **Export value**: right-click a parameter > Export Value, give an id → it appears in the
  Library panel and in `<defs>`; other parameters can link to it (`use="id"`). Exported canvases
  can be instantiated multiple times as groups.
- **Converters** (right-click > Convert): turn a parameter into a computed node (Composite,
  Linear, Sine, Reference, Bone Link, ...). In the file they are elements named after the
  converter.

## Bones and skeletons

Two layer types use bones:

1. **Skeleton layer** (`skeleton`) — moves vector artwork. Vertices/handles are *linked* to
   bones; visible in the workarea, not rendered.
2. **Skeleton Deformation layer** (`skeleton_deformation`) — raster mesh deformation of
   everything below it in its canvas (good for bitmaps). Set the area with Point 1/Point 2,
   build bones with the layer disabled, then right-click > **Reset Pose** to store the rest pose.

Building a rig (1.5.x):
- **Skeleton Tool** (Alt+O, since 1.5.0): click to create a bone, click-drag to create a bone
  between two points. New bones become children of the **active bone** (yellow outline; click a
  bone to activate it). Tool options: layer name, bone width, layer type to create.
  "Make parent to active bone" in a handle's context menu re-parents.
- Older/alternate way: New Layer > Other > Skeleton, then right-click a bone handle >
  **Create Child Bone**.
- Bone handles: green = origin (pivot, move), blue = angle (rotate), orange = length (scales
  the bone and its content); width handles (Alt+5 toggles width ducks) set influence areas.

Binding artwork:
- **Link to Bone**: select vertices/handles (e.g. select all child layers of a group, Ctrl+A in
  the canvas), Ctrl-click a bone, right-click one of its handles > Link to Bone. 100% influence
  from one bone. For a rigid image part, link only its position handle.
- **Link to Skeleton**: after setting Bone Width/Tip Width, select handles, right-click the
  skeleton layer > Link to Skeleton → weighted influence from all overlapping bones.
- **Disconnect** / change parent: Parameters panel > Bones list > select item.

Animating: switch Animate Editing Mode on and rotate/move bones at different times; waypoints
are created on the bone parameters (angle, origin, scalelx, ...).

In the file: bones live in the root `<bones>` section as `<bone>` value nodes (links `name,
parent, origin, angle, scalelx, width, scalex, tipwidth, bone_depth, length`), and linked
vertices use `bone_link` / `boneinfluence` converters. Hand-writing rigs is impractical; build
the rig in Studio, then script against the saved file (e.g. animate `angle` waypoints of known
bones by `name`).

Lottie export does not support bones (`plugins.md`).

## Useful Studio facts for scripting

- Studio commonly saves `.sifz`; choose `.sif` in Save As for diff-friendly XML.
- The Parameters panel shows distances in **pixels** by default (unit-system preference);
  files are always in units.
- File > Import brings in images (import layer), `.sif` files (as group), SVG, audio (sound
  layer), image sequences, and via plugins other formats.
- File > Render dialog = same targets as the CLI (`-t`), plus target-specific settings.
