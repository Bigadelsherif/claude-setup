# Generating and editing .sif files programmatically

Synfig has no official Python API for documents; the supported route is writing/editing the XML
(which is exactly what Studio plugins do). Format rules: `sif-format.md`; param names:
`layers.md`.

## Tools in this skill

| File | Purpose |
|---|---|
| `scripts/sif_builder.py` | Dependency-free builder: `Canvas`, `layer`, `circle`, `rectangle`, `star`, `region`, `outline`, `group`, `solid_color`, `anim(...)` waypoints, `Canvas.export()` + `Use()` for `<defs>` links, `.save("x.sif" / "x.sifz")`. `python sif_builder.py demo.sif` writes a demo. |
| `scripts/check_sif.py` | Static lint (units on times, interpolation names, composite links, undefined `use` ids, legacy version, unknown layer types). Run before rendering; then let Synfig itself load the file. |
| `assets/bouncing-ball.sif` | Hand-written reference document. |

Import the builder from another script:

```python
import sys; sys.path.insert(0, r"C:\Users\bigo_\.claude\skills\synfig\scripts")
from sif_builder import Canvas, circle, region, group, solid_color, anim, value, Use

doc = Canvas(width=1920, height=1080, fps=30, end_time="3s", units_per_height=18)  # 60 px/unit
doc.add(solid_color((0.05, 0.05, 0.08, 1)))
for i in range(5):
    doc.add(circle(0.8, (0.2 + 0.15 * i, 0.5, 0.9, 1),
                   origin=anim("vector", [("0s", (-12 + 6 * i, -6)),
                                          (f"{1 + i * 0.2:.2f}s", (-12 + 6 * i, 4), "halt"),
                                          ("3s", (-12 + 6 * i, -6))])))
doc.save("dots.sif")
```

## Workflow

1. Decide canvas size and view-box (units). Keep y-up and centre-origin in mind.
2. Write layers bottom-first; put a `solid_color` at the bottom if you need an opaque background.
3. Animate by replacing a constant with `<animated type=...>` + waypoints (times with units).
4. Share values through `<defs>` + `use="id"`.
5. `python check_sif.py out.sif`
6. `synfig out.sif --canvas-info all` → no errors on stderr; then a test still:
   `synfig out.sif -t png --time 1s -o test.png` and inspect the image.
7. Render the full animation (see `cli.md`).

## Editing existing files

- `.sifz`: `gzip.open(path, "rb")` → parse → modify → write back with `gzip.open(path, "wb")`.
- Use `xml.etree.ElementTree` (stdlib) or `lxml`. Preserve unknown elements and attributes —
  Studio writes `guid` attributes that link nodes; do not drop or duplicate them carelessly
  (copying a node with a guid inside the same file creates a *link*, not a copy).
- Find layers by `desc` (the Layers-panel name): `root.iter("layer")` + `layer.get("desc")`.
- Find a parameter: `layer.find("param[@name='origin']")`. Its value may be a constant element,
  an `<animated>` node, a converter, or a `use=` reference.
- To add a waypoint to a constant parameter, replace the constant child with an `<animated>`
  containing the old value at the first time plus the new waypoint(s).
- Exported canvases (`<defs><canvas id=...>`) can be rendered alone with `synfig -c id`.

## Batch rendering from Python (Windows)

```python
import subprocess
SYNFIG = r"C:\Program Files\Synfig\bin\synfig.exe"
subprocess.run([SYNFIG, "dots.sif", "-t", "ffmpeg", "--video-codec", "libx264",
                "--video-bitrate", "8000", "-o", "dots.mp4"], check=True)
```

Check the return code and stderr: parse errors stop the job; "rejected value for parameter"
warnings mean a wrong param name or value type was silently ignored.
