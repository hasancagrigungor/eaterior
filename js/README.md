# eateryplan (UI library)

Render **[Eatery Plan](https://github.com/hasancagrigungor/eatery-plan)** floor plans — restaurants, cafes and bars —
on the web, in React Native or on a Canvas. Everything is drawn in code from the plan JSON; no images needed.

![Garden Bistro](https://raw.githubusercontent.com/hasancagrigungor/eatery-plan/main/docs/images/restaurant-illustrated.png)

```bash
npm install eateryplan
```

Zero dependencies. ES modules, TypeScript types included.

## Web

```js
import { toSvg } from "eateryplan";
import { buildIllustratedScene } from "eateryplan/illustrated";

const scene = buildIllustratedScene(plan, { tableStates, objectStates, readings });
document.querySelector("#plan").innerHTML = toSvg(scene, { animate: true });
```

`buildScene()` from `eateryplan` gives the plain architectural theme instead.

## React Native

The scene is a list of SVG path strings, so `react-native-svg` draws it directly. A complete component (patterns,
gradients, one pressable group per object) is in
[`examples/react-native/EateryPlanView.tsx`](https://github.com/hasancagrigungor/eatery-plan/blob/main/examples/react-native/EateryPlanView.tsx).

```tsx
<Svg viewBox={scene.viewBox} preserveAspectRatio="xMidYMid meet">
  {groupByObject(scene).map((g, i) => (
    <G key={i} onPress={() => g.ref && onSelect(g.ref)}>
      {g.items.map((it, j) => it.type === "path" ? <Path key={j} d={it.d} fill={it.fill} stroke={it.stroke} /> : null)}
    </G>
  ))}
</Svg>
```

## Canvas

```js
for (const it of scene.items) if (it.type === "path") { ctx.fillStyle = it.fill; ctx.fill(new Path2D(it.d)); }
```

## Options

| Option | Meaning |
|---|---|
| `tableStates` | table-state document: tables coloured by status (by plan id or POS id) |
| `objectStates` | object-state document: active/passive, `open` for pergolas, glass walls, doors and windows, `power`/`level` for heaters, stoves, ovens, ACs … |
| `readings` | sensor readings shown next to sensors |
| `walls3d`, `camera`, `wallDepth` | 3D wall effect (illustrated theme) |
| `floorId`, `theme`, `showChairs`, `showZoneNames`, `highlightReview` | display options |

`toSvg(scene, { animate: true })` animates live effects (heater glow, flames, airflow) with CSS; every effect item has
`effect` / `data-effect` so native apps can animate it themselves.

## Command line

```bash
npx eateryplan-render plan.json plan.html --style illustrated --state table-state.json
```

## Related

- JSON Schemas, specification and examples: [GitHub](https://github.com/hasancagrigungor/eatery-plan)
- Validator and importer for Python: [`eateryplan` on PyPI](https://pypi.org/project/eateryplan/)

MIT licensed.
