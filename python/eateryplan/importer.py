"""Convert an image detection (pixel coordinates) into an Eatery Plan document.

The detection can come from any source: a vision model asked to fill detection.schema.json,
a classic CV pipeline, or a person tracing the image. This module does the deterministic part:

1. maps pixels to floor units (aspect ratio preserved, width = `target_width`)
2. snaps nearly horizontal/vertical walls and merges nearby wall end points
3. attaches doors/windows to the nearest wall
4. assigns tables to zones, numbers them, estimates missing seat counts
5. derives the real-world scale only from stated evidence (scale or dimension labels)
6. marks low-confidence objects with needsReview
"""
from __future__ import annotations

import hashlib
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path

from . import geometry as g
from .validate import SCHEMA_VERSION

REVIEW_BELOW = 0.6
SNAP_DEG = 4.0
SEAT_PITCH_M = 0.8   # table perimeter per seat when the scale is known


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _r(v, nd=2):
    return round(v, nd)


class _Ids:
    def __init__(self):
        self.n = {}

    def __call__(self, prefix):
        self.n[prefix] = self.n.get(prefix, 0) + 1
        return f"{prefix}_{self.n[prefix]}"


def _flags(conf, source):
    out = {"source": source, "confidence": _r(max(0.0, min(1.0, conf)), 3)}
    if conf < REVIEW_BELOW:
        out["needsReview"] = True
    return out


def _snap_walls(walls, tol):
    """Straighten near-axis walls, align close coordinates, attach T-junction ends."""
    for _ in range(2):
        for w in walls:
            dx, dy = w["x2"] - w["x1"], w["y2"] - w["y1"]
            ang = abs(math.degrees(math.atan2(dy, dx))) % 180
            if min(ang, 180 - ang) <= SNAP_DEG:
                y = (w["y1"] + w["y2"]) / 2
                w["y1"] = w["y2"] = y
            elif abs(ang - 90) <= SNAP_DEG:
                x = (w["x1"] + w["x2"]) / 2
                w["x1"] = w["x2"] = x
        # align coordinates: x values (and y values) closer than tol share their mean
        for axis in ("x", "y"):
            keys = sorted(((w[f"{axis}{k}"], i, k) for i, w in enumerate(walls) for k in (1, 2)))
            cluster = []
            for item in keys + [(math.inf, -1, 0)]:
                if cluster and item[0] - cluster[-1][0] > tol:
                    mean = statistics.fmean(c[0] for c in cluster)
                    for _, i, k in cluster:
                        walls[i][f"{axis}{k}"] = mean
                    cluster = []
                cluster.append(item)
    # T-junctions: a free end close to the middle of another wall is projected onto it
    for i, w in enumerate(walls):
        for k in (1, 2):
            p = (w[f"x{k}"], w[f"y{k}"])
            for j, o in enumerate(walls):
                if i == j:
                    continue
                a, b = (o["x1"], o["y1"]), (o["x2"], o["y2"])
                if 0 < g.project_t(p, a, b) < 1 and 0 < g.point_seg_dist(p, a, b) <= tol:
                    t = g.project_t(p, a, b)
                    w[f"x{k}"], w[f"y{k}"] = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    break
    return [w for w in walls if math.dist((w["x1"], w["y1"]), (w["x2"], w["y2"])) > tol]


def _box_shape(d, s, shape):
    cx, cy, w, h, rot = d["cx"] * s, d["cy"] * s, d["width"] * s, d["height"] * s, d.get("rotationDeg") or 0
    if shape == "round":
        r = (w + h) / 4
        out = {"kind": "ellipse", "cx": _r(cx), "cy": _r(cy), "rx": _r(r), "ry": _r(r)}
    elif shape == "oval":
        out = {"kind": "ellipse", "cx": _r(cx), "cy": _r(cy), "rx": _r(w / 2), "ry": _r(h / 2)}
    else:
        out = {"kind": "rect", "x": _r(cx - w / 2), "y": _r(cy - h / 2), "width": _r(w), "height": _r(h)}
    if rot:
        out["rotationDeg"] = _r(rot)
    return out


def _estimate_seats(shape, w_units, h_units, meters_per_unit):
    if meters_per_unit:
        w, h = w_units * meters_per_unit, h_units * meters_per_unit
        perim = math.pi * (w + h) / 2 if shape in ("round", "oval") else 2 * (w + h)
        return max(1, min(20, round(perim / SEAT_PITCH_M / 2) * 2 or 2))
    return 4  # unknown scale: placeholder, always flagged needsReview


def detection_to_plan(det: dict, *, plan_id: str = "plan_1", name: str = "Imported plan",
                      floor_name: str = "Ground floor", target_width: float = 1000.0,
                      image_path: str | None = None, source: str = "ai", tool: str | None = None,
                      locale: str | None = None) -> dict:
    W_px, H_px = det["image"]["widthPx"], det["image"]["heightPx"]
    if W_px <= 0 or H_px <= 0:
        raise ValueError("image size must be positive")
    s = target_width / W_px                      # floor units per pixel
    W, H = target_width, _r(H_px * s, 3)
    tol_px = max(4.0, 0.01 * max(W_px, H_px))
    ids, notes = _Ids(), list(det.get("notes", []))
    F = "floor_0"

    # ---- scale (only from evidence)
    ppm, scale_src = None, None
    if det["scale"]["pixelsPerMeter"]:
        ppm, scale_src = det["scale"]["pixelsPerMeter"], det["scale"]["evidence"] or "user_input"
    else:
        ratios = [math.dist((d["x1"], d["y1"]), (d["x2"], d["y2"])) / d["valueMeters"]
                  for lb in det["labels"] if (d := lb["dimension"]) and d["valueMeters"] > 0
                  and math.dist((d["x1"], d["y1"]), (d["x2"], d["y2"])) > 0]
        if ratios:
            ppm, scale_src = statistics.median(ratios), "dimension_label"
            if len(ratios) > 1 and (max(ratios) - min(ratios)) / ppm > 0.05:
                notes.append("dimension labels disagree by more than 5 %; scale uses their median")
    mpu = (1 / (ppm * s)) if ppm else None
    if mpu is None:
        notes.append("no scale evidence in the drawing; realWorldScale omitted")

    floor = {"id": F, "name": floor_name, "level": 0,
             "coordinateSpace": {"unit": "unit", "origin": "top-left", "xAxis": "right", "yAxis": "down",
                                 "width": W, "height": H},
             "zones": [], "walls": [], "openings": [], "tables": [], "fixtures": [],
             "climateDevices": [], "environmentalSensors": [], "labels": []}
    if mpu:
        floor["coordinateSpace"]["realWorldScale"] = {"metersPerUnit": round(mpu, 6), "source": scale_src}

    plan = {"format": "eateryplan", "schemaVersion": SCHEMA_VERSION, "planId": plan_id, "name": name,
            "revision": 1, "createdAt": _now(), "updatedAt": _now(), "assets": [], "floors": [floor],
            "provenance": {"method": "image_import", "createdAt": _now()}}
    if locale:
        plan["locale"] = locale
    if tool:
        plan["provenance"]["tool"] = tool
    if image_path:
        pth = Path(image_path)
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
                ".pdf": "application/pdf"}.get(pth.suffix.lower())
        if mime:
            asset = {"id": "asset_source", "mimeType": mime, "url": pth.name, "widthPx": W_px, "heightPx": H_px}
            if pth.exists():
                asset["sha256"] = hashlib.sha256(pth.read_bytes()).hexdigest()
            plan["assets"].append(asset)
            plan["provenance"]["sourceAssetId"] = asset["id"]
            floor["background"] = {"assetId": asset["id"], "opacity": 0.35,
                                   "transform": {"x": 0, "y": 0, "width": W, "height": H}}

    # ---- zones
    auto_named: set[str] = set()
    zone_polys = []
    for room in det["rooms"]:
        pts = [(p["x"] * s, p["y"] * s) for p in room["polygon"]]
        flags = _flags(room["confidence"], source)
        if len(pts) >= 3 and g.self_intersects(pts):
            pts = g.convex_hull(pts)
            flags["needsReview"] = True
            notes.append("a room outline intersected itself and was replaced by its convex hull")
        if len(pts) < 3 or g.area(pts) < 1e-6:
            notes.append("dropped a room with fewer than 3 usable points")
            continue
        zid = ids("zone")
        nm = room["name"]
        if not nm:
            nm = f"{room['kind'].replace('_', ' ').title()} {ids.n['zone']}"
            auto_named.add(zid)
        floor["zones"].append({"id": zid, "floorId": F, "name": nm, "kind": room["kind"],
                               "shape": {"kind": "polygon", "points": [{"x": _r(x), "y": _r(y)} for x, y in pts]},
                               **flags})
        zone_polys.append((zid, pts, g.area(pts)))

    def zone_at(p):
        hits = [(a, zid) for zid, pts, a in zone_polys if g.point_in_poly(p, pts)]
        return min(hits)[1] if hits else None   # smallest containing zone wins

    # ---- walls
    raw = [dict(w) for w in det["walls"]]
    snapped = _snap_walls(raw, tol_px)
    if len(snapped) < len(raw):
        notes.append(f"dropped {len(raw) - len(snapped)} wall(s) shorter than the snap tolerance")
    default_thick = statistics.median([w["thicknessPx"] for w in snapped if w["thicknessPx"]] or [tol_px])
    for w in snapped:
        floor["walls"].append({"id": ids("wall"), "floorId": F,
                               "a": {"x": _r(w["x1"] * s), "y": _r(w["y1"] * s)},
                               "b": {"x": _r(w["x2"] * s), "y": _r(w["y2"] * s)},
                               "thickness": _r(max(0.5, (w["thicknessPx"] or default_thick) * s)),
                               "kind": w["kind"], **_flags(w["confidence"], source)})

    # ---- openings: attach to nearest wall
    taken: dict[str, list] = {}
    for o in det["openings"]:
        p = (o["x"] * s, o["y"] * s)
        best = None
        for wd in floor["walls"]:
            a, b = (wd["a"]["x"], wd["a"]["y"]), (wd["b"]["x"], wd["b"]["y"])
            d = g.point_seg_dist(p, a, b)
            if best is None or d < best[0]:
                best = (d, wd, a, b)
        reach = max(tol_px * s, (best[1]["thickness"] * 1.5) if best else 0)
        if not best or best[0] > reach:
            notes.append(f"dropped a {o['kind']} at ({o['x']:.0f},{o['y']:.0f})px: no wall nearby")
            continue
        _, wd, a, b = best
        L = math.dist(a, b)
        width = o["widthPx"] * s
        flags = _flags(o["confidence"], source)
        if width > 0.95 * L:
            width = 0.95 * L
            flags["needsReview"] = True
        c = max(width / 2, min(L - width / 2, g.project_t(p, a, b) * L))
        if any(c - width / 2 < e1 and s1 < c + width / 2 for s1, e1 in taken.get(wd["id"], [])):
            notes.append(f"dropped a {o['kind']} overlapping another opening on {wd['id']}")
            continue
        taken.setdefault(wd["id"], []).append((c - width / 2, c + width / 2))
        op = {"id": ids(o["kind"]), "floorId": F, "wallId": wd["id"], "kind": o["kind"],
              "position": round(c / L, 4), "width": _r(width), **flags}
        if o["kind"] == "archway":
            op.update(swing="none", opensToward="none", hinge="none")
        elif o["swing"]:
            op["swing"] = o["swing"]
        floor["openings"].append(op)

    # ---- tables
    numbers = set()
    for t in det["tables"]:
        shape = _box_shape(t, s, t["shape"])
        flags = _flags(t["confidence"], source)
        center = (t["cx"] * s, t["cy"] * s)
        number = (t["label"] or "").strip()
        if not number or number.casefold() in numbers:
            number = f"T{len(floor['tables']) + 1}"
            while number.casefold() in numbers:
                number += "b"
        numbers.add(number.casefold())
        seats = t["seats"]
        if not seats or seats < 1:
            seats = _estimate_seats(t["shape"], t["width"] * s, t["height"] * s, mpu)
            flags["needsReview"] = True
        tb = {"id": ids("table"), "floorId": F, "zoneId": zone_at(center), "number": number,
              "shape": shape, "seats": int(seats), **flags}
        if t["kind"]:
            tb["kind"] = t["kind"]
        floor["tables"].append(tb)

    # ---- fixtures & climate devices
    for fx in det["fixtures"]:
        center = (fx["cx"] * s, fx["cy"] * s)
        item = {"id": ids(fx["kind"]), "floorId": F, "zoneId": zone_at(center), "kind": fx["kind"],
                "shape": _box_shape(fx, s, fx["shape"]), **_flags(fx["confidence"], source)}
        if fx["name"]:
            item["name"] = fx["name"]
        floor["fixtures"].append(item)
    for cd in det["climateDevices"]:
        center = (cd["cx"] * s, cd["cy"] * s)
        zid = zone_at(center)
        item = {"id": ids("climate"), "floorId": F, "zoneId": zid, "kind": cd["kind"],
                "shape": _box_shape(cd, s, "rect"), **_flags(cd["confidence"], source)}
        if cd["mount"]:
            item["mount"] = cd["mount"]
        if zid:
            item["coveredZoneIds"] = [zid]
        floor["climateDevices"].append(item)

    # ---- labels: room names become zone names, the rest stay labels
    zones_by_id = {z["id"]: z for z in floor["zones"]}
    for lb in det["labels"]:
        pos = (lb["x"] * s, lb["y"] * s)
        text = lb["text"].strip()
        if not text:
            continue
        d = lb["dimension"]
        if d is None:
            zid = zone_at(pos)
            z = zones_by_id.get(zid)
            if z and text.casefold() == z["name"].casefold():
                continue  # already the zone name
            if z and zid in auto_named:
                z["name"] = text  # auto-named zone takes the drawn room name
                auto_named.discard(zid)
                continue
        item = {"id": ids("label"), "floorId": F, "kind": "dimension" if d else "text", "text": text,
                "position": {"x": _r(pos[0]), "y": _r(pos[1])}, **_flags(lb["confidence"], source)}
        if d:
            # keep the text off the dimension line: move it to the side it was drawn on (or above)
            a, b = (d["x1"] * s, d["y1"] * s), (d["x2"] * s, d["y2"] * s)
            L = math.dist(a, b) or 1
            nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L        # left-hand normal (up for a->b to the right)
            side = (pos[0] - a[0]) * nx + (pos[1] - a[1]) * ny
            gap = 0.012 * W
            if abs(side) < gap:
                sign = 1 if side >= 0 else -1
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                item["position"] = {"x": _r(mid[0] + nx * gap * sign), "y": _r(mid[1] + ny * gap * sign)}
            item["a"] = {"x": _r(d["x1"] * s), "y": _r(d["y1"] * s)}
            item["b"] = {"x": _r(d["x2"] * s), "y": _r(d["y2"] * s)}
            if d["valueMeters"] > 0:
                item["valueMeters"] = d["valueMeters"]
        floor["labels"].append(item)

    if notes:
        plan["provenance"]["notes"] = notes
    return plan
