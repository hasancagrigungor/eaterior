# Integrating Eaterior with other systems

Eaterior is meant to sit between a venue's physical layout and the systems that run it: POS / order management,
reservations, kitchen equipment, building management (HVAC, lighting), IoT sensors and analytics. The plan stays the
single description of *where things are*; every other system keeps its own data and talks to the plan through ids.
Together with the live documents this gives a **digital twin** of the venue.

```
   POS / orders ──► table-state ─┐
   reservations ──► table-state ─┤
   BMS / HVAC ─────► object-state ┼──►  plan + live state  ──► renderer (web, mobile, desktop)
   kitchen ────────► object-state ┤                        ──► analytics, automation
   IoT sensors ────► telemetry ───┘
```

## 1. Link plan objects to external records

Every object (and the plan and each floor) can carry `externalRefs`, a list of records in other systems:

```json
{
  "id": "table_5",
  "number": "A1",
  "externalRefs": [
    { "system": "pos", "id": "T-A1", "type": "table" },
    { "system": "reservations", "id": "4711" }
  ]
}
```

- `system` is a lower-case name you choose per integration (`pos`, `bms`, `kitchen`, `reservations`, a product name …).
- Each `(system, id)` pair must be unique in the plan; the validator reports `duplicate_external_ref`.
- One object can be linked to any number of systems; a system that is not linked simply ignores the object.
- The older single fields `externalTableId`, `externalDeviceId` and `externalSensorId` still work; prefer `externalRefs`.

Typical links: tables and zones ↔ POS tables and areas, tables ↔ reservation tables, climate devices ↔ BMS points,
appliances ↔ kitchen equipment, sensors ↔ IoT devices.

## 2. Send live state with your own ids

Live documents never change the plan. Each entry may identify its object by plan id **or** by an external reference, so
an external system can publish state without knowing plan ids:

```json
{
  "format": "eaterior-table-state", "schemaVersion": "1.8.0", "planId": "restaurant_001",
  "source": "pos", "generatedAt": "2026-11-23T19:30:00Z",
  "tables": [
    { "externalRef": { "system": "pos", "id": "T-A1" }, "status": "occupied", "guestCount": 2, "orderId": "ord-88213",
      "updatedAt": "2026-11-23T19:25:00Z" }
  ]
}
```

```json
{
  "format": "eaterior-object-state", "schemaVersion": "1.8.0", "planId": "restaurant_001",
  "source": "bms", "generatedAt": "2026-11-23T20:00:00Z",
  "objects": [
    { "externalRef": { "system": "bms", "id": "heater-3" }, "power": "on", "level": 0.8 },
    { "externalRef": { "system": "kitchen", "id": "stove-1" }, "power": "on", "level": 0.85 },
    { "objectId": "door_1", "open": 0.6 }
  ]
}
```

| Document | Fields | Typical producer |
|---|---|---|
| `table-state` | `status`, `guestCount`, `orderId`, `reservationId`, `mergedWithTableIds` | POS, reservations |
| `object-state` | `active`, `open` (0–1), `power`, `level` (0–1), `mode` | BMS, kitchen, staff app |
| `environment-telemetry` | sensor readings in fixed units | IoT platform |

`eaterior check-state` and `check-objects` resolve external references and report unknown ones (`missing_ref`) or an
id and a reference that point to different objects (`ref_conflict`).

## 3. Rendering live state

```js
import { toSvg } from "eaterior-render";
import { buildIllustratedScene } from "eaterior-render/illustrated";

const scene = buildIllustratedScene(plan, { tableStates, objectStates, readings });
element.innerHTML = toSvg(scene, { animate: true });
```

- Tables are coloured by status; passive objects are faded and hatched.
- Heaters glow, stoves show flames, ovens glow, coffee machines steam, screens light up when `power: "on"`; `level` scales
  the effect. Appliances (stove, oven, coffee machine, dishwasher, TV) are off unless a state says otherwise.
- Doors, windows, pergolas and glass walls follow `open`.
- `toSvg(…, { animate: true })` animates effects with CSS (respecting `prefers-reduced-motion`); every effect item also
  carries `data-effect` so native apps can animate it their own way.
- `groupByObject(scene)` gives one component per object for tap handling and enabled/disabled styling.

## 4. Recommendations

- Keep plan ids stable; renumbering tables is a change of `number`, not of `id`.
- Bump `revision` on every plan change and send `planRevision` with live documents; clients reload the plan on mismatch.
- Put integration-specific data in `extensions` with a namespace (`acme.priceTier`), never in new top-level fields.
- Validate every document at the boundary (`eaterior validate`, `check-state`, `check-objects`, `check-telemetry`).
- External ids are lookup keys, never credentials.
