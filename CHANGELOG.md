# Changelog

## 1.2.0 — 2026-11-23

- New fixture kinds: `pergola`, `palm_tree`. New climate device kinds: `ceiling_cassette`, `ventilation_duct`,
  `patio_heater`, `wall_heater`. The detection schema accepts every plan kind.
- Illustrated theme, more realistic: soft two-layer shadows, gradient lighting on materials, wood grain, detailed
  chairs, plates with cutlery, richer plants, stainless kitchen equipment, bevelled tiles, ambient occlusion at wall
  bases; canopy layer for pergolas and palms; drawings for all new kinds.
- SVG output supports radial gradients.

## 1.1.1 — 2026-11-23

- Optional `wall.heightMeters` (backwards compatible).
- Illustrated theme: walls with 3D depth (visible wall faces, jambs, windows on the face), computed from a camera above
  the floor centre; options `walls3d`, `camera`, `wallDepth`. The data stays 2D.

## 1.1.0 — 2026-11-23

Format 1.1.0 (backwards compatible: every 1.0.0 document is valid).

- `appearance` on zones, walls, openings, tables, fixtures, climate devices and labels: floor finish, material,
  main and accent colour, tablecloth, table setting.
- `chairStyle` on tables: chair, armchair, stool, bench or booth, with colour and material.
- New fixture kinds for restaurants: prep counter, armchair, bar stool, planter, tree, parasol, rug, hand sink, oven,
  freezer, dishwasher, coffee machine, display case, wine rack, shelf, host stand, TV, piano, urinal.
- Illustrated theme (`js/src/eateryplan-illustrated.mjs`): floor textures, furniture symbols, shadows and live-status
  badges, all generated in code; `render.mjs --style illustrated`.
- SVG output supports `defs` (patterns, gradients).
- New example: `examples/restaurant.json` with live state.

## 1.0.1 — 2026-11-20

Tooling only; the document format stays at 1.0.0.

- `js/bin/render.mjs`: render a plan to SVG or HTML from the command line.
- The Python package ships its schemas, so `pip install` from GitHub works without cloning.

## 1.0.0 — 2026-11-20

First public release as **Eatery Plan** (previously developed privately as CafePlan 1.0.0 – 1.1.1).

- Plan schema: floors, zones, walls (straight and curved via `bulge`), openings, tables, fixtures,
  climate devices, environmental sensors, labels and dimension lines.
- Shapes: `rect`, `ellipse`, `polygon`, `path` (M, L, Q, C, A, Z), rotation on every shape with defined pivots.
- Tables: `kind`, explicit `chairs`, `combinableWithTableIds`, `externalTableId`.
- `provenance`, `needsReview`, namespaced `extensions` on every object.
- Separate schemas for live table state and environment telemetry.
- Detection schema for converting drawings, compatible with strict structured-output schemas.
- Python reference validator (schema + semantic checks), importer and migrator for CafePlan 1.x files.
- Dependency-free JS renderer with SVG output, React Native example and a browser demo.
