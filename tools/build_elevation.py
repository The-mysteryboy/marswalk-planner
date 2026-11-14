#!/usr/bin/env python3
"""Build the compact elevation grid used by the app from the USGS CTX DEM.

    python tools/build_elevation.py <path/to/M20_JezeroCrater_CTXDEM_20m.tif> \
        [--waypoints <path/to/M20_waypoints.json>] [--out data]

Needs: rasterio, numpy, pyproj. The CRS is read from the file, never assumed.

Output:
    data/terrain.json         metadata for both grids (bounds, size, encoding, source)
    data/terrain_full.bin     the 40 m report grid, little-endian Int16 residuals
    data/terrain_coarse.bin   an 80 m preview grid in the same format

Row 0 of both grids is the north edge. Every safety number comes from the full
grid, which is the one validated against the rover. The coarse grid exists only
so the map can respond while the full grid downloads. It smooths away short steep
slopes, so the app labels anything drawn from it as a preview and gives no verdict.

Why a .bin: 2.3 million samples are about 4.6 MB as Int16, and several times that as JSON text.

Why residuals: terrain is smooth, so each value is close to what its neighbours
predict. Storing only the difference lets the web server's gzip cut the download
from 3.6 MB to about 1.9 MB. It is lossless: decoding restores every sample exactly,
and metadata carries the SHA-256 of the decoded samples so the browser can check.

The file name carries a version on purpose. A browser can briefly mix old cached
code with new data, and old code reading residuals as heights would give wrong
slopes with no error. A new name makes that case a visible load failure instead.
"""
import argparse
import hashlib
import json
import math
import os
import sys

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.windows import Window

# Crop box in degrees. Holds the crater, delta, rim and the rover's traverse.
BBOX = {"west": 77.02, "east": 78.12, "south": 17.96, "north": 18.96}

# Block-average factor. 2 turns the 20 m source into 40 m cells, which keeps the
# output under the 5 MB target for this box. Averaging beats decimating because
# one noisy source pixel cannot create a false cliff.
FACTOR = 2

# Int16 encoding: elevation_m = stored * SCALE + OFFSET. 0.1 m steps add at most
# 0.05 m of rounding error, which is negligible against a 40 m cell.
SCALE = 0.1
OFFSET = -2000.0
NODATA_INT = -32768

# The preview averages 2 x 2 blocks of the report grid, so it has 4x fewer cells.
# Whole-metre steps cut its size by a third, which suits a preview-only grid.
COARSE_FACTOR = 2
COARSE_SCALE = 1.0

SOURCE = {
    "name": "Mars 2020 Science Investigation CTX DEM Mosaic (USGS Astrogeology)",
    "url": "https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic",
    "file": "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif",
}

# Named places for the spot check. Crater center is the IAU/USGS nomenclature
# point. The rim point is the rover's highest stretch on the western rim.
SPOT_CHECKS = [
    ("Crater center (IAU nomenclature)", 18.4082, 77.6873),
    ("Landing site (M20 first waypoint)", 18.44462715, 77.45088572),
]


def block_mean(arr, factor):
    """Mean over factor x factor blocks, ignoring NaN. All-NaN blocks stay NaN."""
    h, w = arr.shape
    h -= h % factor
    w -= w % factor
    blocks = arr[:h, :w].reshape(h // factor, factor, w // factor, factor)
    valid = np.isfinite(blocks)
    counts = valid.sum(axis=(1, 3))
    totals = np.where(valid, blocks, 0.0).sum(axis=(1, 3), dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = totals / counts
    return np.where(counts > 0, out, np.nan)


def predict_residuals(samples):
    """Each cell minus its prediction: left + above - above-left.

    The first row uses the cell to its left, the first column the cell above, and
    the first cell is stored as it is. js/terrain.js undoes this in decodeGrid().
    Values wrap as 16-bit integers, which the decoder wraps back exactly.
    """
    s = samples.astype(np.int32)
    r = s.copy()
    r[1:, 1:] = s[1:, 1:] - s[1:, :-1] - s[:-1, 1:] + s[:-1, :-1]
    r[0, 1:] = s[0, 1:] - s[0, :-1]
    r[1:, 0] = s[1:, 0] - s[:-1, 0]
    return r.astype("<i2")


def coarse_grid(stored):
    """Average blocks of the report grid into preview samples in COARSE_SCALE steps."""
    h, w = stored.shape
    if h % COARSE_FACTOR or w % COARSE_FACTOR:
        sys.exit("The report grid must divide evenly, or the two grids would cover different areas")
    blocks = stored.astype(np.int32).reshape(h // COARSE_FACTOR, COARSE_FACTOR, w // COARSE_FACTOR, COARSE_FACTOR)
    missing = (blocks == NODATA_INT).any(axis=(1, 3))
    out = np.rint(blocks.mean(axis=(1, 3)) * SCALE / COARSE_SCALE).astype(np.int32)
    out[missing] = NODATA_INT
    return out.astype("<i2")


def write_grid(samples, name, out_dir):
    """Write the residuals and return (file name, SHA-256 of the decoded samples)."""
    predict_residuals(samples).tofile(os.path.join(out_dir, name))
    return name, hashlib.sha256(samples.tobytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dem")
    ap.add_argument("--waypoints", help="M20_waypoints.json, for the ground-truth check")
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    with rasterio.open(args.dem) as src:
        crs = CRS.from_wkt(src.crs.to_wkt())
        print(f"Source: {src.width} x {src.height}, {src.res[0]} m/pixel, nodata {src.nodata}")
        print(f"CRS from file: {crs.name}, sphere radius {crs.ellipsoid.semi_major_metre} m")
        to_ll = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
        to_xy = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)

        x0, y1 = to_xy.transform(BBOX["west"], BBOX["north"])
        x1, y0 = to_xy.transform(BBOX["east"], BBOX["south"])
        inv = ~src.transform
        col0, row0 = inv * (x0, y1)
        col1, row1 = inv * (x1, y0)
        col0, row0 = int(math.floor(col0)), int(math.floor(row0))
        ncols = int(math.ceil(col1)) - col0
        nrows = int(math.ceil(row1)) - row0
        ncols -= ncols % FACTOR
        nrows -= nrows % FACTOR
        if col0 < 0 or row0 < 0 or col0 + ncols > src.width or row0 + nrows > src.height:
            sys.exit(f"BBOX falls outside the DEM: window {col0},{row0} {ncols}x{nrows}")

        win = Window(col0, row0, ncols, nrows)
        raw = src.read(1, window=win, masked=True).astype("float64").filled(np.nan)
        # The stored nodata is a huge negative float. Catch near-matches too.
        raw[raw < -1e30] = np.nan
        tr = src.window_transform(win)

    grid = block_mean(raw, FACTOR)
    height, width = grid.shape
    cell_x = abs(tr.a) * FACTOR
    cell_y = abs(tr.e) * FACTOR

    # Outer edges of the grid. The projection is linear in lon and in lat, so a
    # regular x/y grid is also a regular lon/lat grid. Confirmed below.
    left, top = tr.c, tr.f
    right, bottom = left + cell_x * width, top - cell_y * height
    west, north = to_ll.transform(left, top)
    east, south = to_ll.transform(right, bottom)
    midlon, midlat = to_ll.transform((left + right) / 2, (top + bottom) / 2)
    lin_err = max(abs(midlon - (west + east) / 2), abs(midlat - (north + south) / 2))
    if lin_err > 1e-9:
        sys.exit(f"Grid is not linear in lon/lat (error {lin_err} deg), cannot use a simple bilinear sampler")

    stored = np.where(np.isfinite(grid), np.rint((grid - OFFSET) / SCALE), NODATA_INT)
    if stored.min() < -32768 or stored.max() > 32767:
        sys.exit("Elevation does not fit Int16 with this SCALE/OFFSET")
    stored = stored.astype("<i2")

    os.makedirs(args.out, exist_ok=True)
    bin_path = os.path.join(args.out, "terrain_full.bin")
    full_file, full_sha = write_grid(stored, "terrain_full.bin", args.out)
    coarse = coarse_grid(stored)
    coarse_file, coarse_sha = write_grid(coarse, "terrain_coarse.bin", args.out)

    def grid_meta(file, sha, grid_width, grid_height, cell, scale, role):
        return {
            "role": role,
            "bounds": {"west": west, "east": east, "south": south, "north": north},
            "width": grid_width,
            "height": grid_height,
            "cell_size_m": cell,
            "cell_note": "Projected metres on the 3396.19 km sphere of the DEM CRS, averaged from the 20 m source",
            "nodata": NODATA_INT,
            "encoding": {
                "file": file,
                "type": "Int16LE",
                "filter": "predict-2d",
                "order": "row 0 is the north edge, west to east",
                "formula": "elevation_m = stored * scale + offset, after undoing the filter",
                "scale": scale,
                "offset": OFFSET,
                "sha256": sha,
            },
            "source": SOURCE,
            "crs": crs.name,
            "vertical_note": "Metres relative to the Mars areoid (MOLA-tied), the reference used by the source DEM",
        }

    index = {
        "full": grid_meta(full_file, full_sha, width, height, cell_x, SCALE, "report"),
        "coarse": grid_meta(coarse_file, coarse_sha, coarse.shape[1], coarse.shape[0], cell_x * COARSE_FACTOR, COARSE_SCALE, "preview"),
    }
    with open(os.path.join(args.out, "terrain.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, indent=2)

    def sample(lat, lon):
        col = (lon - west) / (east - west) * width - 0.5
        row = (north - lat) / (north - south) * height - 0.5
        c0, r0 = int(math.floor(col)), int(math.floor(row))
        if not (0 <= c0 < width - 1 and 0 <= r0 < height - 1):
            return None
        fx, fy = col - c0, row - r0
        q = grid[r0:r0 + 2, c0:c0 + 2]
        if not np.isfinite(q).all():
            return None
        return float(q[0, 0] * (1 - fx) * (1 - fy) + q[0, 1] * fx * (1 - fy) + q[1, 0] * (1 - fx) * fy + q[1, 1] * fx * fy)

    print("\n--- Verification ---")
    print(f"Report grid: {width} x {height} cells at {cell_x:.0f} m, {os.path.getsize(bin_path) / 1e6:.2f} MB raw")
    print(f"Preview grid: {coarse.shape[1]} x {coarse.shape[0]} cells at {cell_x * COARSE_FACTOR:.0f} m")
    print(f"Bounds: W {west:.5f}, E {east:.5f}, S {south:.5f}, N {north:.5f}")
    print(f"Elevation: min {np.nanmin(grid):.1f} m, max {np.nanmax(grid):.1f} m, nodata cells {int(np.isnan(grid).sum())}")

    floor = None
    for name, lat, lon in SPOT_CHECKS:
        e = sample(lat, lon)
        print(f"  {name}: {e:.1f} m" if e is not None else f"  {name}: outside coverage")
        floor = e if "Landing" in name else floor

    if args.waypoints:
        with open(args.waypoints, encoding="utf-8") as f:
            props = [x["properties"] for x in json.load(f)["features"]]
        rows = []
        for p in props:
            e = sample(float(p["lat"]), float(p["lon"]))
            if e is not None:
                rows.append((e - float(p["elev_geoid"]), float(p["elev_geoid"]), e, p))
        d = np.array([r[0] for r in rows])
        print(f"\nDEM minus rover elev_geoid over {len(d)} of {len(props)} waypoints:")
        print(f"  mean {d.mean():+.2f} m, std {d.std():.2f} m, RMS {math.sqrt((d * d).mean()):.2f} m")
        print(f"  median {np.median(d):+.2f} m, |error| 95th pct {np.percentile(np.abs(d), 95):.2f} m, worst {np.abs(d).max():.2f} m")
        rim = max(rows, key=lambda r: r[1])
        p = rim[3]
        print(f"  Highest rover waypoint (western rim), sol {p['sol']}: rover {rim[1]:.1f} m, DEM {rim[2]:.1f} m")
        if floor is not None:
            print(f"  Rim above landing site in DEM: {rim[2] - floor:+.1f} m, rover measured: {rim[1] - float(props[0]['elev_geoid']):+.1f} m")
            print(f"  CHECK crater floor below rim: {'PASS' if floor < rim[2] else 'FAIL'}")


if __name__ == "__main__":
    main()
