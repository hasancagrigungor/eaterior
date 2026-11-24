"""Command line interface: `eaterior <command> ...` or `python -m eaterior ...`."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import validate as v
from .importer import detection_to_plan
from .migrate import migrate


def _load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write(path, doc):
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _emit(rep: v.Report, as_json: bool) -> int:
    print(json.dumps(rep.as_dict(), ensure_ascii=False, indent=2) if as_json else rep.format())
    return 0 if rep.ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="eaterior", description="Eaterior tools")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("validate", help="validate a plan (schema + semantics)")
    p.add_argument("plan"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("check-state", help="validate live table state against a plan")
    p.add_argument("plan"); p.add_argument("state"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("check-telemetry", help="validate a sensor reading against a plan")
    p.add_argument("plan"); p.add_argument("telemetry"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("check-catalog", help="validate a product catalog (eaterior-catalog)")
    p.add_argument("catalog"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("check-objects", help="validate live component state (active, open, power) against a plan")
    p.add_argument("plan"); p.add_argument("objects"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("migrate", help="upgrade an older or legacy CafePlan 1.x file")
    p.add_argument("src"); p.add_argument("dst")
    p = sub.add_parser("import", help="convert an image detection (pixels) into a plan")
    p.add_argument("detection"); p.add_argument("dst")
    p.add_argument("--image", help="source image; stored as background asset")
    p.add_argument("--plan-id", default="plan_1"); p.add_argument("--name", default="Imported plan")
    p.add_argument("--width", type=float, default=1000.0, help="floor width in units (default 1000)")
    p.add_argument("--source", choices=["ai", "import", "manual"], default="ai")
    p.add_argument("--tool", help="name/version of the detector, recorded in provenance")
    p.add_argument("--locale")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "migrate":
        out, notes = migrate(_load(a.src))
        rep = v.validate_plan(out)
        if not rep.ok:
            print(rep.format()); print("Upgraded plan is invalid; nothing written.")
            return 1
        _write(a.dst, out)
        print("\n".join(notes)); print(f"written: {a.dst}")
        return 0

    if a.cmd == "import":
        det = _load(a.detection)
        rep = v.check_detection(det)
        if not rep.ok:
            return _emit(rep, a.json)
        plan = detection_to_plan(det, plan_id=a.plan_id, name=a.name, target_width=a.width,
                                 image_path=a.image, source=a.source, tool=a.tool, locale=a.locale)
        rep = v.validate_plan(plan)
        if rep.ok:
            _write(a.dst, plan)
        code = _emit(rep, a.json)
        if not a.json:
            for n in plan.get("provenance", {}).get("notes", []):
                print(f"note: {n}")
            print(f"written: {a.dst}" if rep.ok else "Imported plan is invalid; nothing written.")
        return code

    if a.cmd == "check-catalog":
        return _emit(v.check_catalog(_load(a.catalog)), a.json)

    plan = _load(a.plan)
    if a.cmd == "validate":
        return _emit(v.validate_plan(plan), a.json)
    pre = v.validate_plan(plan)
    if not pre.ok:
        print(pre.format()); print("The plan itself is invalid; fix it first.")
        return 1
    if a.cmd == "check-state":
        return _emit(v.check_table_state(plan, _load(a.state)), a.json)
    if a.cmd == "check-objects":
        return _emit(v.check_object_state(plan, _load(a.objects)), a.json)
    return _emit(v.check_telemetry(plan, _load(a.telemetry)), a.json)


if __name__ == "__main__":
    sys.exit(main())
