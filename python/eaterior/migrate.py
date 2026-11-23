"""Upgrade older documents (Eaterior / Eatery Plan 1.x, legacy CafePlan 1.x) to the current version. Geometry is never changed."""
from __future__ import annotations

import copy
from datetime import datetime, timezone

from .validate import SCHEMA_VERSION

_V = ("1.0.0", "1.1.0", "1.1.1", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
# "eateryplan" is the pre-1.8 name of this format; "cafeplan" the name before that.
LEGACY = ({("cafeplan", v) for v in ("1.0.0", "1.1.0", "1.1.1")} | {("eateryplan", v) for v in _V + ("1.8.0",)}
          | {("eaterior", v) for v in _V})


def migrate(doc: dict) -> tuple[dict, list[str]]:
    p, notes = copy.deepcopy(doc), []
    key = (p.get("format"), p.get("schemaVersion"))
    if key == ("eaterior", SCHEMA_VERSION):
        return p, [f"already Eaterior {SCHEMA_VERSION}"]
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
    p["format"] = "eaterior"
    p["schemaVersion"] = SCHEMA_VERSION
    p["revision"] = int(p.get("revision", 0)) + 1
    p["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    notes.append(f"{key[0]} {key[1]} -> eaterior {SCHEMA_VERSION}, revision -> {p['revision']}")
    return p, notes
