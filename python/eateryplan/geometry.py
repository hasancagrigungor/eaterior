"""Geometry helpers shared by the validator and the importer.

All coordinates are floor units: origin top-left, x to the right, y downwards.
Positive angles are clockwise on screen. The formulas here are the reference for
every renderer (see docs/rendering.md).
"""
from __future__ import annotations

import math

Pt = tuple[float, float]


def rotate(pts: list[Pt], deg: float, c: Pt) -> list[Pt]:
    if not deg:
        return list(pts)
    r = math.radians(deg)
    cs, sn = math.cos(r), math.sin(r)
    return [(c[0] + (x - c[0]) * cs - (y - c[1]) * sn,
             c[1] + (x - c[0]) * sn + (y - c[1]) * cs) for x, y in pts]


def bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_center(pts) -> Pt:
    b = bbox(pts)
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2


def path_pivot(commands) -> Pt:
    """Pivot of a path: bbox centre of every coordinate written in the commands."""
    pts = []
    for c in commands:
        for kx, ky in (("x", "y"), ("cx", "cy"), ("c1x", "c1y"), ("c2x", "c2y")):
            if kx in c and ky in c:
                pts.append((c[kx], c[ky]))
    return bbox_center(pts)


def arc_points(p0: Pt, cmd: dict, n: int = 16) -> list[Pt]:
    """SVG endpoint-parameterised elliptical arc to points (excluding p0)."""
    x1, y1 = p0
    x2, y2 = cmd["x"], cmd["y"]
    rx, ry = abs(cmd["rx"]), abs(cmd["ry"])
    if (x1, y1) == (x2, y2) or rx == 0 or ry == 0:
        return [(x2, y2)]
    phi = math.radians(cmd.get("xAxisRotationDeg", 0))
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if cmd["largeArc"] == cmd["sweep"]:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not cmd["sweep"] and dt > 0:
        dt -= 2 * math.pi
    elif cmd["sweep"] and dt < 0:
        dt += 2 * math.pi
    out = []
    for i in range(1, n + 1):
        t = t1 + dt * i / n
        out.append((cx + rx * math.cos(t) * cp - ry * math.sin(t) * sp,
                    cy + rx * math.cos(t) * sp + ry * math.sin(t) * cp))
    return out


def shape_points(s: dict) -> list[Pt]:
    """Approximate a shape (rotation applied) as polygon points."""
    k = s["kind"]
    rot = s.get("rotationDeg", 0)
    if k == "rect":
        x, y, w, h = s["x"], s["y"], s["width"], s["height"]
        return rotate([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], rot, (x + w / 2, y + h / 2))
    if k == "ellipse":
        cx, cy, rx, ry = s["cx"], s["cy"], s["rx"], s["ry"]
        pts = [(cx + rx * math.cos(2 * math.pi * i / 32), cy + ry * math.sin(2 * math.pi * i / 32)) for i in range(32)]
        return rotate(pts, rot, (cx, cy))
    if k == "polygon":
        pts = [(p["x"], p["y"]) for p in s["points"]]
        return rotate(pts, rot, bbox_center(pts))
    # path
    pts, cur, start = [], (0.0, 0.0), (0.0, 0.0)
    for c in s["commands"]:
        m = c["cmd"]
        if m == "M":
            cur = start = (c["x"], c["y"]); pts.append(cur)
        elif m == "L":
            cur = (c["x"], c["y"]); pts.append(cur)
        elif m == "Q":
            p0, p1, p2 = cur, (c["cx"], c["cy"]), (c["x"], c["y"])
            for i in range(1, 9):
                t = i / 8
                pts.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
            cur = p2
        elif m == "C":
            p0, p1, p2, p3 = cur, (c["c1x"], c["c1y"]), (c["c2x"], c["c2y"]), (c["x"], c["y"])
            for i in range(1, 13):
                t = i / 12
                a, b, cc, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                pts.append((a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0],
                            a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1]))
            cur = p3
        elif m == "A":
            pts.extend(arc_points(cur, c)); cur = (c["x"], c["y"])
        elif m == "Z":
            cur = start
    if not pts:
        return pts
    return rotate(pts, rot, path_pivot(s["commands"]))


class WallGeom:
    """Straight or curved (bulge) wall. t in [0, 1] runs from a to b."""

    def __init__(self, w: dict):
        self.a = (w["a"]["x"], w["a"]["y"])
        self.b = (w["b"]["x"], w["b"]["y"])
        self.thickness = w["thickness"]
        self.chord = math.dist(self.a, self.b)
        self.bulge = w.get("bulge", 0) or 0
        self.curved = bool(self.bulge) and self.chord > 0
        if not self.curved:
            self.length = self.chord
            return
        theta = 4 * math.atan(self.bulge)          # signed sweep angle
        self.radius = self.chord / (2 * math.sin(abs(theta) / 2))
        self.length = abs(theta) * self.radius
        ux, uy = (self.b[0] - self.a[0]) / self.chord, (self.b[1] - self.a[1]) / self.chord
        nx, ny = -uy, ux                           # right-hand normal of a->b (y down)
        mx, my = (self.a[0] + self.b[0]) / 2, (self.a[1] + self.b[1]) / 2
        sagitta = abs(self.bulge) * self.chord / 2
        sign = 1 if self.bulge > 0 else -1
        d = self.radius - sagitta
        self.center = (mx - sign * nx * d, my - sign * ny * d)
        self.a0 = math.atan2(self.a[1] - self.center[1], self.a[0] - self.center[0])
        apex = (mx + sign * nx * sagitta, my + sign * ny * sagitta)
        self.sweep = abs(theta)
        mid = self._at_angle(self.a0 + self.sweep / 2)
        if math.dist(mid, apex) > 1e-6 * max(1.0, self.chord):
            self.sweep = -abs(theta)

    def _at_angle(self, ang):
        return (self.center[0] + self.radius * math.cos(ang), self.center[1] + self.radius * math.sin(ang))

    def point_at(self, t: float) -> Pt:
        if not self.curved:
            return (self.a[0] + (self.b[0] - self.a[0]) * t, self.a[1] + (self.b[1] - self.a[1]) * t)
        return self._at_angle(self.a0 + self.sweep * t)

    def tangent_at(self, t: float) -> Pt:
        if not self.curved:
            if self.chord == 0:
                return (1.0, 0.0)
            return ((self.b[0] - self.a[0]) / self.chord, (self.b[1] - self.a[1]) / self.chord)
        ang = self.a0 + self.sweep * t
        s = 1 if self.sweep > 0 else -1
        return (-math.sin(ang) * s, math.cos(ang) * s)

    def polyline(self, n: int = 16) -> list[Pt]:
        if not self.curved:
            return [self.a, self.b]
        return [self.point_at(i / n) for i in range(n + 1)]


def _orient(p, q, r):
    v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)


def seg_intersect(p1, p2, p3, p4) -> bool:
    o1, o2, o3, o4 = _orient(p1, p2, p3), _orient(p1, p2, p4), _orient(p3, p4, p1), _orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True

    def on(p, q, r):
        return (min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9 and
                min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9)
    return ((o1 == 0 and on(p1, p3, p2)) or (o2 == 0 and on(p1, p4, p2)) or
            (o3 == 0 and on(p3, p1, p4)) or (o4 == 0 and on(p3, p2, p4)))


def point_seg_dist(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def project_t(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    return 0.0 if L2 == 0 else ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2


def self_intersects(pts) -> bool:
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        for j in range(i + 1, n):
            if (j + 1) % n == i or j == (i + 1) % n:
                continue
            if seg_intersect(a, b, pts[j], pts[(j + 1) % n]):
                return True
    return False


def area(pts) -> float:
    n = len(pts)
    return abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2


def point_in_poly(p, pts) -> bool:
    x, y, inside = p[0], p[1], False
    for i in range(len(pts)):
        (x1, y1), (x2, y2) = pts[i], pts[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def polys_overlap(a, b) -> bool:
    ba, bb = bbox(a), bbox(b)
    if ba[2] <= bb[0] or bb[2] <= ba[0] or ba[3] <= bb[1] or bb[3] <= ba[1]:
        return False
    for i in range(len(a)):
        for j in range(len(b)):
            if seg_intersect(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]):
                return True
    return point_in_poly(a[0], b) or point_in_poly(b[0], a)


def poly_polyline_dist(poly, line) -> float:
    """Minimum distance between a closed polygon and an open polyline (0 if they touch or overlap)."""
    for i in range(len(line) - 1):
        for j in range(len(poly)):
            if seg_intersect(line[i], line[i + 1], poly[j], poly[(j + 1) % len(poly)]):
                return 0.0
    if any(point_in_poly(p, poly) for p in line):
        return 0.0
    d = math.inf
    for i in range(len(line) - 1):
        for p in poly:
            d = min(d, point_seg_dist(p, line[i], line[i + 1]))
    for p in line:
        for j in range(len(poly)):
            d = min(d, point_seg_dist(p, poly[j], poly[(j + 1) % len(poly)]))
    return d


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]
