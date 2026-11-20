# Rendering contract

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
