# Changelog

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
