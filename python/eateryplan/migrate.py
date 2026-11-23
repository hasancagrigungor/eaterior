"""Upgrade older documents (Eatery Plan 1.0.0, legacy CafePlan 1.x) to the current version. Geometry is never changed."""
from __future__ import annotations

import copy
from datetime import datetime, timezone

from .validate import SCHEMA_VERSION

LEGACY = {("cafeplan", "1.0.0"), ("cafeplan", "1.1.0"), ("cafeplan", "1.1.1"), ("eateryplan", "1.0.0"), ("eateryplan", "1.1.0"), ("eateryplan", "1.1.1"), ("eateryplan", "1.2.0")}


def migrate(doc: dict) -> tuple[dict, list[str]]:
    p, notes = copy.deepcopy(doc), []
    key = (p.get("format"), p.get("schemaVersion"))
    if key == ("eateryplan", SCHEMA_VERSION):
        return p, [f"already Eatery Plan {SCHEMA_VERSION}"]
    if key not in LEGACY:
        raise ValueError(f"unsupported document: format={key[0]!r} schemaVersion={key[1]!r}")
    for fl in p.get("floors", []):
        for k in ("climateDevices", "environmentalSensors"):
            if k not in fl:
                fl[k] = []
                notes.append(f"{fl['id']}: added empty {k}")
        for d in fl["climateDevices"]:
            if "rotationDeg" in d:
                rot = d.pop("rotationDeg")
                if rot and "rotationDeg" not in d["shape"]:
                    d["shape"]["rotationDeg"] = rot
                notes.append(f"{d['id']}: moved rotationDeg into shape")
    p["format"] = "eateryplan"
    p["schemaVersion"] = SCHEMA_VERSION
    p["revision"] = int(p.get("revision", 0)) + 1
    p["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    notes.append(f"{key[0]} {key[1]} -> eateryplan {SCHEMA_VERSION}, revision -> {p['revision']}")
    return p, notes
