# Expressions

Verified against `src/core/Expressions/` (expression.cpp, propertybindingparser.cpp,
propertybinding.cpp, framebinding.cpp, valuebinding.cpp, scenebinding.cpp,
expressionpresets.cpp, presets/*.fexpr), `src/core/Animators/{qrealanimator,complexanimator,qpointfanimator,customproperties}.cpp`,
`src/app/GUI/Expressions/expressiondialog.cpp`, `src/core/appsupport.cpp`, and
https://friction.graphics/documentation/expressions.html.

## Engine and model

- Language: ECMAScript via Qt's `QJSEngine`. Each expression gets **its own
  engine**, so nothing is shared between expressions.
- Expressions attach to **single numeric properties** (`QrealAnimator`): x or y of a 2D
  property, rotation, opacity, effect parameters, custom properties, path-effect values,
  frame-remap "frame", etc. Path shapes, text, booleans and combo properties cannot.
  Color channels are numeric animators internally; whether the UI offers Set Expression on
  them was not verified.
- Open: right-click the property in Timeline or Properties > **Set Expression**. Same menu
  has **Apply Expression** (bake into keyframes over a range at a chosen accuracy, then
  remove the expression) and **Clear Expression**.
- Dialog: Editor tab with "Bindings and Script" / "Definitions" toggles, a preset picker,
  **Apply**, **Ok**, **Cancel**, and **Auto Apply** (live update). The window stays on top
  while you keep working. (rc.1 removed the old Easing tab; easing presets are applied from
  the Graph view.)

Internally Friction builds:

```js
// prepended: definitions of all enabled core presets + all enabled user presets
<global definitions>
<this expression's Definitions>
var eEvaluate;
eEvaluate = function(<binding names...>) { <Calculate script> }
```

and calls `eEvaluate(...)` per frame with the binding values. The script is test-run when
you press Apply; errors are reported with line numbers. The return value **must be a
number** ("Invalid return type" otherwise).

## Bindings

One binding per line (lines may also be separated by `;`). Grammar from
`propertybindingparser.cpp`:

```
name = source        // name: letters, digits, _ ; '//' starts a comment line
```

Sources:

| Source | Value |
|--------|-------|
| `$frame` | Current frame **relative to the property's owner** (accounts for time shifts/remaps) |
| `$value` | The property's own base value (constant or keyframed), i.e. before this expression |
| `$scene.fps` | Scene frames per second |
| `$scene.width`, `$scene.height` | Scene size in px |
| `$scene.rangeMin`, `$scene.rangeMax` | Scene first / last frame |
| dotted path | Another property's current effective value |

Rules:

- No literals or JS in bindings (`len = 100;` and `var x = ...` are errors). Put constants
  in Calculate.
- Each name may be bound once.
- Path lookup starts at the parent of the property that owns the expression and walks up
  the ancestor chain, matching **property names exactly** at each level. So from a box's
  `transform.rotation` you can write `transform.translation.x`, `opacity` siblings, or
  `OtherBox.transform.translation` for a sibling object named `OtherBox` in the same
  group/scene.
- Only numeric (`QrealAnimator`) and 2D-point (`QPointFAnimator`) properties can be bound.
  2D values arrive as arrays: `p = transform.translation;` -> `p[0]`, `p[1]`.
- Hidden properties are skipped by the lookup: enable Custom Properties (right-click object
  > Custom Properties) before binding `properties.myValue`.
- A property cannot bind to itself or to something that depends on it (cycle check).
- Bindings track renames: if a bound object/property is renamed the stored path updates.
- No access to values at other times (no `valueAtTime`); FAQ says maybe in v1.1.

Common property paths (names from source):

```
transform.translation        transform.translation.x / .y
transform.rotation
transform.scale              transform.scale.x / .y
transform.shear              transform.pivot
transform.opacity
properties.<customName>      (custom properties group)
```

Docs examples use `transform.translate.x` - that name does not exist; it is `translation`.

## Definitions and Calculate

- Definitions: functions (and any setup code) evaluated once when the engine is built.
- Calculate: body of a function; must end in `return <number>`.
- Assignments without `var`/`let` create engine globals that persist between frames of the
  same expression. Bundled helpers rely on this: `noise()` defaults its `t` parameter to a
  global named `time`, so set `time = frame / fps;` (no `var`) before calling
  `noise(freq, amp, seed)`.

## Built-in helpers

Core (compiled in, always loaded unless disabled): `clamp(number, lower, upper)`,
`lerp(a, b, t)`, and Robert Penner easings attached to `Math`:
`Math.easeIn|Out|InOut` + `Quad, Cubic, Quart, Quint, Sine, Expo, Circ, Elastic, Back, Bounce`
with signature `(t, b, c, d)` = (elapsed, start value, change, duration).

Installed by the first-run wizard into the user Expressions folder (and therefore global,
because the definitions of every enabled preset are prepended to every expression):

- `noise(frequency, amplitude, seed, t = time, detail = 4)` - 1D Perlin-style smooth noise.
- `oscillation(origin, time, frequency, amplitude, shift)` - cosine oscillation.

Script-only presets (bindings + script, pick from the preset list): Wiggle, Time,
Copy X, Copy Y, Orbit X, Orbit Y, Rotation, Wave, Track object, Frame Remap Loop,
Frame Remap Loop Bounce.

## Examples

Loop a 0->1 ramp every 60 frames:

```text
Bindings:   frame = $frame;
Calculate:  var d = 60; return (frame % d) / d;
```

Wiggle (bundled preset, verbatim logic):

```text
Bindings:
fps = $scene.fps;
frame = $frame;
value = $value;
Calculate:
time = frame / fps;
frequency = .5;
amplitude = 200; // pixels
seed = 0;
return value + noise(frequency, amplitude, seed);
```

Copy X into Y with a ratio (put on `transform.scale.y`; `x` resolves to the sibling):

```text
Bindings:   x = x
Calculate:  return x * 1;
```

Look at another object (put on `transform.rotation`; rename the target path):

```text
Bindings:
objectPos = transform.translation;
pivotPos = transform.pivot;
offsetAngle = $value;
targetPos = Target.transform.translation;
Calculate:
var dx = targetPos[0] - (objectPos[0] + pivotPos[0]);
var dy = targetPos[1] - (objectPos[1] + pivotPos[1]);
return Math.atan2(dy, dx) * 180 / Math.PI + offsetAngle;
```

Seamless loop of a linked scene: right-click the linked scene box > Frame Remapping, then
on its `frame` property:

```text
Bindings:   frame = $frame;
Calculate:  return frame % 120;   // loop length in frames
```

Ease between two values without keyframes:

```text
Bindings:   frame = $frame;
Calculate:
var t = clamp(frame - 10, 0, 30);          // starts at frame 10, lasts 30 frames
return Math.easeInOutCubic(t, 0, 500, 30); // from 0 to 500
```

## Presets (.fexpr)

INI files with a `[General]` group; loaded at startup from
`%LOCALAPPDATA%\friction\Expressions` (Linux `~/.config/friction/Expressions`,
macOS `~/Library/Preferences/friction/Expressions`). Keys: `version` (>= 0.1, required),
`id` (required, unique, no spaces), `title`, `author`, `description`, `url`, `license`,
`categories`, `highlighters`, `bindings`, `definitions`, `script`. A file is valid if it
has version, id and at least one of bindings/definitions/script. Newlines inside values
are written as `\n` in a quoted string.

```ini
[General]
version=1
id=com.example.bounce
title=Bounce
author=me
description=Abs-sine bounce on top of the base value
categories=
highlighters=
bindings="frame = $frame;\nfps = $scene.fps;\nvalue = $value;"
definitions=
script="var t = frame / fps;\nreturn value - Math.abs(Math.sin(t * Math.PI * 2)) * 120;"
```

A preset with only `definitions` (empty bindings and script) acts as a **global function
library**: its definitions are injected into every expression. `highlighters` (e.g.
`"bounce(x, y)"`) makes the editor highlight/complete the function name. Duplicate ids are
skipped. Presets can be disabled (setting `ExpressionsDisabled`). Restart Friction after
adding files. The dialog can also save, update, delete, import and export presets.

## Baking and SVG

- Apply Expression samples the expression over a frame range and curve-fits Bezier
  keyframes (accuracy controls sample spacing and fit tolerance), then removes it.
- SVG export does this automatically on a copy (accuracy 10), so expressions export as
  ordinary spline keyframes. This is the documented workaround for features the SVG
  exporter cannot write (Track effect, etc.).
