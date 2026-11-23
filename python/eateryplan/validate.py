"""Structural (JSON Schema) and semantic validation for Eatery Plan documents."""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator

from . import geometry as g

SCHEMA_VERSION = "1.1.1"
SUPPORTED_VERSIONS = ("1.0.0", "1.1.0", "1.1.1")
BOUNDS_TOLERANCE = 0.01  # objects may exceed the floor by 1 % of its size
LOW_CONFIDENCE = 0.5
METRIC_TO_READING = {
    "temperature": "temperatureC", "humidity": "relativeHumidityPct", "co2": "co2Ppm",
    "pm25": "pm25UgM3", "pm10": "pm10UgM3", "voc": "vocPpb", "pressure": "pressureHpa",
    "noise": "noiseDbA", "occupancy": "occupancyCount", "light": "illuminanceLux",
}
OBJECT_LISTS = ["zones", "walls", "openings", "tables", "fixtures", "climateDevices",
                "environmentalSensors", "labels"]
DATE_KEYS = {"createdAt", "updatedAt", "timestamp", "generatedAt", "since", "reservedFrom", "reservedUntil"}


def schema_dir() -> Path:
    env = os.environ.get("EATERYPLAN_SCHEMA_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    for cand in (here / "schemas", here.parent.parent / "schemas" / f"v{SCHEMA_VERSION}"):
        if (cand / "eateryplan.schema.json").exists():
            return cand
    raise FileNotFoundError("schemas not found; set EATERYPLAN_SCHEMA_DIR")


def load_schema(name: str) -> dict:
    return json.loads((schema_dir() / name).read_text(encoding="utf-8"))


# ---------------------------------------------------------------- report
@dataclass
class Issue:
    level: str  # "error" | "warning"
    code: str
    path: str
    message: str


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)

    def error(self, code, path, msg):
        self.issues.append(Issue("error", code, path, msg))

    def warn(self, code, path, msg):
        self.issues.append(Issue("warning", code, path, msg))

    @property
    def errors(self):
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self):
        return [i for i in self.issues if i.level == "warning"]

    @property
    def ok(self):
        return not self.errors

    def as_dict(self):
        return {"ok": self.ok, "errorCount": len(self.errors), "warningCount": len(self.warnings),
                "issues": [asdict(i) for i in self.issues]}

    def format(self) -> str:
        lines = [f"[{'ERROR' if i.level == 'error' else 'WARN '}] {i.code:<24} {i.path}: {i.message}"
                 for i in self.issues]
        lines.append(f"\n{len(self.errors)} error(s), {len(self.warnings)} warning(s) -> "
                     f"{'VALID' if self.ok else 'INVALID'}")
        return "\n".join(lines)


def is_datetime(s) -> bool:
    """RFC 3339 date-time; timezone required."""
    if not isinstance(s, str) or "T" not in s.upper():
        return False
    try:
        d = datetime.fromisoformat(s[:-1] + "+00:00" if s[-1:] in "Zz" else s)
    except ValueError:
        return False
    return d.tzinfo is not None


def _walk_dates(o, p, report):
    # jsonschema only asserts date-time when an optional package is installed; check it ourselves.
    if isinstance(o, dict):
        for k, v in o.items():
            if k in DATE_KEYS and isinstance(v, str) and not is_datetime(v):
                report.error("datetime", f"{p}.{k}", f"not an RFC 3339 date-time with timezone: {v!r}")
            elif k != "extensions":
                _walk_dates(v, f"{p}.{k}", report)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            _walk_dates(v, f"{p}[{i}]", report)


def _jpath(parts) -> str:
    return "$" + "".join(f"[{x}]" if isinstance(x, int) else f".{x}" for x in parts)


def schema_check(doc, schema, report: Report):
    v = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)
    for e in sorted(v.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path))):
        report.error("schema", _jpath(e.absolute_path), e.message)
    _walk_dates(doc, "$", report)


# ---------------------------------------------------------------- semantic
def semantic_check(plan: dict, r: Report):
    ids: dict[str, str] = {}

    def reg(i, p):
        if i in ids:
            r.error("duplicate_id", p, f"id '{i}' is already used by {ids[i]}")
        else:
            ids[i] = p

    asset_ids = set()
    for ai, a in enumerate(plan.get("assets", [])):
        reg(a["id"], f"$.assets[{ai}]")
        asset_ids.add(a["id"])
    prov = plan.get("provenance") or {}
    if prov.get("sourceAssetId") and prov["sourceAssetId"] not in asset_ids:
        r.error("missing_ref", "$.provenance.sourceAssetId", f"'{prov['sourceAssetId']}' is not in assets")

    all_tables = {t["id"] for fl in plan["floors"] for t in fl.get("tables", [])}
    table_numbers, ext_tables, ext_devices = {}, {}, {}

    for fi, fl in enumerate(plan["floors"]):
        fp = f"$.floors[{fi}]"
        reg(fl["id"], fp)
        cs = fl["coordinateSpace"]
        W, H = cs["width"], cs["height"]
        tx, ty = W * BOUNDS_TOLERANCE, H * BOUNDS_TOLERANCE

        bg = fl.get("background")
        if bg and bg["assetId"] not in asset_ids:
            r.error("missing_ref", f"{fp}.background.assetId", f"'{bg['assetId']}' is not in assets")

        local = {k: {o["id"]: o for o in fl.get(k, [])} for k in OBJECT_LISTS}
        zones = local["zones"]
        zone_polys = {zid: g.shape_points(z["shape"]) for zid, z in zones.items()}

        def in_bounds(pts, p):
            x0, y0, x1, y1 = g.bbox(pts)
            if x0 < -tx or y0 < -ty or x1 > W + tx or y1 > H + ty:
                r.error("out_of_bounds", p, f"outside the floor: bbox=({x0:.1f},{y0:.1f})-({x1:.1f},{y1:.1f}), "
                                            f"floor={W}x{H}")

        def zone_ref(zid, p, fld="zoneId"):
            if zid is not None and zid not in zones:
                r.error("missing_ref", f"{p}.{fld}", f"'{zid}' is not a zone on this floor")

        def check_shape(s, p):
            if s["kind"] == "polygon":
                pts = [(q["x"], q["y"]) for q in s["points"]]
                if g.self_intersects(pts):
                    r.error("self_intersection", p, "polygon intersects itself")
                elif g.area(pts) < 1e-6:
                    r.error("degenerate_shape", p, "polygon has zero area")
            if s["kind"] == "path" and s["commands"][0]["cmd"] != "M":
                r.error("path_start", p, "path must start with an M command")

        for k in OBJECT_LISTS:
            for oi, o in enumerate(fl.get(k, [])):
                p = f"{fp}.{k}[{oi}]"
                reg(o["id"], p)
                if o["floorId"] != fl["id"]:
                    r.error("floor_mismatch", f"{p}.floorId", f"'{o['floorId']}' but the object is inside floor "
                                                               f"'{fl['id']}'")
                if o.get("source") == "ai" and "confidence" not in o:
                    r.warn("missing_confidence", p, "objects with source='ai' should carry a confidence")
                elif o.get("confidence") is not None and o["confidence"] < LOW_CONFIDENCE and not o.get("needsReview"):
                    r.warn("low_confidence", p, f"confidence={o['confidence']}; set needsReview or confirm it")
                if "shape" in o:
                    check_shape(o["shape"], f"{p}.shape")
                    in_bounds(g.shape_points(o["shape"]), p)

        # zones
        for oi, z in enumerate(fl.get("zones", [])):
            p = f"{fp}.zones[{oi}]"
            zone_ref(z.get("parentZoneId"), p, "parentZoneId")
            seen, cur = {z["id"]}, z.get("parentZoneId")
            while cur in zones:
                if cur in seen:
                    r.error("zone_cycle", f"{p}.parentZoneId", "parentZoneId forms a cycle")
                    break
                seen.add(cur)
                cur = zones[cur].get("parentZoneId")

        # walls
        walls: dict[str, g.WallGeom] = {}
        for oi, w in enumerate(fl.get("walls", [])):
            p = f"{fp}.walls[{oi}]"
            wg = g.WallGeom(w)
            walls[w["id"]] = wg
            if wg.length < 1e-6:
                r.error("zero_length_wall", p, "wall start and end points are identical")
                continue
            in_bounds(wg.polyline(), p)
            if abs(wg.bulge) > 1:
                r.warn("large_bulge", f"{p}.bulge", "|bulge| > 1 means an arc larger than a semicircle")

        # openings
        per_wall: dict[str, list] = {}
        opening_pts = []
        for oi, o in enumerate(fl.get("openings", [])):
            p = f"{fp}.openings[{oi}]"
            wg = walls.get(o["wallId"])
            if wg is None:
                r.error("missing_ref", f"{p}.wallId", f"'{o['wallId']}' is not a wall on this floor")
                continue
            L = wg.length
            if L < 1e-6:
                continue
            c, half = o["position"] * L, o["width"] / 2
            if o["width"] > L:
                r.error("opening_too_wide", p, f"width {o['width']} > wall length {L:.1f}")
            elif c - half < -1e-6 or c + half > L + 1e-6:
                r.error("opening_overflow", p, f"opening runs past the wall end: [{c - half:.1f}, {c + half:.1f}] "
                                               f"of 0..{L:.1f}")
            for pj, a0, a1 in per_wall.get(o["wallId"], []):
                if c - half < a1 and a0 < c + half:
                    r.error("opening_overlap", p, f"overlaps {pj} on the same wall")
            per_wall.setdefault(o["wallId"], []).append((p, c - half, c + half))
            if o["kind"] == "archway" and (o.get("swing", "none") != "none" or o.get("opensToward", "none") != "none"):
                r.warn("archway_swing", p, "archways have no door leaf; use swing/opensToward 'none'")
            if o["kind"] in ("door", "archway"):
                opening_pts.append((p, wg.point_at(o["position"]), o["width"]))

        # tables
        seats_by_zone: dict[str, int] = {}
        table_polys = []
        for oi, t in enumerate(fl.get("tables", [])):
            p = f"{fp}.tables[{oi}]"
            zone_ref(t.get("zoneId"), p)
            if t["number"] in table_numbers:
                r.error("duplicate_table_number", f"{p}.number", f"'{t['number']}' already used by "
                                                                 f"{table_numbers[t['number']]}")
            else:
                table_numbers[t["number"]] = p
            if (e := t.get("externalTableId")):
                if e in ext_tables:
                    r.error("duplicate_external_id", f"{p}.externalTableId", f"'{e}' already used by {ext_tables[e]}")
                ext_tables.setdefault(e, p)
            for ci, other in enumerate(t.get("combinableWithTableIds", [])):
                if other == t["id"] or other not in all_tables:
                    r.error("missing_ref", f"{p}.combinableWithTableIds[{ci}]", f"'{other}' is not another table")
            for ci, ch in enumerate(t.get("chairs", [])):
                in_bounds([(ch["x"], ch["y"])], f"{p}.chairs[{ci}]")
            pts = g.shape_points(t["shape"])
            z = t.get("zoneId")
            if z in zones:
                seats_by_zone[z] = seats_by_zone.get(z, 0) + t["seats"]
                if not g.point_in_poly(g.bbox_center(pts), zone_polys[z]):
                    r.warn("outside_zone", p, f"table centre is outside zone '{z}'")
            elif z is None and zones:
                r.warn("unzoned_table", p, "table is not assigned to any zone")
            for pj, q in table_polys:
                if g.polys_overlap(pts, q):
                    r.warn("table_overlap", p, f"overlaps {pj}")
            for wid, wg in walls.items():
                if wg.length > 1e-6 and g.poly_polyline_dist(pts, wg.polyline()) < wg.thickness / 2:
                    r.warn("table_wall_overlap", p, f"overlaps wall '{wid}'")
            for op, c, width in opening_pts:
                if g.poly_polyline_dist(pts, [c, c]) < width / 2:
                    r.warn("blocks_opening", p, f"may block {op}")
            table_polys.append((p, pts))
        for zi, z in enumerate(fl.get("zones", [])):
            if "capacity" in z and seats_by_zone.get(z["id"], 0) > z["capacity"]:
                r.warn("over_capacity", f"{fp}.zones[{zi}]",
                       f"table seats total {seats_by_zone[z['id']]} > capacity {z['capacity']}")

        for oi, fx in enumerate(fl.get("fixtures", [])):
            zone_ref(fx.get("zoneId"), f"{fp}.fixtures[{oi}]")

        # climate devices
        for oi, d in enumerate(fl.get("climateDevices", [])):
            p = f"{fp}.climateDevices[{oi}]"
            zone_ref(d.get("zoneId"), p)
            for zi, z in enumerate(d.get("coveredZoneIds", [])):
                zone_ref(z, p, f"coveredZoneIds[{zi}]")
            if "rotationDeg" in d:
                srot = d["shape"].get("rotationDeg")
                if srot is not None and srot != d["rotationDeg"]:
                    r.error("rotation_conflict", p, f"rotationDeg={d['rotationDeg']} differs from "
                                                    f"shape.rotationDeg={srot}")
                else:
                    r.warn("deprecated_field", f"{p}.rotationDeg", "deprecated; use shape.rotationDeg "
                                                                   "(`eateryplan migrate` fixes it)")
            if (e := d.get("externalDeviceId")):
                if e in ext_devices:
                    r.error("duplicate_external_id", f"{p}.externalDeviceId", f"'{e}' already used by {ext_devices[e]}")
                ext_devices.setdefault(e, p)

        # sensors
        for oi, s in enumerate(fl.get("environmentalSensors", [])):
            p = f"{fp}.environmentalSensors[{oi}]"
            zone_ref(s.get("zoneId"), p)
            pos = (s["position"]["x"], s["position"]["y"])
            in_bounds([pos], p)
            if (z := s.get("zoneId")) in zones and not g.point_in_poly(pos, zone_polys[z]):
                r.warn("outside_zone", p, f"sensor position is outside zone '{z}'")
            if (dev := s.get("associatedDeviceId")) and dev not in local["climateDevices"]:
                r.error("missing_ref", f"{p}.associatedDeviceId", f"'{dev}' is not a climate device on this floor")

        # labels
        for oi, lb in enumerate(fl.get("labels", [])):
            p = f"{fp}.labels[{oi}]"
            zone_ref(lb.get("zoneId"), p)
            pts = [(lb["position"]["x"], lb["position"]["y"])]
            if lb["kind"] == "dimension":
                a, b = (lb["a"]["x"], lb["a"]["y"]), (lb["b"]["x"], lb["b"]["y"])
                pts += [a, b]
                if math.dist(a, b) < 1e-6:
                    r.error("zero_length_dimension", p, "dimension a and b are identical")
                elif lb.get("valueMeters") and (scale := cs.get("realWorldScale")):
                    stated = lb["valueMeters"]
                    drawn = math.dist(a, b) * scale["metersPerUnit"]
                    if abs(drawn - stated) / stated > 0.05:
                        r.warn("scale_mismatch", p, f"dimension says {stated} m, scale gives {drawn:.2f} m")
            in_bounds(pts, p)


def validate_plan(plan: dict) -> Report:
    r = Report()
    schema_check(plan, load_schema("eateryplan.schema.json"), r)
    if r.ok:  # semantic checks assume a structurally valid document
        semantic_check(plan, r)
    return r


def _index(plan, key):
    return {o["id"]: o for fl in plan["floors"] for o in fl.get(key, [])}


def check_table_state(plan: dict, state: dict) -> Report:
    r = Report()
    schema_check(state, load_schema("table-state.schema.json"), r)
    if not r.ok:
        return r
    if state["planId"] != plan["planId"]:
        r.error("plan_mismatch", "$.planId", f"'{state['planId']}' != plan '{plan['planId']}'")
    if state.get("planRevision") not in (None, plan["revision"]):
        r.warn("revision_mismatch", "$.planRevision",
               f"state was produced for revision {state['planRevision']}, plan is at {plan['revision']}")
    tables, seen = _index(plan, "tables"), set()
    for i, t in enumerate(state["tables"]):
        p = f"$.tables[{i}]"
        if t["tableId"] in seen:
            r.error("duplicate_id", p, f"'{t['tableId']}' listed twice")
        seen.add(t["tableId"])
        if t["tableId"] not in tables:
            r.error("missing_ref", f"{p}.tableId", f"'{t['tableId']}' is not in the plan")
            continue
        if t.get("guestCount", 0) > tables[t["tableId"]]["seats"]:
            r.warn("over_seats", f"{p}.guestCount", f"{t['guestCount']} guests > {tables[t['tableId']]['seats']} seats")
        for m in t.get("mergedWithTableIds", []):
            if m not in tables:
                r.error("missing_ref", f"{p}.mergedWithTableIds", f"'{m}' is not in the plan")
    return r


def check_telemetry(plan: dict, tel: dict) -> Report:
    r = Report()
    schema_check(tel, load_schema("environment-telemetry.schema.json"), r)
    if not r.ok:
        return r
    if tel["planId"] != plan["planId"]:
        r.error("plan_mismatch", "$.planId", f"'{tel['planId']}' != plan '{plan['planId']}'")
    sensor = _index(plan, "environmentalSensors").get(tel["sensorId"])
    if not sensor:
        r.error("missing_ref", "$.sensorId", f"'{tel['sensorId']}' is not in the plan")
        return r
    allowed = {METRIC_TO_READING[m] for m in sensor["metrics"]}
    for k in tel["readings"]:
        if k not in allowed:
            r.error("unexpected_metric", f"$.readings.{k}", f"sensor does not report this (metrics: "
                                                             f"{', '.join(sensor['metrics'])})")
    return r


def check_detection(det: dict) -> Report:
    r = Report()
    schema_check(det, load_schema("detection.schema.json"), r)
    return r
