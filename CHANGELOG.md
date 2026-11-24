# Changelog

## 1.10.0 — 2026-11-24

- **Product catalogs.** A new document type, `eaterior-catalog` (`schemas/v1.10.0/catalog.schema.json`). In it,
  manufacturers and dealers list products with real size, kind, appearance, HVAC performance, variants and assets
  (thumbnail, top view, 3D model, datasheet, CAD). Anyone can publish a catalog; clients choose which to load.
- Tables, fixtures and climate devices may carry a `product` reference (catalog, item, variant, version, brand,
  name, SKU, URL, sponsored). Plans stay complete without the catalog.
- **Venue details.** An optional `venue` block on the plan: name, legal name, brand and branch, logo, address,
  WGS 84 position with north bearing, time zone, currency, contact and social links, venue type, cuisine,
  capacity, area, opening hours and external ids. Validator codes: `logo_not_image`, `empty_hours`, `over_capacity`.
- Python: `eaterior check-catalog` / `check_catalog()`.
- JS: `catalogItemToObject()`, which places a catalog item as an object, and the `resolveProductImage` scene
  option, which draws product top views in both themes.
- Docs: [docs/catalog.md](docs/catalog.md). Example: `examples/catalog.json`. All 1.x documents stay valid.

## 1.9.0 — 2026-11-24

- HVAC: new climate device kinds `ecology_unit` (kitchen exhaust ecology unit), `air_handling_unit`, `heat_recovery_unit`,
  `fan_coil`, `air_curtain`; optional `performance` block on every device (airflow, fresh/exhaust air, cooling/heating
  capacity, electrical power, supply temperature, external static pressure, sound level, COP/EER, heat recovery
  efficiency, filter class, refrigerant, duct size).
- Floors: `appearance.tileSizeCm` and `appearance.plankWidthCm` (real tile / plank sizes) and new finishes
  `tile_hexagon`, `tile_subway`, `epoxy`.
- Illustrated renderer draws the new devices (and outdoor units) and uses the real tile / plank sizes; the plain
  theme labels them ECO, AHU, HRV, FCU, AC-C.
- All 1.x documents stay valid. Example restaurant gains device performance values and a kitchen ecology unit;
  the component gallery shows the new floors.

## JS 1.8.1 — 2026-11-24

- Illustrated renderer, 3D walls: a wall that ends on the body of another wall (T junction) now stops at that wall's
  face instead of extending through it, and its end cap is not drawn. Wall faces are painted far-to-near so the
  nearer wall covers the one behind it. No format change.

## 1.8.0 — 2026-11-23

- **Renamed to Eaterior** (formerly Eatery Plan). Format identifier `eaterior`; live documents use
  `eaterior-table-state`, `eaterior-object-state` and `eaterior-telemetry`.
- The old identifiers (`eateryplan`, `eateryplan-*`) remain valid when reading; the validator warns with
  `legacy_format` and `eaterior migrate` rewrites plans to `eaterior` 1.8.0.
- Packages: `pip install eaterior` (CLI `eaterior`), `npm install eaterior` (CLI `eaterior-render`).
- Schemas move to `schemas/v1.8.0/eaterior.schema.json`; earlier versions are unchanged.

## 1.7.0 — 2026-11-23

- Integration: `externalRefs` (`[{system, id, type?}]`) on the plan, floors and every object; unique per plan.
- Live documents may address objects by `externalRef`; optional `source`. Validator resolves them (`missing_ref`,
  `ref_conflict`, `duplicate_external_ref`).
- Object state: `power` also for appliance fixtures; new `level` (0–1).
- Live effects: heaters glow, stoves show flames, ovens glow, coffee machines steam, screens light, ACs blow; doors and
  windows follow `open`. `toSvg(…, { animate: true })` animates them with CSS; items carry `data-effect`.
- New docs: integration guide. Demo: power/level controls, animation toggle, external links shown.

## 1.6.0 — 2026-11-23

- Rugs: 12 styles via `appearance.style` (persian, kilim, moroccan, striped, geometric, shag, jute, floral, bordered,
  abstract, chevron, braided), round/oval or rectangular/square, fringes on woven rugs, motifs clipped to the rug and
  rotated with it.
- Gallery and restaurant examples include rugs; README images rendered at full size.

## 1.5.0 — 2026-11-23

- Parquet: `wood_wide_planks`, `wood_chevron`, `wood_basketweave`.
- `appearance.style` for tables (classic, modern, rustic, industrial, bistro, scandinavian), sofas/armchairs (classic,
  modern, chesterfield, scandinavian) and parasols (classic, striped, scalloped, solid, cantilever).
- Seat kinds: `stool_backrest`, `bistro`, `cafe`, `tub`, `lounge`, `pouf`. Fixture kinds: `corner_sofa`, `lounge_chair`,
  `pouf`, `bench`. Square and rectangular parasols from a rect shape.
- Auto-placed seats use real sizes when the floor has a scale.
- Zone name chips fit inside their zone.
- New example: `examples/showcase.json` component gallery; restaurant uses the new styles.

- Example: back-of-house extract duct through storage, staff, office and kitchen, rising into the kitchen hood.
- Illustrated theme: ventilation ducts are more visible (less transparent, darker outline and seams, soft shadow).

## 1.4.0 — 2026-11-23

- Components: optional `active` default on every plan object; new object-state document (`object-state.schema.json`)
  with live `active`, `open` (0–1) and `power` per object; `eaterior check-objects`.
- Renderers: passive objects faded and hatched; louvered pergolas open/close, fabric roofs retract, folding/sliding glass
  panels stack when open; heaters and ACs show power state.
- `groupByObject(scene)` for rendering each object as a component without changing draw order; React Native example
  renders one pressable group per object.
- Demo: click any object to toggle active, drag open/closed, switch power.

## 1.3.0 — 2026-11-23

- Pergola roof types via `appearance.roof`: `slatted`, `louvered` (aluminium bioclimatic), `glass`, `fabric`, `solid`;
  material `aluminium`.
- Glass balcony walls: wall kinds `glass_folding` and `glass_sliding`, optional `panelWidthMeters`; usable with or
  without a pergola.
- Illustrated theme: framed pergolas with bays, posts and louvers; glass panels with profiles (flat and 3D); table badges
  on their own layer above canopies.

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
- Illustrated theme (`js/src/eaterior-illustrated.mjs`): floor textures, furniture symbols, shadows and live-status
  badges, all generated in code; `render.mjs --style illustrated`.
- SVG output supports `defs` (patterns, gradients).
- New example: `examples/restaurant.json` with live state.

## 1.0.1 — 2026-11-20

Tooling only; the document format stays at 1.0.0.

- `js/bin/render.mjs`: render a plan to SVG or HTML from the command line.
- The Python package ships its schemas, so `pip install` from GitHub works without cloning.

## 1.0.0 — 2026-11-20

First public release as **Eaterior** (previously developed privately as CafePlan 1.0.0 – 1.1.1).

- Plan schema: floors, zones, walls (straight and curved via `bulge`), openings, tables, fixtures,
  climate devices, environmental sensors, labels and dimension lines.
- Shapes: `rect`, `ellipse`, `polygon`, `path` (M, L, Q, C, A, Z), rotation on every shape with defined pivots.
- Tables: `kind`, explicit `chairs`, `combinableWithTableIds`, `externalTableId`.
- `provenance`, `needsReview`, namespaced `extensions` on every object.
- Separate schemas for live table state and environment telemetry.
- Detection schema for converting drawings, compatible with strict structured-output schemas.
- Python reference validator (schema + semantic checks), importer and migrator for CafePlan 1.x files.
- Dependency-free JS renderer with SVG output, React Native example and a browser demo.
