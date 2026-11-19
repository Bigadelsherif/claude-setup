# The .sif / .sifz / .sfg file format

Verified against `synfig-core/src/synfig/loadcanvas.cpp` (reader), `savecanvas.cpp` (writer),
`time.cpp`, `renddesc.h`, `canvasfilenaming.cpp` at tag v1.5.5, plus real Studio-saved files
(`synfig-studio/plugins/add-skeleton-simple/stickman.sif`, synfig-docs samples). There is no
formal schema; the loader is the spec. Layer parameter names are in `layers.md`.

## Containers

| Extension | What it is |
|---|---|
| `.sif` | Plain UTF-8 XML. |
| `.sifz` | The same XML, gzip-compressed (the reader wraps the stream in a gzip decoder when the extension is `.sifz`). `gzip -dc a.sifz > a.sif` / `gzip -c a.sif > a.sifz`. |
| `.sfg` | ZIP container: `project.sifz` plus an `images/` folder for embedded files. Inside the document, `#file.png` refers to `images/file.png` in the container. |

## Canvas (root element)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<canvas version="1.2" width="480" height="270" xres="2834.645669" yres="2834.645669"
        gamma-r="1.000000" gamma-g="1.000000" gamma-b="1.000000"
        view-box="-4.000000 2.250000 4.000000 -2.250000" antialias="1"
        fps="24.000" begin-time="0f" end-time="5s"
        bgcolor="0.500000 0.500000 0.500000 1.000000">
  <name>...</name> <desc>...</desc> <author>...</author>
  <meta name="..." content="..."/>      <!-- Studio UI state: grid, guides, onion skin... -->
  <keyframe time="1s" active="true">label</keyframe>
  <bones>...</bones>                    <!-- skeleton bone value nodes (root canvas only) -->
  <defs>...</defs>                      <!-- exported values and exported child canvases -->
  <layer .../> <layer .../>            <!-- FIRST layer in file = BOTTOM of the stack -->
</canvas>
```

| Attribute | Meaning / default |
|---|---|
| `version` | Canvas format version. v1.5.x writes `"1.2"`, v1.4.x writes `"1.1"`. `"1.0"` and `"0.x"` trigger legacy handling (gamma 2.2, see Gotchas). |
| `width`, `height` | Pixel size (must be >= 1). Default 480x270. |
| `xres`, `yres` | Dots per **meter** (2834.645669 = 72 dpi). Metadata only. |
| `view-box` | `"tl_x tl_y br_x br_y"` in units. Default `-4 2.25 4 -2.25`. **y points up.** |
| `antialias` | Integer. |
| `fps` | Frame rate (default 24). Must appear before times are interpreted in frames. |
| `begin-time` (alias `start-time`), `end-time` | Time strings. `end-time="0f"` = still image. |
| `bgcolor` | `"r g b a"` floats 0..1. **Only used when a target fills alpha** (non-alpha video codecs, GIF); PNG output stays transparent. Use a `solid_color` layer if you need a guaranteed background. |
| `gamma-r/g/b` | Canvas gamma; default 1.0 for current versions. |
| `focus` | `"x y"`. |

Pixels per unit = `width / (br_x - tl_x)` → **60 px/unit only for the default** 480 px / 8 units.
If you make a 1920x1080 canvas and keep the default view-box, 1 unit = 240 px. To keep 60 px/unit
at 1920x1080 use `view-box="-16 9 16 -9"`.

## Layers

```xml
<layer type="circle" active="true" exclude_from_rendering="false" version="0.2" desc="Ball">
  <param name="z_depth"><real value="0"/></param>
  <param name="amount"><real value="1"/></param>
  <param name="blend_method"><integer value="0"/></param>
  <param name="color"><color><r>1</r><g>0.3</g><b>0.1</b><a>1</a></color></param>
  <param name="radius"><real value="0.5"/></param>
  <param name="origin"><vector><x>0</x><y>0</y></vector></param>
</layer>
```

- `type` (required): registered layer name (see `layers.md`; `synfig --layers`).
- `active`: false hides the layer. `exclude_from_rendering`: shown in Studio, skipped in renders.
- `version`: layer version; writing a higher version than installed only warns.
- `desc`: the name shown in the Layers panel.
- Omitted params keep the layer's defaults. A param with an unknown name or wrong value type
  produces the warning `Layer 'x' rejected value for parameter 'y'` and is ignored (not fatal).
- Legacy param names `pos` and `offset` are mapped to `origin`.
- Every layer has `z_depth` (real). Composite layers have `amount` (real, opacity) and
  `blend_method` (integer, 0 = Composite).

### Group (a.k.a. PasteCanvas) with inline canvas

```xml
<layer type="group" active="true" version="0.3" desc="Character">
  <param name="origin"><vector><x>0</x><y>0</y></vector></param>
  <param name="transformation">
    <composite type="transformation">
      <offset><vector><x>0</x><y>0</y></vector></offset>
      <angle><angle value="0"/></angle>
      <skew_angle><angle value="0"/></skew_angle>
      <scale><vector><x>1</x><y>1</y></vector></scale>
    </composite>
  </param>
  <param name="canvas">
    <canvas>
      <layer type="circle" ...>...</layer>
    </canvas>
  </param>
</layer>
```

Inline canvases cannot have `<defs>`, `<bones>`, keyframes or metadata. A group can instead
reference an exported canvas: `<param name="canvas" use="mycanvas"/>` (canvas defined in `<defs>`
as `<canvas id="mycanvas">`), or another file: `use="other.sif#"` / `use="other.sif#canvasid"`.
`paste_canvas` and `PasteCanvas` are accepted aliases of `group`.

A composite node must contain **all** of its links or the file fails to load ("is missing
link"): transformation needs `offset, angle, skew_angle, scale`.

## Value elements

| Element | Form |
|---|---|
| `<real value="1.5"/>` | float |
| `<integer value="3"/>` | int |
| `<bool value="true"/>` | true/false |
| `<angle value="90"/>` | **degrees** |
| `<time value="1s"/>` | time string |
| `<vector><x>1</x><y>2</y></vector>` | units |
| `<color><r/>..<g/>..<b/>..<a/></color>` | floats 0..1 (children are text, not attributes) |
| `<string>text</string>` | text content |
| `<gradient><color pos="0">...</color><color pos="1">...</color></gradient>` | |
| `<canvas>...</canvas>` | inline canvas (only for canvas-type params) |

Any value may carry `static="true"` (not animatable in Studio) and an `interpolation="..."`
attribute (per-parameter default interpolation).

Lists:
- `vector_list` (polygon): `<dynamic_list type="vector"><entry><vector>..</vector></entry>...</dynamic_list>`
  (`static_list` also parses).
- Spline (`bline` param of region/outline/advanced_outline):

```xml
<bline type="bline_point" loop="true">
  <entry>
    <composite type="bline_point">
      <point><vector><x>0</x><y>1</y></vector></point>
      <width><real value="1"/></width>
      <origin><real value="0.5"/></origin>
      <split><bool value="false"/></split>
      <t1><vector><x>1</x><y>0</y></vector></t1>
      <t2><vector><x>1</x><y>0</y></vector></t2>
      <split_radius><bool value="true"/></split_radius>
      <split_angle><bool value="false"/></split_angle>
    </composite>
  </entry>
  ...
</bline>
```

All 8 links (`point, width, origin, split, t1, t2, split_radius, split_angle`) are required for
current versions. `t1`/`t2` are tangent vectors (units; Hermite tangents — for a smooth circle-ish
curve through N points use roughly `distance_between_points * 1.0..1.5` in the travel direction).
Studio writes tangents as `<radial_composite type="vector"><radius>..</radius><theta><angle/></theta></radial_composite>`;
a plain `<vector>` is also accepted because each link is parsed as any value node of the right
type. `loop="true"` closes the shape. `width` is a multiplier of the outline's `width` param.

## Animation: `<animated>` and waypoints

Replace a constant value with an `<animated>` node of the same type:

```xml
<param name="origin">
  <animated type="vector">
    <waypoint time="0s" before="clamped" after="clamped">
      <vector><x>-3</x><y>0</y></vector>
    </waypoint>
    <waypoint time="1s 12f" before="halt" after="halt">
      <vector><x>3</x><y>0</y></vector>
    </waypoint>
  </animated>
</param>
```

- `type` = value type name: `real, integer, bool, angle, time, vector, color, string, gradient, canvas, ...`
- `<waypoint time=...>` contains one value element (or `use="exported_id"`).
- Optional waypoint attributes: `before`, `after` (interpolation in/out), `tension`, `continuity`,
  `bias`, `temporal-tension` (TCB parameters, floats).
- Two waypoints at the same time are rejected (BadTime warning).

### Interpolation names (XML value → Studio UI name)

| XML | UI | Behaviour |
|---|---|---|
| `clamped` | Clamped | Smooth, no overshoot. |
| `auto` | TCB | Smooth spline; may overshoot. |
| `linear` | Linear | Straight-line change. |
| `halt` | Ease In/Out | Zero slope at the waypoint. |
| `constant` | Constant | Holds value, jumps at the next waypoint. |
| `manual` | (legacy) | Accepted by the reader; seen in old files. |

If `before`/`after` are omitted the core default is `auto` (TCB), except angle-typed values,
which default to `linear` (`synfig/waypoint.cpp`). Studio picks the interpolation of new
waypoints from the dropdown at the bottom of the canvas window. Write `before`/`after`
explicitly in generated files. Boolean/integer/string params effectively animate as steps.

## Linking and exported values (`<defs>`)

Exported values live in `<defs>` with an `id` and are referenced with `use`:

```xml
<defs>
  <color id="skin"><r>1</r><g>0.8</g><b>0.6</b><a>1</a></color>
  <animated type="real" id="pulse">
    <waypoint time="0s"><real value="0.4"/></waypoint>
    <waypoint time="1s"><real value="0.6"/></waypoint>
  </animated>
  <canvas id="eye"> <layer .../> </canvas>     <!-- exported (reusable) canvas -->
</defs>
...
<param name="color" use="skin"/>
<param name="radius" use="pulse"/>
<param name="canvas" use="eye"/>
```

- An id without `:` is looked up in the root canvas (inline canvases delegate to their parent).
  Studio writes `use=":id"` from nested canvases; both resolve to the root.
- `file.sif#:id` references a value exported in another file; `file.sif#canvasid` a canvas.
- Referencing an undefined id is a load error ("Unknown ID ... referenced").
- Linking inside a file without exporting is done by giving nodes a shared `guid="..."`; the
  first occurrence defines the node, later elements with the same guid reuse it. Prefer
  `<defs>` + `use` when generating files.

## Converters (linkable value nodes)

Any param can be a converter node instead of a constant, e.g. `<composite>`, `<radial_composite>`,
`<add>`, `<scale>`, `<linear>`, `<sine>`, `<reference>`, `<bone_link>`, `<boneinfluence>`,
`<timeloop>` ... Element name = registry name (`synfig --valuenodes` lists them), `type` attribute
= result type, child elements = link names. Each converter requires all its links. Look at a
Studio-saved file (or `synfig --valuenodes` + Studio's Convert menu) for the exact link names
before hand-writing one; they are not listed here.

## Keyframes

`<keyframe time="2s" active="true">Pose B</keyframe>` at canvas level (root or exported canvas,
not inline). Keyframes are markers used by Studio's keyframe lock; they do not animate anything
by themselves — waypoints do.

## Minimal complete example

See `../assets/bouncing-ball.sif` (hand-written; 2-second animation with a solid background,
a static rectangle, and a circle with animated `origin` and `color`).
Render: `synfig bouncing-ball.sif -t png -o frames/ball.png` or
`synfig bouncing-ball.sif -t ffmpeg --video-codec libx264 --video-bitrate 6000 -o ball.mp4`.

## Gotchas

- **Layer order is reversed**: the first `<layer>` in a canvas is the bottom; the last is on top.
- **Gamma / version**: when `version` is `"1.0"` or starts with `"0."`, the loader sets canvas
  gamma 2.2 (old linear-colour files: Studio 1.0-era files store e.g. 0.2157 for mid-grey).
  Current versions use gamma 1.0, so colour values are what you see. Write `version="1.2"`
  (or `"1.1"` for Synfig 1.4 users) in generated files; do not copy `version="1.0"` headers from
  old samples while using sRGB colour values.
- **Time without unit = frames**: `time="2"` is frame 2. Write `"2s"`, `"48f"`, `"1s 12f"`.
- **Units vs pixels**: everything in the file is in units (y up, origin at view-box centre by
  default). Studio's Parameters panel shows distances in pixels by default (preference), so a
  "radius 30" in the UI is `0.5` units in the file at 60 px/unit.
- **Angles are degrees** in `<angle value>`.
- Missing composite links, unknown `use` ids, or malformed XML make the whole file fail to load;
  wrong param names/types only warn. Always run `synfig file.sif --canvas-info all` (or a
  one-frame render) after generating and read stderr.
- `.sifz` must really be gzip; an uncompressed file named `.sifz` will not load.
