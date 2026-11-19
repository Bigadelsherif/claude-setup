#!/usr/bin/env python3
"""Static lint for hand-written / generated Synfig files (.sif, .sifz).

Catches the common mistakes that make Synfig refuse a file or silently misbehave.
It is NOT a substitute for loading the file in Synfig:
    synfig FILE --canvas-info all        (parse check, errors on stderr)

Checks:
  * well-formed XML, root <canvas>, width/height >= 1
  * version attribute present and not legacy ("1.0"/"0.x" -> gamma 2.2)
  * time strings carry units (bare non-zero numbers are read as FRAMES)
  * waypoint interpolation names are valid; no duplicate waypoint times
  * required links of composite bline_point / transformation nodes
  * every use="id" (without '#' or file path) is defined in <defs>
  * layer types against a list of known names (warning only)

Usage: python check_sif.py file.sif [more files...]   (exit code 1 on errors)
"""
import gzip
import re
import sys
import xml.etree.ElementTree as ET

KNOWN_LAYERS = set("""
advanced_outline bevel blur checker_board chromakey circle clamp colorcorrect conical_gradient
curve_gradient curve_warp duplicate filter_group freetime group halftone2 halftone3 import
inside_out julia linear_gradient lumakey mandelbrot metaballs motion_blur noise noise_distort
outline plant polygon radial_blur radial_gradient rectangle filled_rectangle region rotate shade
shape simple_circle skeleton skeleton_deformation solid_color sound spherize spiral_gradient star
stretch stroboscope super_sample svg_layer switch text timeloop translate twirl warp xor_pattern
zoom PasteCanvas paste_canvas SolidColor MotionBlur Polygon
""".split())
INTERP = {"halt", "constant", "linear", "manual", "auto", "clamped"}
REQUIRED_LINKS = {
    "bline_point": ["point", "width", "origin", "split", "t1", "t2", "split_radius", "split_angle"],
    "transformation": ["offset", "angle", "skew_angle", "scale"],
}
TIME_RE = re.compile(r"^\s*(sot|bot|eot|\d+:\d+:\d+(\.\d+)?|(\s*-?[\d.]+\s*[hmsf])+)\s*$", re.I)


def load(path):
    if path.lower().endswith(".sifz"):
        with gzip.open(path, "rb") as f:
            return ET.fromstring(f.read())
    return ET.parse(path).getroot()


def check_time(val, where, errors):
    v = val.strip()
    try:
        if float(v) == 0:
            return
        errors.append(f"{where}: time '{val}' has no unit -> Synfig reads it as FRAMES")
        return
    except ValueError:
        pass
    if not TIME_RE.match(v):
        errors.append(f"{where}: unparseable time '{val}'")


def check(path):
    errors, warnings = [], []
    try:
        root = load(path)
    except Exception as e:  # noqa: BLE001
        return [f"XML parse error: {e}"], []
    if root.tag != "canvas":
        return ["root element is not <canvas>"], []
    ver = root.get("version")
    if not ver:
        warnings.append("canvas has no version attribute (write version=\"1.2\")")
    elif ver == "1.0" or ver.startswith("0."):
        warnings.append(f"version=\"{ver}\" is legacy: canvas gamma 2.2 is applied to colours")
    for a in ("width", "height"):
        if root.get(a) is not None and int(root.get(a)) < 1:
            errors.append(f"canvas {a} < 1")
    for a in ("begin-time", "start-time", "end-time"):
        if root.get(a) is not None:
            check_time(root.get(a), f"canvas@{a}", errors)

    defined = {el.get("id") for d in root.findall("defs") for el in d if el.get("id")}

    for el in root.iter():
        tag = el.tag
        if tag == "layer":
            t = el.get("type")
            if not t:
                errors.append("layer without type")
            elif t not in KNOWN_LAYERS:
                warnings.append(f"unknown layer type '{t}' (check `synfig --layers`)")
        if tag in ("waypoint", "keyframe") and el.get("time") is not None:
            check_time(el.get("time"), f"<{tag}>", errors)
        if tag == "time" and el.get("value") is not None:
            check_time(el.get("value"), "<time>", errors)
        if tag == "waypoint":
            for a in ("before", "after"):
                if el.get(a) and el.get(a) not in INTERP:
                    errors.append(f"waypoint {a}='{el.get(a)}' invalid (use {sorted(INTERP)})")
        if tag == "animated":
            times = [w.get("time") for w in el.findall("waypoint")]
            if len(times) != len(set(times)):
                errors.append(f"<animated> has duplicate waypoint times {times}")
            if not el.get("type"):
                errors.append("<animated> without type")
        if tag == "composite":
            need = REQUIRED_LINKS.get(el.get("type", ""))
            have = {c.tag for c in el}
            legacy = any(re.fullmatch(r"c\d+", h) for h in have)  # old files: <c1>.. links
            reused = not have and el.get("guid")                     # guid back-reference
            if need and not legacy and not reused:
                missing = [n for n in need if n not in have]
                if missing:
                    errors.append(f"<composite type='{el.get('type')}'> missing links {missing}")
        use = el.get("use")
        if use and "#" not in use and "/" not in use and "\\" not in use:
            ident = use.rsplit(":", 1)[-1]
            if ident not in defined:
                errors.append(f"use='{use}' not defined in <defs>")
        if tag == "param" and use is None and len(list(el)) == 0:
            errors.append(f"<param name='{el.get('name')}'> is empty and has no use=")
    return errors, warnings


def main(paths):
    bad = False
    for p in paths:
        errors, warnings = check(p)
        for w in warnings:
            print(f"{p}: warning: {w}")
        for e in errors:
            print(f"{p}: error: {e}")
        if errors:
            bad = True
        else:
            print(f"{p}: OK (static checks)")
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
