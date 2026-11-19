#!/usr/bin/env python3
"""Build a Pencil2D .pclx project from a folder of PNG frames.

The result has one camera layer (id 1) and one bitmap layer (id 2). Each PNG
becomes a bitmap keyframe, centred on the canvas origin the same way
Pencil2D's own "Import Image" places pictures (topLeft = -w/2, -h/2).

Usage:
    python png_folder_to_pclx.py FRAMES_DIR OUT.pclx [--fps 12] [--hold 1]
        [--camera 1920x1080] [--layer-name "Bitmap Layer"] [--start 1]

Layout written (mirrors what Pencil2D 0.7.x saves):
    mimetype            (stored, uncompressed: application/x-pencil2d-pclx)
    main.xml
    data/002.001.png, data/002.002.png, ...

Pure standard library; no Pillow needed (PNG size is read from the IHDR chunk).
"""
import argparse
import re
import struct
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import quoteattr

PNG_SIG = b"\x89PNG\r\n\x1a\n"
CAMERA_ID = 1
BITMAP_ID = 2


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        head = f.read(24)
    if len(head) < 24 or head[:8] != PNG_SIG or head[12:16] != b"IHDR":
        raise ValueError(f"not a PNG file: {path}")
    return struct.unpack(">II", head[16:24])


def natural_key(p: Path):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def frame_file(layer_id: int, frame: int) -> str:
    # Same pattern Pencil2D uses: QString::asprintf("%03d.%03d.png", id, pos)
    return "%03d.%03d.png" % (layer_id, frame)


def build_main_xml(fps, cam_w, cam_h, layer_name, keys, last_frame):
    images = "\n".join(
        f'      <image frame="{frame}" src="{src}" topLeftX="{x}" topLeftY="{y}" opacity="1"/>'
        for frame, src, x, y in keys
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE PencilDocument>
<document>
  <projectdata>
    <currentFrame value="1"/>
    <currentColor r="0" g="0" b="0" a="255"/>
    <currentLayer value="1"/>
    <currentView m11="1" m12="0" m21="0" m22="1" dx="0" dy="0"/>
    <fps value="{fps}"/>
    <isLoop value="false"/>
    <isRangedPlayback value="false"/>
    <markInFrame value="1"/>
    <markOutFrame value="{last_frame}"/>
  </projectdata>
  <object>
    <layer id="{CAMERA_ID}" name="Camera Layer" visibility="1" type="5" width="{cam_w}" height="{cam_h}">
      <camera frame="1" r="0" s="1" dx="0" dy="0"/>
    </layer>
    <layer id="{BITMAP_ID}" name={quoteattr(layer_name)} visibility="1" type="1">
{images}
    </layer>
  </object>
</document>
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("frames_dir", type=Path)
    ap.add_argument("out", type=Path, help="output .pclx path")
    ap.add_argument("--fps", type=int, default=12, help="project frame rate (UI allows 1-90)")
    ap.add_argument("--hold", type=int, default=1, help="exposure: timeline frames per image (1 = ones, 2 = twos)")
    ap.add_argument("--camera", default=None, help="camera size WxH (default: size of the first PNG)")
    ap.add_argument("--layer-name", default="Bitmap Layer")
    ap.add_argument("--start", type=int, default=1, help="frame of the first image (frames start at 1)")
    a = ap.parse_args(argv)

    if a.start < 1 or a.hold < 1 or a.fps < 1:
        ap.error("--start, --hold and --fps must be >= 1")
    if a.out.suffix.lower() != ".pclx":
        ap.error("output must end in .pclx (Pencil2D only unzips files with that suffix)")

    pngs = sorted((p for p in a.frames_dir.iterdir() if p.suffix.lower() == ".png"), key=natural_key)
    if not pngs:
        ap.error(f"no .png files in {a.frames_dir}")

    sizes = [png_size(p) for p in pngs]
    if a.camera:
        cam_w, cam_h = (int(v) for v in a.camera.lower().split("x"))
    else:
        cam_w, cam_h = sizes[0]

    keys = []
    for i, (p, (w, h)) in enumerate(zip(pngs, sizes)):
        frame = a.start + i * a.hold
        # Match Editor::importBitmapImage: QPoint(-w/2, -h/2) with C++ integer division
        keys.append((frame, frame_file(BITMAP_ID, frame), -(w // 2), -(h // 2), p))

    last_key = keys[-1][0]
    last_frame = last_key + a.hold - 1
    if last_frame > 9999:
        print("warning: Pencil2D's timeline/import limit is 9999 frames", file=sys.stderr)

    xml = build_main_xml(a.fps, cam_w, cam_h, a.layer_name,
                         [(f, s, x, y) for f, s, x, y, _ in keys], last_frame)

    a.out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(a.out, "w") as z:
        # Pencil2D writes this first and uncompressed; the loader does not require it.
        z.writestr(zipfile.ZipInfo("mimetype"), "application/x-pencil2d-pclx",
                   compress_type=zipfile.ZIP_STORED)
        z.writestr("main.xml", xml, compress_type=zipfile.ZIP_DEFLATED)
        for frame, src, _, _, p in keys:
            # PNG is already compressed; store it.
            z.write(p, f"data/{src}", compress_type=zipfile.ZIP_STORED)

    print(f"wrote {a.out}: {len(keys)} keyframes, camera {cam_w}x{cam_h}, {a.fps} fps")
    if last_frame != last_key:
        print(f"note: last image is held to frame {last_frame}; the CLI's default --end is the last "
              f"keyframe ({last_key}), so export with --end {last_frame}")
    if cam_w % 2 or cam_h % 2:
        print("note: odd camera size; MP4 (yuv420p) export needs even width/height - pass even --width/--height")


if __name__ == "__main__":
    main()
