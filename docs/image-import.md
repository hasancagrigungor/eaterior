# Converting a drawing into Eaterior

A photo, scan or sketch of a floor plan becomes a plan in two steps:

```
image ──► detection.json (pixels) ──► eaterior import ──► plan.json (floor units, validated)
           any detector                deterministic
```

1. **Detect.** Something reads the image and fills
   [`detection.schema.json`](../schemas/v1.9.0/detection.schema.json) in **image pixel coordinates**. It can be a
   vision-capable language model, a classic computer-vision pipeline, or a person clicking on the image.
2. **Import.** `eaterior import` converts the detection into a plan and validates it. Nothing is saved if the
   result is invalid.

Splitting the steps keeps the uncertain part (reading the drawing) separate from the exact part (geometry), so
the same importer works with any detector and its output is reproducible.

## The detection format

- Every field is required; unknown values are `null`. Objects never allow extra properties.
- No `oneOf`, no numeric or string constraints and no recursion, so the schema can be used directly as a strict
  structured-output schema by model providers that support JSON Schema output. The test suite enforces this.
- Tables, fixtures and devices are boxes: centre, width, height, rotation and a `shape` of `round`, `oval` or `rect`.
- Openings are points: the importer attaches each one to the nearest wall.
- `confidence` (0–1) on every object; `notes[]` for anything ambiguous.

See [`examples/detection.json`](../examples/detection.json) and the plan it produces,
[`examples/imported-plan.json`](../examples/imported-plan.json).

## What the importer does

| Step | Rule |
|---|---|
| Coordinates | pixels × (target width / image width); aspect ratio kept (default width 1000 units) |
| Walls | within 4° of horizontal/vertical → straightened; x or y values closer than 1 % of the image → aligned; free ends near another wall → joined (T-junction); walls shorter than the tolerance → dropped |
| Openings | attached to the nearest wall within reach, centred and clamped to fit, overlapping ones dropped |
| Rooms | become zones; self-intersecting outlines replaced by their convex hull and flagged |
| Room labels | a text label inside an unnamed room becomes that zone's name |
| Tables | zone = smallest zone containing the centre; duplicate or missing numbers renumbered; missing seats estimated (from size when the scale is known) and flagged |
| Scale | only from `scale.pixelsPerMeter` or dimension labels (median); otherwise omitted |
| Review | anything with confidence < 0.6, or changed by the importer, gets `needsReview: true` |
| Provenance | `provenance.method = image_import`, source asset (with SHA-256), tool name, notes |

## Instructions for a detector

If you use a language model as the detector, give it the schema as the required output format and instructions
along these lines:

> You convert floor plan drawings of restaurants, cafes and bars into JSON.
> Use image pixel coordinates, origin at the top-left corner of the image.
> Report only what is drawn. Do not add tables, doors or devices that are not visible.
> Walls: one entry per straight wall segment, centre line, end points where walls meet.
> Openings: the centre point of each door, window or open passage, and its width in pixels.
> Tables: centre, size and rotation of the table top; seats only if chairs or a number are drawn.
> Scale: fill pixelsPerMeter only if a scale bar or a written dimension allows it; otherwise null.
> Copy written dimensions as dimension labels with their two end points.
> Use a lower confidence for anything faint, partly hidden or guessed, and explain it in notes.

Always run the result through `eaterior import` (or `validate`) before saving it, and show objects with
`needsReview` to a person for confirmation.
