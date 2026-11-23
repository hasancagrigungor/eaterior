# Eatery Plan 1.2.0 — Specification

Eatery Plan describes the **physical layout** of restaurants, cafes, bars and similar venues as JSON, so one
plan can be drawn identically on iOS, Android, desktop and the web. The normative definition is
[`schemas/v1.1.0/eateryplan.schema.json`](../schemas/v1.1.0/eateryplan.schema.json) (JSON Schema Draft 2020-12)
plus the semantic rules in this document.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. Scope

| In the plan | Outside the plan (separate documents / APIs) |
|---|---|
| Floors, zones, walls, doors, windows | Orders, bills, reservations |
| Tables, chairs, furniture, equipment | Live table status → [`table-state`](../schemas/v1.1.0/table-state.schema.json) |
| HVAC equipment and sensor *positions* | Sensor readings → [`environment-telemetry`](../schemas/v1.1.0/environment-telemetry.schema.json) |
| Labels and dimension lines | Device control (setpoints, on/off) |

Live data changes every second; the plan changes when the room changes. Keeping them apart means a plan is never
rewritten because a table was seated or the temperature moved.

## 2. Document structure

```
plan
├── format: "eateryplan", schemaVersion: "1.2.0" (all 1.x versions still valid), planId, name, revision
├── provenance?          how the plan was made (manual, image_import, text_prompt, cad_import)
├── assets[]?            images/PDFs referenced by the plan (e.g. the original drawing)
├── extensions?          namespaced application data
└── floors[]
    ├── id, name, level, coordinateSpace, background?
    ├── zones[]               dining room, terrace, kitchen, restroom …
    ├── walls[]               straight or curved segments
    ├── openings[]            doors, windows, archways — attached to a wall
    ├── tables[]              shape, number, seats, kind, optional chairs
    ├── fixtures[]            counters, sofas, stairs, columns, equipment
    ├── climateDevices[]      AC units, vents, hoods, heaters, thermostats …
    ├── environmentalSensors[] temperature / humidity / CO₂ … sensors
    └── labels[]?             free text and dimension lines
```

`revision` MUST be incremented on every saved change. Clients use it to detect stale live data.

## 3. Coordinate system

| Rule | Value |
|---|---|
| Unit | Abstract floor unit, independent of screen pixels |
| Origin | Top-left `(0, 0)` |
| Axes | x to the right, y downwards |
| Size | `coordinateSpace.width` × `height`, per floor |
| Aspect ratio | MUST match the real room. A 16:9 drawing is e.g. `1000 × 562.5`, not `1000 × 1000` |
| Precision | Decimals allowed |
| Angles | Degrees, clockwise positive (as seen on screen) |
| Real size | Optional `realWorldScale.metersPerUnit`, only when known |

Renderers scale the floor to the screen with a uniform factor (SVG `viewBox` + `preserveAspectRatio="xMidYMid meet"`).

`realWorldScale` MUST NOT be invented. Set it only from a measurement, a dimension written on the drawing, or
user input, and record which in `realWorldScale.source`.

## 4. Shapes

| kind | Fields | Rotation pivot |
|---|---|---|
| `rect` | `x, y, width, height, cornerRadius?` | rectangle centre |
| `ellipse` | `cx, cy, rx, ry` (circle: `rx = ry`) | `(cx, cy)` |
| `polygon` | `points[]` (≥ 3) | centre of the points' bounding box |
| `path` | `commands[]` (`M L Q C A Z`, SVG semantics), `closed?` | centre of the bounding box of all coordinates written in the commands (end and control points) |

Every shape MAY have `rotationDeg`. Polygons MUST NOT intersect themselves. Paths MUST start with `M`.

## 5. Objects

Common optional fields on every object: `name`, `visible`, `locked`, `zIndex`, `source` (`manual | ai | import`),
`confidence` (0–1), `needsReview`, `style`, `extensions`.

| Object | Required | Notes |
|---|---|---|
| Zone | `id, floorId, name, kind, shape` | `capacity`, `parentZoneId` (no cycles) |
| Wall | `id, floorId, a, b, thickness, kind` | `bulge` for curved walls (see below) |
| Opening | `id, floorId, wallId, kind, position, width` | `swing`, `opensToward`, `hinge` |
| Table | `id, floorId, number, shape, seats` | `zoneId`, `kind`, `chairs[]`, `combinableWithTableIds[]`, `externalTableId` |
| Fixture | `id, floorId, kind, shape` | `zoneId` |
| Climate device | `id, floorId, kind, shape` | `mount`, `coveredZoneIds[]`, `capabilities[]`, `airflowDirectionDeg`, `externalDeviceId` |
| Sensor | `id, floorId, position, metrics[]` | `mount`, `heightMeters`, `associatedDeviceId`, `externalSensorId` |
| Label | `id, floorId, kind, position, text` | `dimension` labels also need `a`, `b`, optional `valueMeters` |

### Appearance (1.1.0)

Objects MAY carry an `appearance` object that describes **what they look like, not how to draw them**. Renderers
map it to textures, symbols and shading; the same plan can be shown in a plain or an illustrated theme.

| Field | Used on | Values |
|---|---|---|
| `floor` | zones | `wood_planks`, `wood_herringbone`, `tile_checker`, `tile_square`, `marble`, `terrazzo`, `concrete`, `carpet`, `terrace_deck`, `grass`, `stone` |
| `material` | tables, fixtures, devices | `wood`, `wood_light`, `wood_dark`, `marble`, `metal`, `glass`, `fabric`, `leather`, `plastic`, `stone`, `concrete` |
| `color`, `accentColor` | all | `#RRGGBB` — main and secondary colour (e.g. the two colours of a checker floor) |
| `tablecloth` | tables | `#RRGGBB` |
| `tableSetting` | tables | `none`, `plates`, `plates_glasses` |

Tables MAY also have `chairStyle`: `kind` (`chair`, `armchair`, `stool`, `bench`, `booth`), `color`, `material`.
`booth` and `bench` replace individual chairs with seating along the long sides.

Everything is optional. Without `appearance`, renderers choose defaults from `kind` (e.g. kitchens get a tiled floor).
`style` (raw fill/stroke) remains available as a low-level override.

Fixture kinds cover a restaurant: counters (`counter`, `bar_counter`, `prep_counter`), seating (`sofa`, `chair`,
`armchair`, `bar_stool`), kitchen equipment (`stove`, `oven`, `fridge`, `freezer`, `dishwasher`, `sink`,
`hand_sink`, `coffee_machine`), front of house (`display_case`, `wine_rack`, `shelf`, `host_stand`, `pos_terminal`,
`tv`, `piano`), restrooms (`toilet`, `urinal`), outdoor and decor (`plant`, `planter`, `tree`, `palm_tree`, `parasol`, `pergola`, `rug`), and
building elements (`stairs`, `elevator`, `column`). A fixture with a polygon or path shape (e.g. a curved bar) is drawn
with its real outline.

Climate devices (1.2.0) add `ceiling_cassette` (ceiling-recessed AC), `ventilation_duct` (a duct run: long rect,
polygon or path), `patio_heater` and `wall_heater`. An `air_conditioner` with `mount: "ceiling"` is also drawn as a
cassette.

### Walls and openings

- A wall runs from `a` to `b` with `thickness` centred on that line. Optional `heightMeters` (1.1.1) is its physical
  height; renderers may use it for depth effects.
- `bulge` makes the wall a circular arc: `bulge = tan(sweep / 4)` (same as DXF). `0` is straight, `1` a semicircle;
  positive values bulge to the **right** of `a → b` as seen on screen.
- `opening.position` is the centre of the opening along the wall, `0` at `a`, `1` at `b` (arc length on curved walls).
  The opening MUST fit inside the wall and MUST NOT overlap another opening on the same wall.
- `opensToward: "inside"` means the right-hand side of `a → b`; `"outside"` the left-hand side.
- `hinge: "start"` puts the hinge on the end of the opening nearer to `a`.

### Tables

- `number` is what staff see and MUST be unique in the plan. `externalTableId` links to a POS record and MUST be
  unique too.
- If `chairs` is omitted, clients MAY place chairs automatically from `seats`.

## 6. Semantic rules

JSON Schema cannot express these; [`python/eateryplan`](../python) implements them. A plan MUST pass them before
it is stored.

**Errors**: duplicate ids (plan-wide), `floorId` different from the containing floor, references to missing
walls/zones/devices/assets/tables, zone parent cycles, objects outside the floor (1 % tolerance), zero-length walls
or dimensions, openings wider than or overflowing their wall, overlapping openings, self-intersecting or zero-area
polygons, paths not starting with `M`, duplicate table numbers or external ids, conflicting climate device
rotations, invalid RFC 3339 date-times.

**Warnings**: overlapping tables, tables overlapping walls, tables blocking a door, tables outside their zone or
without a zone, seats above zone capacity, archways with door swings, `source: "ai"` without `confidence`,
low confidence without `needsReview`, dimension labels disagreeing with the scale, deprecated fields.

## 7. Live data

- **Table state** (`format: "eateryplan-table-state"`): one entry per table with `status`
  (`available | occupied | reserved | blocked | cleaning | unknown`) and optional guest count, order and reservation
  references. Colours are defined by the client theme, never in the data.
- **Telemetry** (`format: "eateryplan-telemetry"`): one reading per sensor and timestamp, in fixed units
  (`temperatureC`, `relativeHumidityPct`, `co2Ppm`, `pm25UgM3`, `pm10UgM3`, `vocPpb`, `pressureHpa`, `noiseDbA`,
  `occupancyCount`, `illuminanceLux`). Readings MUST only contain metrics the sensor declares.

`externalTableId`, `externalDeviceId` and `externalSensorId` are lookup keys, never credentials.

## 8. Extensibility and versioning

- Every object has `extensions`, a map whose keys MUST be namespaced (`vendor.field`, e.g. `acme.priceTier`).
  Clients MUST ignore unknown keys and SHOULD preserve them when saving.
- **Patch** (1.0.x): descriptions, new optional fields only.
- **Minor** (1.x.0): new object lists or enum values; documents are upgraded by `eateryplan migrate`.
- **Major** (x.0.0): removals or changed meaning.
- Legacy CafePlan 1.0.0 – 1.1.1 files are converted with `eateryplan migrate`.
