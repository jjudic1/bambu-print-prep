"""A1 spike, part 2: settle the transform convention across the whole corpus.

A single symmetric rotation cannot distinguish M from M.T. Scan every project
3mf that has both a plate_N.json (ground truth on-bed bboxes) and a genuinely
asymmetric rotation, and tally which reading reproduces the recorded bbox.
"""
import glob
import json
import os
import re
import zipfile

import numpy as np

CORPUS = os.path.expanduser("~/Downloads/*.3mf")
TOL = 0.05  # mm


def parse_model(xml):
    meshes, items = {}, []
    for obj in re.finditer(r'<object id="(\d+)"[^>]*?>(.*?)</object>', xml, re.S):
        oid, body = int(obj.group(1)), obj.group(2)
        verts = np.array(
            [[float(v) for v in m.groups()] for m in
             re.finditer(r'<vertex x="([-\d.eE+]+)" y="([-\d.eE+]+)" z="([-\d.eE+]+)"/>', body)],
            dtype=float)
        if len(verts):
            meshes[oid] = verts
        comp = re.search(r'<component objectid="(\d+)"', body)
        if comp and int(comp.group(1)) in meshes:
            meshes[oid] = meshes[int(comp.group(1))]
    for item in re.finditer(r'<item objectid="(\d+)" transform="([^"]+)"', xml):
        vals = np.array([float(x) for x in item.group(2).split()], dtype=float)
        if vals.size == 12:
            items.append((int(item.group(1)), vals))
    return meshes, items


def xy_bbox(verts, R, t):
    pts = (R @ verts.T).T + t
    return np.array([pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()])


def main():
    wins = {"rows": 0, "columns": 0}
    both = ties = 0
    examined = 0

    for path in sorted(glob.glob(CORPUS)):
        try:
            z = zipfile.ZipFile(path)
            names = z.namelist()
            if "Metadata/plate_1.json" not in names:
                continue
            meshes, items = parse_model(z.read("3D/3dmodel.model").decode("utf-8", "replace"))
            truth = json.loads(z.read("Metadata/plate_1.json").decode("utf-8"))["bbox_objects"]
        except Exception:
            continue
        if not items or len(truth) != len(items):
            continue

        for (oid, vals), rec in zip(items, truth):
            verts = meshes.get(oid)
            if verts is None or len(verts) < 4:
                continue
            R = vals[:9].reshape(3, 3)
            if np.allclose(R, R.T, atol=1e-6):
                continue                      # symmetric: cannot discriminate
            t = vals[9:]
            expected = np.array(rec["bbox"], dtype=float)
            d_rows = np.abs(xy_bbox(verts, R, t) - expected).max()
            d_cols = np.abs(xy_bbox(verts, R.T, t) - expected).max()
            examined += 1
            ok_r, ok_c = d_rows < TOL, d_cols < TOL
            if ok_r and ok_c:
                both += 1
            elif ok_r:
                wins["rows"] += 1
            elif ok_c:
                wins["columns"] += 1
            else:
                ties += 1

    print(f"asymmetric-rotation objects examined: {examined}")
    print(f"  reproduced by ROWS only    : {wins['rows']}")
    print(f"  reproduced by COLUMNS only : {wins['columns']}")
    print(f"  both readings agree        : {both}")
    print(f"  neither within {TOL} mm      : {ties}")


if __name__ == "__main__":
    main()
