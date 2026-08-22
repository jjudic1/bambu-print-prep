"""A1 spike: determine how Bambu writes the <build><item transform=...> matrix.

The 12 numbers could be the rows of a column-vector matrix M, or its transpose.
plate_N.json records the real on-bed bounding box of every placed object, so we
can apply both candidate readings and see which reproduces it.
"""
import json
import os
import re
import zipfile

import numpy as np

SRC = os.path.expanduser("~/Downloads/ptfe_tool.3mf")


def parse_model(xml):
    """Return {object_id: vertices}, and the list of build items."""
    meshes, items = {}, []
    for obj in re.finditer(r'<object id="(\d+)"[^>]*>(.*?)</object>', xml, re.S):
        oid, body = int(obj.group(1)), obj.group(2)
        verts = np.array(
            [[float(v) for v in m.groups()] for m in
             re.finditer(r'<vertex x="([-\d.e+]+)" y="([-\d.e+]+)" z="([-\d.e+]+)"/>', body)],
            dtype=float)
        if len(verts):
            meshes[oid] = verts
        comp = re.search(r'<component objectid="(\d+)"', body)
        if comp:
            meshes[oid] = meshes.get(int(comp.group(1)))
    for item in re.finditer(r'<item objectid="(\d+)" transform="([^"]+)"', xml):
        items.append((int(item.group(1)),
                      np.array([float(x) for x in item.group(2).split()], dtype=float)))
    return meshes, items


def as_rows(v):
    """Read the 12 values as rows of a column-vector matrix M (v' = M @ v)."""
    M = np.eye(4)
    M[:3, :3] = v[:9].reshape(3, 3)
    M[:3, 3] = v[9:]
    return M


def as_columns(v):
    """Read them as the 3MF row-vector convention (transpose of the above)."""
    M = np.eye(4)
    M[:3, :3] = v[:9].reshape(3, 3).T
    M[:3, 3] = v[9:]
    return M


def xy_bbox(verts, M):
    pts = (M[:3, :3] @ verts.T).T + M[:3, 3]
    return [pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()]


def main():
    z = zipfile.ZipFile(SRC)
    meshes, items = parse_model(z.read("3D/3dmodel.model").decode("utf-8"))
    truth = json.loads(z.read("Metadata/plate_1.json").decode("utf-8"))["bbox_objects"]

    print(f"{len(items)} build items, {len(truth)} recorded bboxes\n")
    err = {"rows": 0.0, "columns": 0.0}

    for i, (oid, vals) in enumerate(items):
        verts = meshes[oid]
        expected = truth[i]["bbox"]
        for label, reader in (("rows", as_rows), ("columns", as_columns)):
            got = xy_bbox(verts, reader(vals))
            d = max(abs(a - b) for a, b in zip(got, expected))
            err[label] = max(err[label], d)
            print(f"  item {i} {label:8s} bbox {[round(v, 3) for v in got]}  max err {d:8.4f}")
        print(f"  item {i} recorded  bbox {[round(v, 3) for v in expected]}\n")

    winner = min(err, key=err.get)
    print(f"worst error  rows={err['rows']:.4f}  columns={err['columns']:.4f}")
    print(f"=> transform is written as {winner.upper()} "
          f"(error {err[winner]:.4g} vs {err[max(err, key=err.get)]:.4g})")


if __name__ == "__main__":
    main()
