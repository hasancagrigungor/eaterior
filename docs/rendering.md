# Rendering contract

Two themes ship with the reference renderer; both read the same plan:

| Theme | Function | Look |
|---|---|---|
| plain | `buildScene()` | clean architectural plan, light zone colours, status-coloured tables |
| illustrated | `buildIllustratedScene()` | colourful top-down illustration: floor textures, furniture symbols, shadows |

Everything in both themes is generated in code from the plan; no image files are used.

Any client may draw a plan its own way, but plans should look the same everywhere. These rules are what
[`js/src/eateryplan-render.mjs`](../js/src/eateryplan-render.mjs) implements; follow them when you write another
renderer (Swift, Kotlin, Flutter, Canvas …).

## Viewport

- Draw each floor in its own coordinate space: `viewBox = 0 0 width height`.
- Scale uniformly to fit (`xMidYMid meet`). Never stretch x and y differently.
- Pan/zoom is a client concern; the data has no camera.

## Layer order

Draw bottom to top; inside a layer sort by `zIndex` (default 0), then by array order. Skip `visible: false`.

1. background image (`floor.background`, positioned by `transform`, with `opacity`)
2. zones (fill by `kind` from the theme, thin outline) and their names
3. fixtures
4. walls, with gaps cut for openings
5. openings (window line, door leaf + swing arc)
6. tables (fill = live status colour, or the neutral table colour) and table numbers
7. chairs
8. climate devices (dashed outline, short code such as `AC`, optional airflow arrow)
9. sensors (dot, optional live reading text)
10. labels and dimension lines
11. review highlight (dashed amber outline around `needsReview` objects)

## Geometry

- **Rotation** is applied around the pivot defined in the specification (§ 4). Bake it into coordinates or use a
  rotate transform around that pivot — the result is the same.
- **Walls** are stroked along the `a → b` centre line with width `thickness`. Straight walls are extended by
  `thickness / 2` at their free ends so corners close. Curved walls (`bulge ≠ 0`) are circular arcs:
  `sweep = 4·atan(bulge)`, `radius = chord / (2·sin(|sweep| / 2))`, bulging to the right of `a → b` for positive values.
- **Openings** remove the wall between `position·L ± width/2` (L = wall length, arc length if curved).
  - window: thin line in the gap, theme window colour
  - door: leaf of length `width` drawn open at 90° from the hinge, towards `opensToward`, plus a dashed quarter arc
    back to the other jamb; `double` = two half leaves; `sliding` = a line parallel to the wall; `none` = gap only
  - archway: gap only
- **Auto chairs** (when `chairs` is absent): evenly around ellipses; around rectangles, shared between the four sides
  in proportion to side length.
- **Dimension labels**: a line from `a` to `b` with end ticks, text at `position`, rotated to the line and kept upright.

## Theme

Colours are not part of the data (except optional per-object `style` overrides). The client theme maps:

| Key | Purpose |
|---|---|
| `zone[kind]` | zone fill per zone kind |
| `wall[kind]` | wall colour per wall kind |
| `status[status]` | table fill per live status |
| `review` | highlight for `needsReview` objects |

Provide a dark-mode theme in the client; the plan does not change.

## Interaction

Every drawn element should keep a reference `{type, id}` back to the plan object so taps/clicks can open the
table, zone or device. The reference renderer emits `ref` on every display-list item and `data-ref-type` /
`data-ref-id` attributes in SVG.

## Illustrated theme

- **Floors** are SVG patterns generated from `appearance.floor`, `color` and `accentColor`, sized in real metres when
  `realWorldScale` is known (planks ≈ 0.2 × 1.4 m, tiles 0.3 m). A soft diagonal sheen is laid over each zone.
- **Walls** are white with a light outline; windows are cyan strips in the wall gap; doors show a leaf and a dashed swing.
- **Furniture** is drawn per `kind` in the object's local frame (+y is the front), so rotation works for every symbol.
  Every piece casts a small offset shadow.
- **Tables** draw seats from `chairStyle` (chairs face the table), place settings from `tableSetting`, and a numbered
  badge. With live state, the badge and an outline take the status colour.
- **Defs**: the scene has `defs` (patterns, gradients) referenced as `fill: "url(#id)"`. SVG and react-native-svg
  support them directly; a Canvas renderer can build them with `createPattern` / `createLinearGradient`.

### Walls with depth

By default the illustrated theme gives walls a 3D look while the data stays 2D. A camera is assumed above the floor
centre (`camera` option); each wall's top is shifted away from it in proportion to the wall height
(`heightMeters`, default 2.8 m, `half_height` 1.1 m) and its distance from the camera, and the wall face pointing
towards the camera is drawn as a shaded quad between the floor line and the shifted top. Door openings show their
jambs; windows are drawn on the visible face. The shift is capped relative to the wall thickness so faces never hide
furniture in the room. Hit-testing and validation always use the 2D floor geometry. Options: `walls3d: false` for flat
walls, `wallDepth` to scale the effect.
