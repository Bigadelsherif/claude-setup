# Layer types and parameters

Names and parameter lists extracted from the `get_param_vocab()` / constructors of the layer
sources at tag v1.5.5 (`synfig-core/src/modules/{mod_geometry,lyr_std,mod_filter,mod_gradient,lyr_freetype}`,
`synfig-core/src/synfig/layers/`). On an installed Synfig, the authoritative check is:

```
synfig --layers                 # all type names
synfig --layer-info circle      # param names, descriptions, "not critical" flags
```

## Inherited parameter sets

| Set | Params (XML type) |
|---|---|
| Every layer | `z_depth` (real) |
| Composite (most visible layers) | `amount` (real, opacity 0..1), `blend_method` (integer) |
| Shape (circle, rectangle, star, polygon, region, outline, advanced_outline, text) | composite + `color` (color, default black), `origin` (vector, offset of the shape), `invert` (bool), `antialias` (bool), `feather` (real, units), `blurtype` (integer, Studio writes 1), `winding_style` (integer: 0 non-zero, 1 even/odd) |

`blend_method` values (`synfig/color/color.h`): 0 Composite, 1 Straight, 2 Brighten, 3 Darken,
4 Add, 5 Subtract, 6 Multiply, 7 Divide, 8 Color, 9 Hue, 10 Saturation, 11 Luminance, 12 Behind,
13 Onto, 16 Screen, 17 Hard Light, 18 Difference, 20 Overlay, 21 Straight Onto, 22 Add Composite,
23 Alpha, 24 Alpha Intersection (14, 15, 19 deprecated).

## Geometry

| type | Own params (XML type, default) | Notes |
|---|---|---|
| `circle` (v0.2) | `radius` (real, 1) | Centre = shape `origin`. Shape params apply. |
| `rectangle` (v0.2) | `point1` (vector, 0,0), `point2` (vector, 1,1), `expand` (real, 0), `feather_x`, `feather_y` (real), `bevel` (real 0..1), `bevCircle` (bool, true) | `filled_rectangle` in files is loaded as `rectangle`. |
| `star` (v0.1) | `radius1` (real, 1.0 outer), `radius2` (real, 0.38 inner), `angle` (angle, 90), `points` (integer, 5), `regular_polygon` (bool, false) | Centre = `origin`. |
| `polygon` (v0.1) | `vector_list` (list of vector) | `<dynamic_list type="vector">`. Studio's Polygon tool may create a region instead, depending on tool options. |
| `region` (v0.1) | `bline` (spline) | Filled spline. See `sif-format.md` for the `<bline>` structure. |
| `outline` (v0.3) | `bline`, `width` (real, 1.0 — units; per-vertex `width` multiplies it), `expand` (real), `sharp_cusps` (bool), `round_tip[0]`, `round_tip[1]` (bool), `homogeneous_width` (bool) | Use for generated strokes. |
| `advanced_outline` (v0.3) | `bline`, `width`, `expand`, `start_tip`, `end_tip` (integer: 1 rounded, 2 squared, 3 peak, 4 flat), `cusp_type` (integer: 0 sharp, 1 rounded, 2 bevel), `smoothness` (real), `homogeneous` (bool), `wplist` (width points), `dash_enabled` (bool), `dilist` (dash items), `dash_offset` (real) | Variable-width stroke; the `wplist`/`dilist` structures are easiest to copy from a Studio-saved file. |
| `checker_board` | (see `--layer-info`) | |

## Gradients and fills

| type | Params |
|---|---|
| `solid_color` | `color` (+ composite). Named `SolidColor` before 1.5.2; both names load in 1.4.5 and 1.5.x. |
| `linear_gradient` | `p1`, `p2` (vector), `gradient`, `loop` (bool), `zigzag` (bool) |
| `radial_gradient` | `gradient`, `center` (vector), `radius` (real), `loop`, `zigzag` |
| `conical_gradient`, `spiral_gradient`, `curve_gradient`, `noise` | see `--layer-info` |

## Transform layers (affect all layers BELOW them in the same canvas)

| type | Params |
|---|---|
| `translate` | `origin` (vector) — offset |
| `rotate` | `origin` (vector, pivot), `amount` (angle, degrees) |
| `zoom` (Studio name: Scale) | `amount` (real, **exponential**: scale factor = e^amount; 0 = 100%, ln 2 ≈ 0.6931 = 200%), `center` (vector) |
| `stretch` | `amount` (vector, x/y factors), `center` (vector) |
| `warp`, `twirl`, `spherize`, `noise_distort`, `curve_warp`, `inside_out`, `skeleton_deformation` | distortions; see `--layer-info` |

To transform only a few layers, put them in a `group` together with the transform layer, or use
the group's own `transformation` parameter.

## Grouping and time

| type | Params |
|---|---|
| `group` (aliases `PasteCanvas`, `paste_canvas`; v0.3) | composite + `origin` (vector), `transformation` (composite: offset, angle, skew_angle, scale), `canvas` (inline `<canvas>` or `use=`), `time_dilation` (real, 1), `time_offset` (time), `children_lock` (bool), `outline_grow` (real), `z_range` (bool), `z_range_position`, `z_range_depth`, `z_range_blur` (real) |
| `switch` | group params + `layer_name` (string), `layer_depth` (integer) — shows one child |
| `filter_group` | groups filters |
| `duplicate` | duplicates context with an index value node |
| `timeloop`, `freetime`, `stroboscope` | time manipulation |
| `super_sample`, `motion_blur` | render quality / blur over time (`MotionBlur` is the pre-1.5.2 name) |
| `sound` | audio track for previews and ffmpeg export |

## Images, text, filters

| type | Params |
|---|---|
| `import` | `filename` (string; path relative to the .sif, or `#name.png` inside a .sfg), `time_offset` (time), plus bitmap params `tl`, `br` (vector corners), `c` (integer resampling: 0 nearest, 1 linear, 2 cosine, ...), `gamma_adjust` (real) + composite |
| `text` (v0.5) | `text` (string), `color`, `family` (string, "Sans Serif"), `style` (integer), `weight` (integer, 400 normal / 700 bold), `direction` (integer; 1.5.x only), `compress`, `vcompress` (real), `size` (vector, 0.25 0.25 units), `orient` (vector, 0.5 0.5 = centred), `origin` (vector), `font` (string, font file), `use_kerning` (bool), `grid_fit` (bool), `invert` (bool) |
| `blur` | `size` (vector, 0.1 0.1), `type` (integer: 0 box, 1 fast gaussian, 2 cross, 3 gaussian, 4 disc) + composite. Blurs everything below it in the canvas. |
| `radial_blur`, `shade`, `bevel`, `colorcorrect`, `clamp`, `lumakey`, `chromakey`, `halftone2/3`, `xor_pattern`, `metaballs`, `plant`, `mandelbrot`, `julia` | see `--layer-info` |

## Bones

| type | Params |
|---|---|
| `skeleton` (v0.1) | `amount`, `name` (string), `bones` (list of bone objects). Visible in Studio, excluded from render by default. |
| `skeleton_deformation` (v0.2) | `bones` (list of bone-weight pairs), `point1`, `point2` (vector, deformation area), `x_subdivisions`, `y_subdivisions` (integer, 32) — raster deformation of what is below |

Bone value nodes (`<bone>` in the root `<bones>` section) have links `name, parent, origin,
angle, scalelx, width, scalex, tipwidth, bone_depth, length`. Vertices follow bones through the
`bone_link` and `boneinfluence` converters. Rigs are practical to build in Studio, not by hand;
see `studio-concepts.md`.

## Typical layer stack for a generated scene

```
(top)    translate / rotate / zoom      <- only if everything below should move together
         group "character" (transformation animated)
         outline / region shapes
         circle / rectangle / star
(bottom) solid_color background
```

In the XML the bottom layer is written first.
