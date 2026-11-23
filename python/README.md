# eateryplan

Validator, migrator and image-detection importer for **[Eatery Plan](https://github.com/hasancagrigungor/eatery-plan)**,
an open JSON format for restaurant, cafe and bar floor plans: zones, walls, doors, tables, furniture, HVAC equipment and
sensors, plus live table and device state for a digital twin of the venue.

![Garden Bistro](https://raw.githubusercontent.com/hasancagrigungor/eatery-plan/main/docs/images/restaurant-illustrated.png)

## Install

```bash
pip install eateryplan
```

The JSON Schemas ship inside the package. The canonical copies, the specification and examples live on
[GitHub](https://github.com/hasancagrigungor/eatery-plan).

## Command line

```bash
eateryplan validate plan.json                    # schema + references + geometry
eateryplan validate plan.json --json             # machine-readable issues
eateryplan check-state plan.json table-state.json
eateryplan check-objects plan.json object-state.json
eateryplan check-telemetry plan.json telemetry.json
eateryplan import detection.json plan.json --image drawing.png --name "My cafe"
eateryplan migrate old.json new.json             # older Eatery Plan or legacy CafePlan files
```

Exit code `0` = valid (warnings allowed), `1` = errors.

## Library

```python
import json
from eateryplan import validate_plan, check_object_state, detection_to_plan

plan = json.load(open("plan.json"))
report = validate_plan(plan)
if not report.ok:
    for issue in report.errors:
        print(issue.code, issue.path, issue.message)
```

| Function | Checks |
|---|---|
| `validate_plan(plan)` | JSON Schema, unique ids, references, floor bounds, wall openings, polygon validity, table overlaps … |
| `check_table_state(plan, state)` | live table status, by plan id or external id |
| `check_object_state(plan, state)` | active / open / power / level of any object, by plan id or external id |
| `check_telemetry(plan, reading)` | sensor readings match the sensor's metrics |
| `detection_to_plan(detection)` | pixel detection of a drawing → plan (snapping, wall attachment, scale from dimensions) |
| `migrate(doc)` | upgrade older documents |

## Links

- [Specification](https://github.com/hasancagrigungor/eatery-plan/blob/main/docs/specification.md)
- [Integration with POS, reservations, kitchen, BMS and IoT systems](https://github.com/hasancagrigungor/eatery-plan/blob/main/docs/integration.md)
- [Converting drawings](https://github.com/hasancagrigungor/eatery-plan/blob/main/docs/image-import.md)
- UI library for web and React Native: [`eateryplan` on npm](https://www.npmjs.com/package/eateryplan)

MIT licensed.
