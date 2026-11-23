import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildScene, toSvg, shapeToPath, WallGeom } from "../src/eaterior-render.mjs";

const load = (n) => JSON.parse(readFileSync(new URL(`../../examples/${n}`, import.meta.url), "utf8"));
const plan = load("plan.json");
const state = load("table-state.json");
const tel = load("telemetry.json");

test("scene has no invalid numbers", () => {
  for (const p of [plan, load("imported-plan.json")]) {
    const svg = toSvg(buildScene(p));
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
  }
});

test("viewBox keeps the floor aspect ratio", () => {
  const sc = buildScene(plan);
  assert.equal(sc.viewBox, "0 0 1000 620");
});

test("layers are ordered", () => {
  const { items } = buildScene(plan);
  const order = ["background", "zones", "fixtures", "walls", "openings", "tables", "chairs", "climate", "sensors", "labels", "review"];
  const idx = items.map((i) => order.indexOf(i.layer));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
});

test("table state colours tables", () => {
  const sc = buildScene(plan, { tableStates: state });
  const t1 = sc.items.find((i) => i.layer === "tables" && i.type === "path" && i.ref.id === "table_1");
  assert.equal(t1.status, "occupied");
  assert.equal(t1.fill, "#FECACA");
});

test("auto chairs follow seat count", () => {
  const sc = buildScene(plan);
  const chairs = sc.items.filter((i) => i.layer === "chairs" && i.ref.id === "table_1");
  assert.equal(chairs.length, 6);
});

test("readings are shown next to sensors", () => {
  const sc = buildScene(plan, { readings: { [tel.sensorId]: tel } });
  assert.ok(sc.items.some((i) => i.type === "text" && i.text.includes("23.4°C")));
});

test("openings cut the wall", () => {
  const sc = buildScene(plan);
  const north = sc.items.filter((i) => i.layer === "walls" && i.ref.id === "wall_n");
  assert.equal(north.length, 2);
  assert.ok(sc.items.some((i) => i.layer === "openings" && i.ref.id === "door_main" && i.d.includes("A")));
});

test("curved wall is drawn as an arc", () => {
  const sc = buildScene(plan);
  const w = sc.items.find((i) => i.ref?.id === "wall_bar_curve");
  assert.match(w.d, /A/);
});

test("rotation is baked into shape paths", () => {
  const d = shapeToPath({ kind: "rect", x: 0, y: 0, width: 10, height: 10, rotationDeg: 90 });
  assert.equal(d, "M10 0 L10 10 L0 10 L0 0 Z");
});

test("bulge 1 is a semicircle bulging to the right", () => {
  const g = new WallGeom({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 5, bulge: 1 });
  assert.ok(Math.abs(g.length - Math.PI * 50) < 1e-9);
  const mid = g.pointAt(0.5);
  assert.ok(Math.abs(mid[0] - 50) < 1e-9 && Math.abs(mid[1] - 50) < 1e-9);
});

test("hidden objects are skipped", () => {
  const p = structuredClone(plan);
  p.floors[0].tables[0].visible = false;
  assert.ok(!buildScene(p).items.some((i) => i.ref?.id === "table_1"));
});

test("needsReview objects get a highlight", () => {
  const sc = buildScene(load("imported-plan.json"));
  assert.ok(sc.items.some((i) => i.layer === "review"));
});

test("render CLI writes an SVG", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync: rf } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const out = join(mkdtempSync(join(tmpdir(), "ep-")), "plan.svg");
  const cli = fileURLToPath(new URL("../bin/render.mjs", import.meta.url));
  const plan = fileURLToPath(new URL("../../examples/plan.json", import.meta.url));
  execFileSync(process.execPath, [cli, plan, out]);
  assert.match(rf(out, "utf8"), /^<svg /);
});
