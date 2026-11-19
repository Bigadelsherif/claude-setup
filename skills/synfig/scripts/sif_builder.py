#!/usr/bin/env python3
"""Tiny dependency-free helper for generating Synfig .sif / .sifz files.

Covers the XML forms documented in ../references/sif-format.md:
canvas, layers, constant values, <animated> waypoints, <defs> exports,
groups with inline canvases, and closed/open splines (bline).

Usage as a library:
    from sif_builder import *
    doc = Canvas(width=1920, height=1080, fps=24, end_time="2s", units_per_height=18)
    doc.add(solid_color((1, 1, 1, 1)))
    doc.add(circle(radius=1.0, color=(0.9, 0.2, 0.1, 1),
                   origin=anim("vector", [("0s", (-6, 0)), ("2s", (6, 0))], interp="clamped")))
    doc.save("out.sif")       # or "out.sifz" (gzip)

Run directly to write a demo:  python sif_builder.py demo.sif
Then:  synfig demo.sif --canvas-info all   (parse check)
       synfig demo.sif -t png -o frames/demo.png
"""
import gzip
import sys
import xml.etree.ElementTree as ET

INTERPOLATIONS = {"clamped", "auto", "linear", "halt", "constant"}  # auto = TCB, halt = ease in/out


def _fmt(v):
    s = f"{float(v):.10f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


# ---------------------------------------------------------------- values
def value(vtype, v):
    """Return an Element for a constant value of Synfig type `vtype`."""
    if vtype == "real":
        return ET.Element("real", value=_fmt(v))
    if vtype == "integer":
        return ET.Element("integer", value=str(int(v)))
    if vtype == "bool":
        return ET.Element("bool", value="true" if v else "false")
    if vtype == "angle":  # degrees
        return ET.Element("angle", value=_fmt(v))
    if vtype == "time":  # always pass a unit, e.g. "1s" or "12f"
        return ET.Element("time", value=str(v))
    if vtype == "string":
        e = ET.Element("string")
        e.text = str(v)
        return e
    if vtype == "vector":
        e = ET.Element("vector")
        ET.SubElement(e, "x").text = _fmt(v[0])
        ET.SubElement(e, "y").text = _fmt(v[1])
        return e
    if vtype == "color":
        r, g, b = v[:3]
        a = v[3] if len(v) > 3 else 1.0
        e = ET.Element("color")
        for tag, c in zip("rgba", (r, g, b, a)):
            ET.SubElement(e, tag).text = f"{float(c):.6f}"
        return e
    raise ValueError(f"unsupported type {vtype}")


def anim(vtype, keys, interp="clamped"):
    """<animated type=vtype> with waypoints. keys: [(time_str, value) or (time_str, value, interp)]."""
    a = ET.Element("animated", type=vtype)
    for k in keys:
        t, v = k[0], k[1]
        ip = k[2] if len(k) > 2 else interp
        if ip not in INTERPOLATIONS:
            raise ValueError(f"interpolation must be one of {INTERPOLATIONS}")
        if isinstance(t, (int, float)):
            raise ValueError("pass times as strings with units, e.g. '1s' or '24f'")
        w = ET.SubElement(a, "waypoint", time=t, before=ip, after=ip)
        w.append(value(vtype, v))
    return a


class Use:
    """Reference to an exported value: Use('my_id') -> <param use="my_id"/>."""

    def __init__(self, ident):
        self.ident = ident


# ---------------------------------------------------------------- layers
_PARAM_TYPES = {
    "z_depth": "real", "amount": "real", "blend_method": "integer",
    "color": "color", "origin": "vector", "invert": "bool", "antialias": "bool",
    "feather": "real", "radius": "real", "point1": "vector", "point2": "vector",
    "expand": "real", "bevel": "real", "radius1": "real", "radius2": "real",
    "angle": "angle", "points": "integer", "regular_polygon": "bool",
    "width": "real", "sharp_cusps": "bool", "center": "vector", "size": "vector",
    "type": "integer", "text": "string", "family": "string", "weight": "integer",
    "orient": "vector", "filename": "string", "time_offset": "time",
    "time_dilation": "real", "tl": "vector", "br": "vector",
}


def layer(ltype, desc=None, version=None, params=None, param_types=None, active=True):
    """Generic layer. params: {name: python value | Element | Use}."""
    attrs = {"type": ltype, "active": "true" if active else "false",
             "exclude_from_rendering": "false"}
    if version:
        attrs["version"] = version
    if desc:
        attrs["desc"] = desc
    el = ET.Element("layer", attrs)
    types = dict(_PARAM_TYPES, **(param_types or {}))
    for name, v in (params or {}).items():
        if isinstance(v, Use):
            ET.SubElement(el, "param", name=name, use=v.ident)
            continue
        p = ET.SubElement(el, "param", name=name)
        if isinstance(v, ET.Element):
            p.append(v)
        else:
            if name not in types:
                raise ValueError(f"unknown type for param {name!r}; pass param_types or an Element")
            p.append(value(types[name], v))
    return el


def solid_color(color, desc="Background"):
    return layer("solid_color", desc, "0.1", {"color": color})


def circle(radius, color, origin=(0, 0), desc="Circle", **extra):
    return layer("circle", desc, "0.2", dict(color=color, radius=radius, origin=origin, **extra))


def rectangle(p1, p2, color, desc="Rectangle", **extra):
    return layer("rectangle", desc, "0.2", dict(color=color, point1=p1, point2=p2, **extra))


def star(radius1, radius2, points, color, origin=(0, 0), angle=90, desc="Star", **extra):
    return layer("star", desc, "0.1", dict(color=color, origin=origin, radius1=radius1,
                                          radius2=radius2, points=points, angle=angle, **extra))


def bline(points, loop=True, tangents=None):
    """Spline from [(x, y), ...]. tangents: optional [(tx, ty), ...] (same for t1 and t2).
    Without tangents, uses Catmull-Rom style tangents for a smooth curve."""
    n = len(points)
    if tangents is None:
        tangents = []
        for i in range(n):
            if loop:
                p0, p2 = points[(i - 1) % n], points[(i + 1) % n]
            else:
                p0, p2 = points[max(i - 1, 0)], points[min(i + 1, n - 1)]
            # Hermite tangent (Catmull-Rom): half the vector between the neighbours
            tangents.append(((p2[0] - p0[0]) * 0.5, (p2[1] - p0[1]) * 0.5))
    b = ET.Element("bline", type="bline_point", loop="true" if loop else "false")
    for pt, tg in zip(points, tangents):
        comp = ET.SubElement(ET.SubElement(b, "entry"), "composite", type="bline_point")
        for link, vt, v in (("point", "vector", pt), ("width", "real", 1.0),
                            ("origin", "real", 0.5), ("split", "bool", False),
                            ("t1", "vector", tg), ("t2", "vector", tg),
                            ("split_radius", "bool", True), ("split_angle", "bool", False)):
            ET.SubElement(comp, link).append(value(vt, v))
    return b


def region(points, color, loop=True, desc="Region", **extra):
    return layer("region", desc, "0.1", dict(color=color, bline=bline(points, loop), **extra))


def outline(points, color, width=0.1, loop=False, desc="Outline", **extra):
    return layer("outline", desc, "0.3", dict(color=color, width=width,
                                             bline=bline(points, loop), **extra))


def transformation(offset=(0, 0), angle=0, skew=0, scale=(1, 1)):
    c = ET.Element("composite", type="transformation")
    for link, vt, v in (("offset", "vector", offset), ("angle", "angle", angle),
                        ("skew_angle", "angle", skew), ("scale", "vector", scale)):
        sub = ET.SubElement(c, link)
        sub.append(v if isinstance(v, ET.Element) else value(vt, v))
    return c


def group(children, desc="Group", offset=(0, 0), angle=0, scale=(1, 1), origin=(0, 0), **extra):
    """children: list of layer Elements, bottom first. offset/angle/scale may be anim(...) Elements."""
    inner = ET.Element("canvas")
    for ch in children:
        inner.append(ch)
    return layer("group", desc, "0.3", dict(origin=origin,
                                           transformation=transformation(offset, angle, 0, scale),
                                           canvas=inner, **extra))


# ---------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, width=480, height=270, fps=24, begin_time="0f", end_time="5s",
                 units_per_height=4.5, bgcolor=(0.5, 0.5, 0.5, 1.0), name="Generated",
                 version="1.2"):
        """units_per_height sets the view-box; default 4.5 matches Synfig's 480x270 default
        (60 px/unit). The view-box is centred on 0,0 with y up."""
        hh = units_per_height / 2.0
        hw = hh * width / height
        self.root = ET.Element("canvas", {
            "version": version, "width": str(width), "height": str(height),
            "xres": "2834.645669", "yres": "2834.645669",
            "view-box": f"{-hw:.6f} {hh:.6f} {hw:.6f} {-hh:.6f}",
            "antialias": "1", "fps": f"{float(fps):.3f}",
            "begin-time": begin_time, "end-time": end_time,
            "bgcolor": " ".join(f"{c:.6f}" for c in bgcolor),
        })
        ET.SubElement(self.root, "name").text = name
        self.defs = None

    def export(self, ident, element):
        """Put a value/animated Element into <defs> with id; reference it with Use(ident)."""
        if self.defs is None:
            self.defs = ET.Element("defs")
            self.root.insert(1, self.defs)  # after <name>
        element.set("id", ident)
        self.defs.append(element)
        return Use(ident)

    def keyframe(self, time, label=""):
        k = ET.Element("keyframe", time=time, active="true")
        k.text = label
        idx = 1 + (self.defs is not None)
        self.root.insert(idx, k)

    def add(self, layer_el):
        """Append a layer. Later layers are drawn ON TOP of earlier ones."""
        self.root.append(layer_el)
        return layer_el

    def tostring(self):
        ET.indent(self.root, space="  ")
        return ET.tostring(self.root, encoding="unicode", xml_declaration=False)

    def save(self, path):
        data = '<?xml version="1.0" encoding="UTF-8"?>\n' + self.tostring() + "\n"
        if str(path).lower().endswith(".sifz"):
            with gzip.open(path, "wt", encoding="utf-8") as f:
                f.write(data)
        else:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(data)


def demo():
    doc = Canvas(width=480, height=270, fps=24, end_time="2s", name="Builder demo")
    accent = doc.export("accent", value("color", (0.95, 0.35, 0.15, 1)))
    doc.add(solid_color((0.96, 0.95, 0.92, 1)))
    doc.add(rectangle((-4, -1.6), (4, -2.25), (0.2, 0.2, 0.25, 1), desc="Floor"))
    doc.add(region([(-3.5, 1.5), (-2.5, 1.9), (-2.0, 1.2), (-3.0, 0.9)],
                   (0.3, 0.6, 0.9, 1), desc="Blob"))
    doc.add(group([
        circle(0.5, Use("accent"), desc="Ball"),
        star(0.25, 0.1, 5, (1, 1, 1, 1), desc="Sparkle"),
    ], desc="Ball group",
        offset=anim("vector", [("0s", (-3, 1)), ("1s", (0, -1.1), "halt"), ("2s", (3, 1))]),
        angle=anim("angle", [("0s", 0), ("2s", 360)], interp="linear")))
    doc.add(outline([(-3, 1), (0, -1.1), (3, 1)], (0.2, 0.2, 0.25, 0.5), width=0.03,
                    desc="Path guide"))
    return doc


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "demo.sif"
    demo().save(out)
    print(f"wrote {out}")
