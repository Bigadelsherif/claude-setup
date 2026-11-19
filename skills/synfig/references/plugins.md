# Synfig Studio Python plugins (and the Lottie exporter)

Verified against `synfig-docs/source/plugins.rst`, `synfig-studio/src/gui/pluginmanager.cpp`
(v1.5.5 and v1.4.5), `synfig-studio/src/synfigapp/main.cpp`, `resourcehelper.cpp`, and the
bundled plugins in `synfig-studio/plugins/` (v1.5.5).

## What a plugin is

A directory containing `plugin.xml` + a Python 3 script (+ any helper files). Studio scans:

| Location | Path |
|---|---|
| User plugins, Windows | `%USERPROFILE%\Synfig\plugins\<plugin-dir>\` |
| User plugins, Linux | `~/.config/synfig/plugins/` |
| User plugins, macOS | `~/Library/Synfig/plugins/` |
| Override of the user settings dir | env `SYNFIG_USER_SETTINGS` (plugins go in `<that>/plugins`) |
| Bundled (system) plugins | `<install>/share/synfig/plugins/` → Windows default `C:\Program Files\Synfig\share\synfig\plugins\` |

Restart Studio after adding a plugin. Menu plugins appear under the canvas menu **Plug-Ins**;
exporters appear as file types in **File > Export**; importers in the open/import dialog.

## Python interpreter lookup

1. env `SYNFIG_PYTHON_BINARY` if set;
2. Windows: `<install>/python/python3.exe` then `<install>/python/python.exe` (bundled Python);
   other OSes: `python3` then `python` on PATH.
The binary must pass a Python 3 version check. Scripts run with the plugin directory as the
working directory.

## plugin.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plugin>
  <name>Unhide All Layers</name>
  <name xml:lang="es">Activa todas las capas</name>   <!-- optional translations -->
  <exec>view-unhide-all-layers.py</exec>
</plugin>
```

Elements under `<plugin>`:
- `<name>` (required; repeatable with `xml:lang`).
- `<exec>` script path relative to the plugin dir. Present → menu item in Plug-Ins.
  Attributes (all optional):
  - `type="python"` (only supported interpreter; default python),
  - `stdout` / `stderr` = `ignore` | `log` (Synfig log) | `message` (dialog). Docs: stdout
    defaults to ignore, stderr to message.
  - **1.5.x only**: `modify_doc="true|false"` (default true: Studio reloads the file after the
    script), `current_time` and `selected_layers` = `unused` (default) | `optional` | `mandatory`.
- `<exporter>` / `<importer>` (repeatable): each needs exactly one `<exec>`, at least one
  `<extension>` (no dot), and a default `<description>` (text shown in the file dialog).
- **1.5.x only**: `<description>`, `<author>`, `<version>` (integer), `<url>`, `<release>` metadata.

Source trees use `plugin.xml.in` with `<_name>`/`<_description>` (intltool); installed files use
`<name>`/`<description>`. Write `<name>` in your own plugins.

## How scripts are called

| Kind | argv |
|---|---|
| Menu plugin (`<exec>` directly under `<plugin>`) | `script.py <copy-of-open-document.sif>` — modify that file in place; Studio reloads it. |
| Exporter | `script.py <document.sif> <chosen-output-path>` |
| Importer | `script.py <selected-input-file> <temp-output.sif>` — write a .sif to the second path; Studio loads it. |
| 1.5.x extra data | If `current_time`/`selected_layers` are requested or a dialog is defined, one more argument is appended: path to a JSON-like file `{"canvas_state": {"current_time": ..., "selected_layers": ["<xpath>", ...]}, "dialog": {"widget_name": "value", ...}}`. `selected_layers` are XPath strings locating the `<layer>` elements in the passed .sif. |

Caveat (v1.5.5 `instance.cpp`): `current_time` is inserted **unquoted** in `HH:MM:SS.ff` form, so
when it is requested the file is not strict JSON. Read it defensively, e.g. quote it with a regex
(`re.sub(r'("current_time":)([0-9:.]+)', r'\1"\2"', text)`) before `json.loads`.

1.5.x dialog: put a GtkBuilder file named `<script-basename>.ui` next to the script, with a
container widget whose id is `dialog_contents`. Studio shows it with OK/Cancel; named input
widgets (entries, spin buttons, switches, check buttons, combo boxes, color/file/font buttons,
scales) are serialized into `"dialog"` by widget name. Cancel aborts the run.

A non-zero exit status shows "Plugin execution failed".

## Minimal menu plugin (works in 1.4 and 1.5)

`%USERPROFILE%\Synfig\plugins\tint-regions\plugin.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plugin>
  <name>Tint all regions red</name>
  <exec stdout="log" stderr="message">tint.py</exec>
</plugin>
```

`tint.py`:

```python
import sys
import xml.etree.ElementTree as ET

def main(path):
    tree = ET.parse(path)
    for layer in tree.getroot().iter("layer"):
        if layer.get("type") not in ("region", "polygon", "circle", "rectangle", "star"):
            continue
        for param in layer.findall("param"):
            if param.get("name") == "color" and param.find("color") is not None:
                c = param.find("color")
                for ch, v in zip("rgba", ("1.0", "0.1", "0.1", c.findtext("a", "1.0"))):
                    c.find(ch).text = v
    tree.write(path, encoding="UTF-8", xml_declaration=True)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    main(sys.argv[1])
```

Notes:
- `ElementTree` drops nothing structural but reformats whitespace — fine for Synfig.
- Colours that are linked (`<param name="color" use="..."/>`) or animated (`<animated>`) have no
  direct `<color>` child; handle those cases explicitly if needed.
- The file passed is a plain `.sif` copy even if the document is `.sifz`/`.sfg`.
- Plugins can be tested outside Studio: `python tint.py some.sif`, then render with the CLI.

## Lottie exporter (bundled)

`synfig-studio/plugins/lottie-exporter/` (since Studio 1.4.0). Its `plugin.xml` registers four
exporters: `Lottie Animation (*.json)`, `Lottie HTML Preview (*.html)`, and "without variable
widths" variants of both (which convert `outline` layers as plain shapes). Use **File > Export**
and choose the type. (Older docs describe it as "Plugins > Export to Lottie", which wrote
FILE.json, FILE.html and FILE.log next to the document.)

Standalone use (no Studio UI) — requires Python 3 with `lxml`:

```bash
cd "/c/Program Files/Synfig/share/synfig/plugins/lottie-exporter"
python lottie-exporter.py "C:/path/scene.sif" "C:/path/scene.json"   # or .html
```

(`argparse` with positional `infile outfile`; output ending in `.html` gets an embedded
bodymovin player.) Feed it plain `.sif`.

Supported layer types (from `settings.py`): `circle, rectangle, filled_rectangle, star, region,
polygon, outline, advanced_outline, simple_circle, linear_gradient, radial_gradient,
solid_color/SolidColor, import, group, switch, rotate, zoom, translate, stretch, skeleton (only
as link source), blur, text`. Unsupported layers are skipped with a warning in the log.
Documented limitations: bones/skeleton deformation not exported; region/outline/polygon
animations are baked frame-by-frame; adding/removing spline points over time is unsupported.

## Other plugins

Bundled: `add-skeleton-simple` (inserts a stick-figure rig from a template .sif),
`view-unhide-all-layers`. Community list in the docs: FreeForm Deform (yoyobuae),
Import Labels and Timings (berteh), Controller plugin (veermetri05).
