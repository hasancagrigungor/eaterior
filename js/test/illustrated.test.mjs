import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toSvg } from "../src/eateryplan-render.mjs";
import { buildIllustratedScene, ILLUSTRATED_LAYERS } from "../src/eateryplan-illustrated.mjs";

const load = (n) => JSON.parse(readFileSync(new URL(`../../examples/${n}`, import.meta.url), "utf8"));
const restaurant = load("restaurant.json");
const state = load("restaurant-state.json");

test("every example renders without invalid numbers", () => {
  for (const n of ["restaurant.json", "plan.json", "imported-plan.json"]) {
    const svg = toSvg(buildIllustratedScene(load(n), { tableStates: n === "restaurant.json" ? state : null }));
    assert.ok(!/NaN|undefined|Infinity/.test(svg), n);
  }
});

test("every url(#id) fill has a definition", () => {
  const sc = buildIllustratedScene(restaurant);
  const ids = new Set(sc.defs.map((d) => d.id));
  for (const it of sc.items) {
    const m = /^url\(#(.+)\)$/.exec(it.fill || "");
    if (m) assert.ok(ids.has(m[1]), m[1]);
  }
});

test("one floor texture per zone, following appearance", () => {
  const sc = buildIllustratedScene(restaurant);
  const floors = sc.defs.filter((d) => d.id.startsWith("ep-floor-"));
  assert.equal(floors.length, restaurant.floors[0].zones.length);
});

test("layers are ordered", () => {
  const { items } = buildIllustratedScene(restaurant);
  const idx = items.map((i) => ILLUSTRATED_LAYERS.indexOf(i.layer));
  assert.ok(idx.every((i) => i >= 0));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
});

test("live status colours the table badge", () => {
  const sc = buildIllustratedScene(restaurant, { tableStates: state });
  const occupied = state.tables.find((t) => t.status === "occupied").tableId;
  assert.ok(sc.items.some((i) => i.ref?.id === occupied && i.fill === "#F87171"));
});

test("booth tables get benches instead of chairs", () => {
  const sc = buildIllustratedScene(restaurant);
  const booth = restaurant.floors[0].tables.find((t) => t.chairStyle?.kind === "booth");
  const seats = sc.items.filter((i) => i.layer === "chairs" && i.ref.id === booth.id && i.fill !== "#1B2430");
  assert.ok(seats.length >= 2 && seats.length <= 4);
});

test("every fixture kind in the schema draws something", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/v1.1.0/eateryplan.schema.json", import.meta.url), "utf8"));
  const kinds = schema.$defs.fixture.properties.kind.enum;
  const plan = structuredClone(restaurant);
  plan.floors[0].fixtures = kinds.map((k, i) => ({ id: `fx_${i}`, floorId: "floor_0", kind: k,
    shape: { kind: "rect", x: 300 + (i % 10) * 60, y: 250 + Math.floor(i / 10) * 60, width: 40, height: 30 } }));
  const sc = buildIllustratedScene(plan);
  for (let i = 0; i < kinds.length; i++) assert.ok(sc.items.some((it) => it.ref?.id === `fx_${i}`), kinds[i]);
});
