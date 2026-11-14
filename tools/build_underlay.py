#!/usr/bin/env python3
"""Stitch a small local copy of the Trek CTX mosaic for use under the live tiles.

    python tools/build_underlay.py [--out data]

Needs: Pillow. Writes data/jezero_underlay.webp and prints its bounds, which
belong in UNDERLAY in js/layers.js.

The image paints the map as soon as the page opens, and keeps it usable if the
NASA tile server is unreachable. Bounds are the exact edges of the tile grid.
"""
import argparse
import base64
import io
import math
import os
import urllib.request

from PIL import Image

PRODUCT = "Jezero_CTX_BlockAdj_dd"
TILE = "https://trek.nasa.gov/tiles/Mars/EQ/" + PRODUCT + "/1.0.0/default/default028mm/{z}/{row}/{col}.png"
ZOOM = 9  # One tile spans 180 / 2^z degrees, so about 81 m per pixel here.
AREA = {"west": 76.6, "east": 78.5, "south": 17.6, "north": 19.3}
SHRINK = (2, 3)  # Output size as a fraction of the stitched tiles, so about 122 m per pixel.
QUALITY = 50


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "MarswalkPlanner-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    span = 180 / 2 ** ZOOM
    col0 = math.floor((AREA["west"] + 180) / span)
    col1 = math.floor((AREA["east"] + 180) / span)
    row0 = math.floor((90 - AREA["north"]) / span)
    row1 = math.floor((90 - AREA["south"]) / span)
    cols, rows = col1 - col0 + 1, row1 - row0 + 1
    print(f"Fetching {cols} x {rows} tiles at z{ZOOM}")

    sheet = Image.new("RGB", (cols * 256, rows * 256))
    for row in range(row0, row1 + 1):
        for col in range(col0, col1 + 1):
            data = fetch(TILE.format(z=ZOOM, row=row, col=col))
            sheet.paste(Image.open(io.BytesIO(data)).convert("RGB"), ((col - col0) * 256, (row - row0) * 256))

    os.makedirs(args.out, exist_ok=True)
    name = "jezero_underlay.webp"
    path = os.path.join(args.out, name)
    # CTX is greyscale, so colour channels would only add bytes.
    size = (sheet.width * SHRINK[0] // SHRINK[1], sheet.height * SHRINK[0] // SHRINK[1])
    image = sheet.convert("L").resize(size, Image.LANCZOS)
    image.save(path, quality=QUALITY, method=6)

    bounds = [[90 - (row1 + 1) * span, col0 * span - 180], [90 - row0 * span, (col1 + 1) * span - 180]]
    print(f"Wrote {path}: {image.width} x {image.height}, {os.path.getsize(path) / 1024:.0f} KB")
    print(f"Bounds for UNDERLAY in js/layers.js: {bounds}")

    tiny = image.resize((128, 128 * image.height // image.width), Image.LANCZOS)
    buffer = io.BytesIO()
    tiny.save(buffer, "WEBP", quality=30, method=6)
    print(f"placeholder for UNDERLAY: data:image/webp;base64,{base64.b64encode(buffer.getvalue()).decode()}")


if __name__ == "__main__":
    main()
