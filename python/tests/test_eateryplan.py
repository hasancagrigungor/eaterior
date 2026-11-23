import copy
import json
import unittest
from pathlib import Path

from eateryplan import (check_detection, check_object_state, check_table_state, check_telemetry, detection_to_plan, migrate,
                        validate_plan)
from eateryplan.validate import load_schema

ROOT = Path(__file__).resolve().parents[2]
EX = ROOT / "examples"


def load(name):
    return json.loads((EX / name).read_text(encoding="utf-8"))


PLAN, STATE, TEL, DET = load("plan.json"), load("table-state.json"), load("telemetry.json"), load("detection.json")


def codes(rep, level="error"):
    return {i.code for i in rep.issues if i.level == level}


def mutated(fn):
    p = copy.deepcopy(PLAN)
    fn(p, p["floors"][0])
    return validate_plan(p)


class Examples(unittest.TestCase):
    def test_examples_are_clean(self):
        self.assertEqual(validate_plan(PLAN).issues, [])
        self.assertEqual(check_table_state(PLAN, STATE).issues, [])
        self.assertEqual(check_telemetry(PLAN, TEL).issues, [])
        self.assertEqual(check_detection(DET).issues, [])

    def test_restaurant_example_is_clean(self):
        plan = load("restaurant.json")
        self.assertEqual(validate_plan(plan).issues, [])
        self.assertEqual(check_table_state(plan, load("restaurant-state.json")).issues, [])

    def test_bad_appearance_is_rejected(self):
        plan = load("restaurant.json")
        plan["floors"][0]["zones"][0]["appearance"]["floor"] = "lava"
        self.assertIn("schema", codes(validate_plan(plan)))

    def test_eateryplan_1_0_0_upgrades(self):
        new, _ = migrate(dict(PLAN, schemaVersion="1.0.0"))
        self.assertEqual(new["schemaVersion"], "1.4.0")
        self.assertTrue(validate_plan(new).ok)

    def test_imported_example_is_valid(self):
        self.assertTrue(validate_plan(load("imported-plan.json")).ok)


class PlanErrors(unittest.TestCase):
    cases = {
        "duplicate_id": lambda p, f: f["tables"][1].update(id="table_1"),
        "missing_ref": lambda p, f: f["openings"][0].update(wallId="nope"),
        "floor_mismatch": lambda p, f: f["tables"][0].update(floorId="floor_9"),
        "out_of_bounds": lambda p, f: f["tables"][0]["shape"].update(cx=5000),
        "opening_too_wide": lambda p, f: f["openings"][0].update(width=5000),
        "opening_overflow": lambda p, f: f["openings"][0].update(position=0.99),
        "opening_overlap": lambda p, f: f["openings"].append(dict(f["openings"][0], id="door_2")),
        "duplicate_table_number": lambda p, f: f["tables"][1].update(number="A1"),
        "duplicate_external_id": lambda p, f: f["tables"][1].update(externalTableId="pos-312"),
        "rotation_conflict": lambda p, f: f["climateDevices"][0].update(rotationDeg=90),
        "zero_length_wall": lambda p, f: f["walls"][0].update(b=dict(f["walls"][0]["a"])),
        "self_intersection": lambda p, f: f["zones"][0]["shape"].update(points=[
            {"x": 40, "y": 40}, {"x": 650, "y": 560}, {"x": 650, "y": 40}, {"x": 40, "y": 560}]),
        "zone_cycle": lambda p, f: f["zones"][0].update(parentZoneId="zone_bar"),
        "path_start": lambda p, f: f["fixtures"][1]["shape"]["commands"].insert(0, {"cmd": "L", "x": 1, "y": 1}),
        "datetime": lambda p, f: p.update(createdAt="yesterday"),
        "schema": lambda p, f: p.update(format="cafeplan"),
        "zero_length_dimension": lambda p, f: f["labels"][1].update(b=dict(f["labels"][1]["a"])),
    }

    def test_each_error_is_detected(self):
        for code, fn in self.cases.items():
            with self.subTest(code=code):
                self.assertIn(code, codes(mutated(fn)))

    def test_reference_errors(self):
        for fn in (lambda p, f: f["climateDevices"][0].update(coveredZoneIds=["nope"]),
                   lambda p, f: f["background"].update(assetId="nope"),
                   lambda p, f: p["provenance"].update(sourceAssetId="nope"),
                   lambda p, f: f["tables"][0].update(combinableWithTableIds=["table_1"]),
                   lambda p, f: f["labels"][0].update(zoneId="nope")):
            self.assertIn("missing_ref", codes(mutated(fn)))

    def test_dimension_label_requires_endpoints(self):
        rep = mutated(lambda p, f: f["labels"][1].pop("a"))
        self.assertIn("schema", codes(rep))

    def test_extensions_are_allowed(self):
        rep = mutated(lambda p, f: f["tables"][0].update(extensions={"acme.priceTier": "vip"}))
        self.assertTrue(rep.ok, rep.issues)

    def test_extension_keys_must_be_namespaced(self):
        rep = mutated(lambda p, f: f["tables"][0].update(extensions={"priceTier": "vip"}))
        self.assertIn("schema", codes(rep))


class PlanWarnings(unittest.TestCase):
    cases = {
        "table_overlap": lambda p, f: f["tables"][1]["shape"].update(cx=260, cy=225),
        "outside_zone": lambda p, f: f["tables"][1].update(zoneId="zone_terrace"),
        "unzoned_table": lambda p, f: f["tables"][0].update(zoneId=None),
        "over_capacity": lambda p, f: f["zones"][2].update(capacity=2),
        "archway_swing": lambda p, f: f["openings"][1].update(swing="left"),
        "missing_confidence": lambda p, f: f["tables"][0].update(source="ai"),
        "low_confidence": lambda p, f: f["tables"][0].update(source="ai", confidence=0.3),
        "deprecated_field": lambda p, f: f["climateDevices"][0].update(rotationDeg=0),
        "table_wall_overlap": lambda p, f: f["tables"][1]["shape"].update(cx=480, cy=60),
        "blocks_opening": lambda p, f: f["tables"][1]["shape"].update(cx=345, cy=95),
        "scale_mismatch": lambda p, f: f["labels"][1].update(valueMeters=20),
    }

    def test_each_warning_is_reported_without_errors(self):
        for code, fn in self.cases.items():
            with self.subTest(code=code):
                rep = mutated(fn)
                self.assertIn(code, codes(rep, "warning"))
                self.assertTrue(rep.ok, rep.errors)

    def test_needs_review_silences_low_confidence(self):
        rep = mutated(lambda p, f: f["tables"][0].update(source="ai", confidence=0.3, needsReview=True))
        self.assertNotIn("low_confidence", codes(rep, "warning"))


class StateAndTelemetry(unittest.TestCase):
    def test_unknown_table(self):
        s = copy.deepcopy(STATE); s["tables"][0]["tableId"] = "nope"
        self.assertIn("missing_ref", codes(check_table_state(PLAN, s)))

    def test_bad_status(self):
        s = copy.deepcopy(STATE); s["tables"][0]["status"] = "busy"
        self.assertFalse(check_table_state(PLAN, s).ok)

    def test_too_many_guests(self):
        s = copy.deepcopy(STATE); s["tables"][0]["guestCount"] = 50
        self.assertIn("over_seats", codes(check_table_state(PLAN, s), "warning"))

    def test_unmeasured_metric(self):
        t = copy.deepcopy(TEL); t["readings"]["pm25UgM3"] = 12
        self.assertIn("unexpected_metric", codes(check_telemetry(PLAN, t)))

    def test_unknown_sensor(self):
        t = copy.deepcopy(TEL); t["sensorId"] = "nope"
        self.assertIn("missing_ref", codes(check_telemetry(PLAN, t)))


class ObjectState(unittest.TestCase):
    def setUp(self):
        self.plan = load("restaurant.json")
        self.doc = load("restaurant-objects.json")

    def test_example_is_clean(self):
        self.assertEqual(check_object_state(self.plan, self.doc).issues, [])

    def test_errors(self):
        cases = {
            "missing_ref": {"objectId": "nope", "active": False},
            "not_openable": {"objectId": "table_1", "open": 0.5},
            "no_power": {"objectId": "pergola_1", "power": "off"},
        }
        for code, entry in cases.items():
            with self.subTest(code=code):
                d = copy.deepcopy(self.doc); d["objects"].append(entry)
                self.assertIn(code, codes(check_object_state(self.plan, d)))

    def test_open_out_of_range(self):
        d = copy.deepcopy(self.doc); d["objects"][0]["open"] = 2
        self.assertFalse(check_object_state(self.plan, d).ok)

    def test_plan_active_default(self):
        p = copy.deepcopy(self.plan); p["floors"][0]["zones"][0]["active"] = False
        self.assertTrue(validate_plan(p).ok)


class Migration(unittest.TestCase):
    def legacy(self, version):
        old = copy.deepcopy(PLAN)
        old.update(format="cafeplan", schemaVersion=version)
        for key in ("provenance",):
            old.pop(key, None)
        for f in old["floors"]:
            f.pop("labels", None)
            for t in f["tables"]:
                for k in ("kind", "chairs", "combinableWithTableIds"):
                    t.pop(k, None)
        return old

    def test_cafeplan_1_0_0(self):
        old = self.legacy("1.0.0")
        for f in old["floors"]:
            del f["climateDevices"], f["environmentalSensors"]
        new, _ = migrate(old)
        self.assertEqual((new["format"], new["schemaVersion"]), ("eateryplan", "1.4.0"))
        self.assertEqual(new["revision"], PLAN["revision"] + 1)
        self.assertTrue(validate_plan(new).ok)

    def test_cafeplan_1_1_0_moves_rotation(self):
        old = self.legacy("1.1.0")
        d = old["floors"][0]["climateDevices"][0]
        del d["shape"]["rotationDeg"]; d["rotationDeg"] = 15
        new, _ = migrate(old)
        nd = new["floors"][0]["climateDevices"][0]
        self.assertNotIn("rotationDeg", nd)
        self.assertEqual(nd["shape"]["rotationDeg"], 15)

    def test_unknown_format_is_rejected(self):
        with self.assertRaises(ValueError):
            migrate({"format": "other", "schemaVersion": "9"})


class Import(unittest.TestCase):
    def setUp(self):
        self.plan = detection_to_plan(DET, plan_id="t", name="t", tool="test")
        self.floor = self.plan["floors"][0]

    def test_result_is_valid(self):
        rep = validate_plan(self.plan)
        self.assertTrue(rep.ok, rep.format())

    def test_aspect_ratio_is_kept(self):
        cs = self.floor["coordinateSpace"]
        self.assertAlmostEqual(cs["height"] / cs["width"], 992 / 1600, places=4)

    def test_walls_are_snapped_and_connected(self):
        walls = self.floor["walls"]
        for w in walls:
            self.assertTrue(w["a"]["x"] == w["b"]["x"] or w["a"]["y"] == w["b"]["y"], w)
        ends = [(w[k]["x"], w[k]["y"]) for w in walls[:4] for k in ("a", "b")]
        for p in ends:
            self.assertEqual(ends.count(p), 2, f"outer corner {p} is not shared")

    def test_openings_attach_to_walls(self):
        walls = {w["id"] for w in self.floor["walls"]}
        self.assertEqual(len(self.floor["openings"]), 4)
        self.assertTrue(all(o["wallId"] in walls for o in self.floor["openings"]))

    def test_scale_from_dimension_label(self):
        scale = self.floor["coordinateSpace"]["realWorldScale"]
        self.assertEqual(scale["source"], "dimension_label")
        self.assertAlmostEqual(1000 * scale["metersPerUnit"], 14.8 * 1600 / 1479, delta=0.1)

    def test_no_scale_without_evidence(self):
        det = copy.deepcopy(DET)
        det["labels"] = [lb for lb in det["labels"] if not lb["dimension"]]
        plan = detection_to_plan(det)
        self.assertNotIn("realWorldScale", plan["floors"][0]["coordinateSpace"])
        self.assertTrue(validate_plan(plan).ok)

    def test_tables(self):
        tables = self.floor["tables"]
        numbers = [t["number"] for t in tables]
        self.assertEqual(len(numbers), len(set(numbers)))
        zone_ids = {z["id"] for z in self.floor["zones"]}
        self.assertTrue(all(t["zoneId"] in zone_ids for t in tables))
        estimated = [t for t in tables if t["number"] == "4"][0]
        self.assertTrue(estimated["needsReview"])

    def test_room_label_names_zone(self):
        names = {z["name"] for z in self.floor["zones"]}
        self.assertTrue({"Dining", "Kitchen", "WC"} <= names)
        self.assertFalse(any(lb["text"] in names for lb in self.floor["labels"]))

    def test_low_confidence_needs_review(self):
        wc = [z for z in self.floor["zones"] if z["name"] == "WC"][0]
        self.assertTrue(wc["needsReview"])


class DetectionSchemaIsStrictFriendly(unittest.TestCase):
    """detection.schema.json must stay usable as a strict structured-output schema."""

    def test_rules(self):
        schema = load_schema("detection.schema.json")
        banned = {"oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength",
                  "pattern", "minItems", "maxItems", "uniqueItems", "propertyNames", "if", "then", "not"}

        def walk(node, path="$"):
            if isinstance(node, dict):
                self.assertFalse(banned & set(node), f"{path} uses {banned & set(node)}")
                if node.get("type") == "object":
                    self.assertIs(node.get("additionalProperties"), False, path)
                    self.assertEqual(set(node.get("required", [])), set(node.get("properties", {})), path)
                for k, v in node.items():
                    if k != "properties":
                        walk(v, f"{path}.{k}")
                    else:
                        for pk, pv in v.items():
                            walk(pv, f"{path}.{pk}")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, f"{path}[{i}]")
        walk(schema)


if __name__ == "__main__":
    unittest.main()


class PackagedSchemas(unittest.TestCase):
    def test_packaged_schemas_match_canonical(self):
        canon = ROOT / "schemas" / "v1.4.0"
        packaged = ROOT / "python" / "eateryplan" / "schemas"
        names = sorted(p.name for p in canon.glob("*.json"))
        self.assertEqual(names, sorted(p.name for p in packaged.glob("*.json")))
        for n in names:
            self.assertEqual((canon / n).read_bytes(), (packaged / n).read_bytes(), n)
