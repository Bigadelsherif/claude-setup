# Pencil2D project format (.pclx / .pcl)

Verified against `core_lib/src/structure/filemanager.cpp`, `object.cpp`, `layer.cpp`,
`layerbitmap.cpp`, `layervector.cpp`, `layersound.cpp`, `layercamera.cpp`, `camera.cpp`,
`core_lib/src/graphics/vector/{vectorimage,beziercurve,bezierarea}.cpp`, `core_lib/src/qminiz.cpp`,
`core_lib/src/util/{fileformat.h,util.cpp,cameraeasingtype.h}`, and the upstream sample projects in
`tests/data/` (`empty.pclx`, `camera-path-test.pclx`, `cjk-test.pclx`, `fill-drag-test/*.pcl`).

## Containers

**.pclx** (default since 0.6) is a ZIP. Pencil2D only treats a file as a ZIP if its suffix is
`.pclx` (case-insensitive); anything else is read as legacy `.pcl`.

```
mimetype            "application/x-pencil2d-pclx", first entry, stored (written on save; optional on load)
main.xml            project description
data/               keyframe files + palette
  palette.xml       optional; default palette used if missing
  001.001.png ...   bitmap keyframes
  002.001.vec ...   vector keyframes
  sound_20260101_120000_000.wav   sound clips (any ffmpeg-readable format)
```

**.pcl** (legacy): `name.pcl` is the same XML as `main.xml`, with the files in a sibling folder
`name.pcl.data/` (no ZIP). On open, Pencil2D copies both into a temp working dir
(`<temp>/Pencil2D/<name>_Y2xD_<random>/`).

Opening checks, in order: file exists, ZIP opens (pclx), `main.xml` exists and parses, DOCTYPE is
`PencilDocument` (or legacy `MyObject`), then the root is `<document>` (current) or `<object>`
(Pencil <= 0.4.3). `<document>` must contain an `<object>` child.

## main.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE PencilDocument>
<document>
  <projectdata>
    <currentFrame value="1"/>
    <currentColor r="0" g="0" b="0" a="255"/>
    <currentLayer value="1"/>                 <!-- index into the layer list, 0-based -->
    <currentView m11="1" m12="0" m21="0" m22="1" dx="0" dy="0"/>   <!-- editor viewport -->
    <fps value="24"/>                          <!-- legacy name "currentFps" also accepted -->
    <isLoop value="false"/>
    <isRangedPlayback value="false"/>
    <markInFrame value="1"/>
    <markOutFrame value="10"/>
  </projectdata>
  <object>
    <layer id="1" name="Camera Layer" visibility="1" type="5" width="1920" height="1080">
      <camera frame="1" r="0" s="1" dx="0" dy="0"/>
    </layer>
    <layer id="2" name="Ink" visibility="1" type="1">
      <image frame="1" src="002.001.png" topLeftX="-960" topLeftY="-540" opacity="1"/>
    </layer>
  </object>
  <version>0.7.2</version>                     <!-- written on save; only used for a warning -->
</document>
```

The XML comments above are explanatory only. Do not put comments inside `<projectdata>`: the
loader's loop there does not advance past non-element nodes and hangs (`FileManager::loadProjectData`).
`<editor>` is accepted as a legacy alias of `<projectdata>`. All `projectdata` children are optional;
defaults: fps 12, currentFrame 1, currentLayer 0, markIn 1, markOut 10 (`objectdata.h`).

### Layers

Order in `<object>` = paint order: **first layer is drawn at the bottom**, last on top. (The
timeline shows the last one at the top.)

Common attributes (`Layer::createBaseDomElement` / `loadBaseDomElement`):

| attr | meaning |
|---|---|
| `id` | integer, must be unique; used in keyframe file names |
| `name` | default "untitled"; `--camera` matches camera layers by this |
| `visibility` | `1` / `0` (default 1) |
| `type` | `1` bitmap, `2` vector, `4` sound, `5` camera. `3` (movie) and `0` are not loadable (`Q_UNREACHABLE`) |

**Bitmap layer** (`type="1"`), children `<image>`:

| attr | meaning |
|---|---|
| `frame` | keyframe position, starts at 1 |
| `src` | path relative to `data/` (absolute paths, `..` or symlinks escaping `data/` are rejected by `validateDataPath`) |
| `topLeftX`, `topLeftY` | integer canvas position of the PNG's top-left pixel |
| `opacity` | keyframe opacity, default 1.0 |

Canvas coordinates: origin (0,0) is the canvas centre; y grows downward. A W x H image centred on
the origin has `topLeftX=-W/2`, `topLeftY=-H/2` (this is exactly where File > Import > Image puts
it: `Editor::importBitmapImage`). PNGs can be any size: Pencil2D auto-crops bitmap keyframes to their
painted bounds when it saves, so saved files are usually small with non-trivial offsets.

**Vector layer** (`type="2"`), children `<image frame src opacity>` pointing to `.vec` files.
(If `src` is absent, the curves are read inline from the `<image>` element.)

**Sound layer** (`type="4"`), children `<sound frame="1" src="sound_....wav" name="My clip"/>`.
`frame` is where the clip starts; its length is derived from the audio. Imported clips are copied to
`data/sound_<yyyyMMdd_HHmmss_zzz>.<ext>`. Sound layers start with no keyframe.

**Camera layer** (`type="5"`): `width`, `height` = camera field in pixels (also the CLI's default
output size). Always write them: a missing value loads as 0. Optional `showPath="1"`,
`pathColorType` (0 red, 1 blue, 2 green, 3 black, 4 white). Children `<camera>`:

| attr | default | meaning |
|---|---|---|
| `frame` | | key position |
| `dx`, `dy` | 0 | view translation. The canvas point (-dx, -dy) is at the frame centre (with r=0, s=1). Pan the camera right by 100 px: dx goes 0 -> -100. |
| `r` | 0 | rotation in degrees |
| `s` | 1 | zoom factor, must be > 0 (2 = magnify 2x) |
| `easing` | 0 | interpolation from this key to the next (enum below); omitted when linear |
| `pathCPX`, `pathCPY` | | moved path control point (curved camera path); omitted when unmoved |

View transform = translate(dx,dy) * rotate(r) * scale(s) (`Camera::updateViewTransform`). Between
keys the camera interpolates; before the first key it uses the first key, after the last it holds.

Easing enum (`cameraeasingtype.h`, values by index):
0 LINEAR, 1 INQUAD, 2 OUTQUAD, 3 INOUTQUAD, 4 OUTINQUAD, 5 INCUBIC, 6 OUTCUBIC, 7 INOUTCUBIC,
8 OUTINCUBIC, 9 INQUART, 10 OUTQUART, 11 INOUTQUART, 12 OUTINQUART, 13 INQUINT, 14 OUTQUINT,
15 INOUTQUINT, 16 OUTINQUINT, 17 INSINE, 18 OUTSINE, 19 INOUTSINE, 20 OUTINSINE, 21 INEXPO,
22 OUTEXPO, 23 INOUTEXPO, 24 OUTINEXPO, 25 INCIRC, 26 OUTCIRC, 27 INOUTCIRC, 28 OUTINCIRC,
29 INELASTIC, 30 OUTELASTIC, 31 INOUTELASTIC, 32 OUTINELASTIC, 33 INBACK, 34 OUTBACK, 35 INOUTBACK,
36 OUTINBACK, 37 INBOUNCE, 38 OUTBOUNCE, 39 INOUTBOUNCE, 40 OUTINBOUNCE.
(These map to Qt `QEasingCurve` types; the enum exists in 0.7.x and master.)

If a project has no camera layer, Pencil2D adds one on load (`FileManager::verifyObject`) using the
app's saved camera size (default 800x600). If it has no layers at all, master adds a bitmap layer.

## Keyframe file naming

Written by Pencil2D on save:

- bitmap: `%03d.%03d.png` -> `<layerId>.<frame>.png`, e.g. `002.001.png`, `002.1000.png`
- vector: `%03d.%03d.vec`, e.g. `003.012.vec`
- palette: `palette.xml`; sounds keep their `sound_...` names

On load, `src` can be any relative name inside `data/`; on the next save Pencil2D renames/moves the
files to the canonical pattern. Keep layer `id`s unique so names do not collide.

## .vec files

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE PencilVectorImage>
<image type="vector">
  <curve width="2" variableWidth="true" invisible="false" filled="false" colourNumber="0"
         originX="-50" originY="0" originPressure="1">
    <segment c1x="-20" c1y="-40" c2x="20" c2y="-40" vx="50" vy="0" pressure="1"/>
  </curve>
  <area colourNumber="3" filled="1">
    <vertex curve="0" vertex="-1"/> <vertex curve="0" vertex="0"/> ...
  </area>
</image>
```

- DOCTYPE must be `PencilVectorImage`, root `<image type="vector">`, otherwise the frame loads empty.
- A curve = origin + cubic Bezier `<segment>`s (control points c1, c2, end vertex v, pressure). Optional
  `feather`. `width="0"` makes the curve invisible.
- `colourNumber` is an **index into data/palette.xml** (or the default palette when that file is
  missing: 0 Black, 1 Red, 2 Dark Red, 3 Orange, ...). Vector colours change if the palette changes.
- `<area>` fills reference curve vertices by (curve index, vertex index); vertex `-1` is the curve's
  origin, vertex `k` is the end point of segment `k` (`BezierCurve::getVertex`).
- Empty frame: `<image type="vector"/>`.

## palette.xml

```xml
<!DOCTYPE PencilPalette>
<palette>
  <Color name="Black" red="0" green="0" blue="0" alpha="255"/>
</palette>
```

## Minimal working project (hand-written)

Two bitmap frames on a 640x480 camera. Zip these entries (any ZIP tool; `mimetype` optional):

```
main.xml
data/002.001.png      (640x480)
data/002.002.png      (640x480)
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE PencilDocument>
<document>
  <projectdata>
    <fps value="12"/>
  </projectdata>
  <object>
    <layer id="1" name="Camera Layer" visibility="1" type="5" width="640" height="480">
      <camera frame="1" r="0" s="1" dx="0" dy="0"/>
    </layer>
    <layer id="2" name="Bitmap Layer" visibility="1" type="1">
      <image frame="1" src="002.001.png" topLeftX="-320" topLeftY="-240"/>
      <image frame="2" src="002.002.png" topLeftX="-320" topLeftY="-240"/>
    </layer>
  </object>
</document>
```

## Generating from a folder of PNGs

`scripts/png_folder_to_pclx.py` (standard library only) does the above for any number of frames:

```bash
python scripts/png_folder_to_pclx.py frames/ shot.pclx --fps 24 --hold 2 --camera 1920x1080
```

- Sorts PNGs naturally (`f_2` before `f_10`), keyframe i at `start + i*hold`.
- Centres each image on the origin (`topLeft = -(w//2), -(h//2)`), camera = first image size unless
  `--camera` is given.
- Writes `mimetype` (stored), `main.xml`, `data/002.<frame>.png` (PNGs stored, not recompressed).
- Prints the `--end` to use when the last image is held (see command-line gotcha 4) and warns about
  odd sizes for MP4.

Core of it, if you need to inline it:

```python
import zipfile, struct
from pathlib import Path

def png_size(p):
    h = Path(p).read_bytes()[:24]
    return struct.unpack(">II", h[16:24])

def make_pclx(pngs, out, fps=12, hold=1):
    w, h = png_size(pngs[0])
    imgs = []
    for i, p in enumerate(pngs):
        f = 1 + i * hold
        iw, ih = png_size(p)
        imgs.append((f, "002.%03d.png" % f, -(iw // 2), -(ih // 2), p))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE PencilDocument>\n<document>\n'
           f'<projectdata><fps value="{fps}"/></projectdata>\n<object>\n'
           f'<layer id="1" name="Camera Layer" visibility="1" type="5" width="{w}" height="{h}">'
           '<camera frame="1" r="0" s="1" dx="0" dy="0"/></layer>\n'
           '<layer id="2" name="Bitmap Layer" visibility="1" type="1">\n'
           + "".join(f'<image frame="{f}" src="{s}" topLeftX="{x}" topLeftY="{y}"/>\n' for f, s, x, y, _ in imgs)
           + '</layer>\n</object>\n</document>\n')
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/x-pencil2d-pclx", compress_type=zipfile.ZIP_STORED)
        z.writestr("main.xml", xml)
        for f, s, _, _, p in imgs:
            z.write(p, "data/" + s)
```

Note: `<projectdata>` above holds a single element on one line; do not put XML comments in it.

## Reading / editing an existing project

Unzip, edit `main.xml`, re-zip with `main.xml` and `data/` at the archive root (not inside a
top-level folder). Inspect quickly with Python:

```python
import zipfile; z = zipfile.ZipFile("shot.pclx")
print(z.namelist()); print(z.read("main.xml").decode())
```
