import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toSvg } from "../src/eaterior-render.mjs";
import { buildIllustratedScene, ILLUSTRATED_LAYERS } from "../src/eaterior-illustrated.mjs";

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
  const occupied = state.tables.find((t) => t.status === "occupied" && t.tableId).tableId;
  assert.ok(sc.items.some((i) => i.ref?.id === occupied && i.fill === "#F87171"));
});

test("booth tables get benches instead of chairs", () => {
  const sc = buildIllustratedScene(restaurant);
  const booth = restaurant.floors[0].tables.find((t) => t.chairStyle?.kind === "booth");
  const seats = sc.items.filter((i) => i.layer === "chairs" && i.ref.id === booth.id && i.fill !== "#1B2430");
  assert.ok(seats.length >= 2);
});

test("every fixture kind in the schema draws something", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/v1.8.0/eaterior.schema.json", import.meta.url), "utf8"));
  const kinds = schema.$defs.fixture.properties.kind.enum;
  const plan = structuredClone(restaurant);
  plan.floors[0].fixtures = kinds.map((k, i) => ({ id: `fx_${i}`, floorId: "floor_0", kind: k,
    shape: { kind: "rect", x: 300 + (i % 10) * 60, y: 250 + Math.floor(i / 10) * 60, width: 40, height: 30 } }));
  const sc = buildIllustratedScene(plan);
  for (let i = 0; i < kinds.length; i++) assert.ok(sc.items.some((it) => it.ref?.id === `fx_${i}`), kinds[i]);
});

test("walls have visible faces and tops in 3D, and stay flat when walls3d is off", () => {
  const wallId = restaurant.floors[0].walls[0].id;
  const items3d = buildIllustratedScene(restaurant).items.filter((i) => i.layer === "walls" && i.ref?.id === wallId);
  const flat = buildIllustratedScene(restaurant, { walls3d: false }).items.filter((i) => i.layer === "walls" && i.ref?.id === wallId);
  assert.ok(items3d.some((i) => i.fill !== "none" && /Z$/.test(i.d)), "top/face polygons");
  assert.ok(flat.every((i) => i.fill === "none"), "flat walls are strokes");
});

test("wall height changes the depth", () => {
  const tall = structuredClone(restaurant), low = structuredClone(restaurant);
  tall.floors[0].walls[0].heightMeters = 4; low.floors[0].walls[0].heightMeters = 0.5;
  const top = (p) => buildIllustratedScene(p).items.filter((i) => i.ref?.id === "w_north" && i.fill === "#FFFFFF")[0].d;
  assert.notEqual(top(tall), top(low));
});

test("every climate device kind draws something", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/v1.8.0/eaterior.schema.json", import.meta.url), "utf8"));
  const kinds = schema.$defs.climateDevice.properties.kind.enum;
  const plan = structuredClone(restaurant);
  plan.floors[0].climateDevices = kinds.map((k, i) => ({ id: `cd_${i}`, floorId: "floor_0", kind: k,
    shape: { kind: "rect", x: 300 + (i % 8) * 70, y: 250 + Math.floor(i / 8) * 60, width: 40, height: 30 } }));
  const sc = buildIllustratedScene(plan);
  for (let i = 0; i < kinds.length; i++) assert.ok(sc.items.some((it) => it.ref?.id === `cd_${i}`), kinds[i]);
  assert.ok(!/NaN/.test(toSvg(sc)));
});

test("radial gradients and glow are defined", () => {
  const sc = buildIllustratedScene(restaurant);
  assert.ok(sc.defs.some((d) => d.type === "radialGradient" && d.id === "ep-glow"));
  assert.match(toSvg(sc), /<radialGradient /);
});

test("pergola roof types and glass walls draw in 3D and flat modes", () => {
  for (const roof of ["slatted", "louvered", "glass", "fabric", "solid"]) {
    const plan = structuredClone(restaurant);
    plan.floors[0].fixtures.find((x) => x.kind === "pergola").appearance = { material: "aluminium", roof };
    for (const walls3d of [true, false]) {
      const sc = buildIllustratedScene(plan, { walls3d });
      const svg = toSvg(sc);
      assert.ok(!/NaN|undefined/.test(svg), roof);
      assert.ok(sc.items.some((i) => i.layer === "canopy"), roof);
      assert.ok(sc.items.some((i) => i.ref?.id === "w_glass_w"), `glass wall ${walls3d}`);
    }
  }
});

test("table badges stay above the pergola", () => {
  const { items } = buildIllustratedScene(restaurant);
  const badge = items.findIndex((i) => i.layer === "badges");
  const canopy = items.findLastIndex((i) => i.layer === "canopy");
  assert.ok(badge > canopy);
});

test("component states: open louvers, open glass, power off, inactive", async () => {
  const { groupByObject } = await import("../src/eaterior-render.mjs");
  const objs = load("restaurant-objects.json");
  const closed = buildIllustratedScene(restaurant);
  const live = buildIllustratedScene(restaurant, { objectStates: objs });
  const count = (sc, id, pred = () => true) => sc.items.filter((i) => i.ref?.id === id && pred(i)).length;
  // power off removes the heater glow
  assert.ok(count(closed, "heater_1", (i) => i.fill === "url(#ep-glow)") === 1);
  assert.ok(count(live, "heater_1", (i) => i.fill === "url(#ep-glow)") === 0);
  // inactive table is faded and gets an overlay
  assert.ok(live.items.filter((i) => i.ref?.id === "table_20" && i.ref.type === "table").every((i) => (i.opacity ?? 1) <= 0.3));
  assert.ok(live.items.some((i) => i.ref?.type === "inactive" && i.ref.id === "table_20"));
  // open pergola louvers are drawn thinner, so the pergola path data changes
  const pd = (sc) => sc.items.filter((i) => i.ref?.id === "pergola_1").map((i) => i.d).join("");
  assert.notEqual(pd(closed), pd(live));
  // a fully open glass wall keeps only the stacked panels
  assert.ok(count(live, "w_glass_n") < count(closed, "w_glass_n"));
  // each object can be rendered as its own component
  const groups = groupByObject(live);
  assert.ok(groups.some((g) => g.ref?.id === "pergola_1" && g.items.length > 5));
  assert.deepEqual(groups.flatMap((g) => g.items), live.items);
});

test("plain theme fades inactive objects too", async () => {
  const { buildScene } = await import("../src/eaterior-render.mjs");
  const sc = buildScene(restaurant, { objectStates: { objects: [{ objectId: "table_1", active: false }] } });
  assert.ok(sc.items.filter((i) => i.ref?.id === "table_1" && i.ref.type === "table").every((i) => (i.opacity ?? 1) <= 0.3));
});

test("gallery: every floor, table style, seat kind and parasol variant renders", () => {
  const gallery = load("showcase.json");
  const schema = JSON.parse(readFileSync(new URL("../../schemas/v1.8.0/eaterior.schema.json", import.meta.url), "utf8"));
  const sc = buildIllustratedScene(gallery);
  assert.ok(!/NaN|undefined/.test(toSvg(sc)));
  const floors = new Set(gallery.floors[0].zones.map((z) => z.appearance?.floor));
  for (const fl of schema.$defs.appearance.properties.floor.enum) assert.ok(floors.has(fl), `gallery misses floor ${fl}`);
  for (const z of gallery.floors[0].zones) assert.ok(sc.defs.some((d) => d.id === `ep-floor-${z.id}` && d.items.length > 0), z.id);
  const seatKinds = schema.$defs.chairStyle.properties.kind.enum.filter((k) => !["booth"].includes(k));
  const used = new Set(gallery.floors[0].tables.map((t) => t.chairStyle.kind));
  for (const k of seatKinds) if (!used.has(k)) {
    const plan = structuredClone(gallery);
    plan.floors[0].tables[0].chairStyle = { kind: k, color: "#777777" };
    assert.ok(!/NaN/.test(toSvg(buildIllustratedScene(plan))), k);
  }
  assert.ok(gallery.floors[0].fixtures.some((f) => f.kind === "parasol" && f.shape.kind === "rect"));
});

test("seats use real sizes when the floor has a scale", () => {
  const gallery = load("showcase.json");
  const mpu = gallery.floors[0].coordinateSpace.realWorldScale.metersPerUnit;
  const t = gallery.floors[0].tables.find((x) => x.chairStyle.kind === "chair");
  const small = structuredClone(gallery), big = structuredClone(gallery);
  big.floors[0].tables.find((x) => x.id === t.id).shape = { ...t.shape, width: t.shape.width * 2, height: t.shape.height * 2 };
  const seatPaths = (p) => buildIllustratedScene(p).items.filter((i) => i.layer === "chairs" && i.ref.id === t.id).length;
  assert.equal(seatPaths(small), seatPaths(big));
  assert.ok(mpu > 0);
});

test("every rug style renders, round and rectangular, with patterns kept inside the rug", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/v1.8.0/eaterior.schema.json", import.meta.url), "utf8"));
  const RUGS = ["persian", "kilim", "moroccan", "striped", "geometric", "shag", "jute", "floral", "bordered", "abstract", "chevron", "braided"];
  for (const r of RUGS) assert.ok(schema.$defs.appearance.properties.style.enum.includes(r), r);
  const plan = structuredClone(load("showcase.json"));
  plan.floors[0].fixtures = RUGS.flatMap((style, i) => [
    { id: `rr_${i}`, floorId: "floor_0", kind: "rug", appearance: { style }, shape: { kind: "rect", x: 40 + (i % 6) * 150, y: 300, width: 120, height: 80, rotationDeg: 15 } },
    { id: `rc_${i}`, floorId: "floor_0", kind: "rug", appearance: { style }, shape: { kind: "ellipse", cx: 100 + (i % 6) * 150, cy: 500, rx: 50, ry: 40 } }]);
  const sc = buildIllustratedScene(plan);
  assert.ok(!/NaN|undefined/.test(toSvg(sc)));
  for (const f of plan.floors[0].fixtures) assert.ok(sc.items.filter((i) => i.ref?.id === f.id).length >= 2, f.id);
  const rugPatterns = sc.defs.filter((d) => d.id.startsWith("ep-rug-rr_0"));
  assert.ok(rugPatterns.every((d) => d.rotation === 15), "rug patterns rotate with the rug");
});

test("live effects: appliances default off, power on lights them; external ids resolve; animation is opt-in", async () => {
  const { stateMap } = await import("../src/eaterior-render.mjs");
  const objs = load("restaurant-objects.json");
  const flames = (sc) => sc.items.filter((i) => i.ref?.id === "stove_1" && i.effect === "flicker").length;
  assert.equal(flames(buildIllustratedScene(restaurant)), 0, "stoves are off by default");
  const live = buildIllustratedScene(restaurant, { objectStates: objs });
  assert.ok(flames(live) > 0, "stove lit via its kitchen:stove-1 external id");
  // heater_1 is switched off through bms:heater-1
  assert.ok(!live.items.some((i) => i.ref?.id === "heater_1" && i.fill === "url(#ep-glow)"));
  const m = stateMap(objs, "objectId", restaurant);
  assert.equal(m.get("stove_1").power, "on");
  // table state addressed by POS id
  const st = stateMap(state, "tableId", restaurant);
  assert.equal(st.size, state.tables.length);
  assert.ok(!/class="ep-fx/.test(toSvg(live)));
  assert.match(toSvg(live, { animate: true }), /class="ep-fx-flicker"/);
});

test("door leaf follows the open state", () => {
  const leaf = (sc) => sc.items.filter((i) => i.ref?.id === "door_1").map((i) => i.d).join("");
  const a = buildIllustratedScene(restaurant, { objectStates: { objects: [{ objectId: "door_1", open: 0.2 }] } });
  const b = buildIllustratedScene(restaurant, { objectStates: { objects: [{ objectId: "door_1", open: 0.9 }] } });
  assert.notEqual(leaf(a), leaf(b));
});
