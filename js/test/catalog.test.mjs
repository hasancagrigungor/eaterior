import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildScene, toSvg, catalogItemToObject } from "../src/eaterior-render.mjs";
import { buildIllustratedScene } from "../src/eaterior-illustrated.mjs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const catalog = load("../../examples/catalog.json");
const plan = load("../../examples/restaurant.json");
const floor = plan.floors[0];
const mpu = floor.coordinateSpace.realWorldScale?.metersPerUnit || 0.02;

function withProducts() {
  const p = structuredClone(plan);
  const f = p.floors[0];
  const items = Object.fromEntries(catalog.items.map((i) => [i.id, i]));
  const t = catalogItemToObject(items["bistro-round-70"], { id: "cat_t", floorId: f.id, at: [100, 100], metersPerUnit: mpu, catalog: catalog.id, catalogVersion: catalog.version, number: "99" });
  const fx = catalogItemToObject(items["lounge-sofa-3"], { id: "cat_fx", floorId: f.id, at: [200, 100], metersPerUnit: mpu, catalog: catalog.id });
  const dv = catalogItemToObject(items["eco-3600"], { id: "cat_dv", floorId: f.id, at: [300, 100], metersPerUnit: mpu, catalog: catalog.id });
  (f.tables ||= []).push(t); (f.fixtures ||= []).push(fx); (f.climateDevices ||= []).push(dv);
  return { p, t, fx, dv, items };
}

test("catalogItemToObject builds sized objects with a product reference", () => {
  const { t, fx, dv, items } = withProducts();
  const tpl = items["bistro-round-70"].template;
  assert.equal(t.product.catalog, catalog.id);
  assert.equal(t.product.item, "bistro-round-70");
  assert.equal(t.number, "99");
  if (tpl.shape === "ellipse") assert.ok(Math.abs(t.shape.rx * 2 * mpu - tpl.widthM) < 1e-9);
  else assert.ok(Math.abs(t.shape.width * mpu - tpl.widthM) < 1e-9);
  assert.equal(fx.product.sponsored, true);
  assert.equal(dv.kind, "ecology_unit");
  assert.ok(dv.performance);
});

test("variants override size and name", () => {
  const item = catalog.items.find((i) => i.variants?.length);
  const v = item.variants.find((x) => x.widthM) || item.variants[0];
  const o = catalogItemToObject(item, { id: "v", floorId: "f", at: [0, 0], metersPerUnit: 0.01, variant: v.id, catalog: catalog.id });
  assert.equal(o.product.variant, v.id);
  assert.ok(o.product.name.includes(v.name));
  if (v.widthM) {
    const w = o.shape.kind === "rect" ? o.shape.width : o.shape.rx * 2;
    assert.ok(Math.abs(w * 0.01 - v.widthM) < 1e-9);
  }
});

test("resolveProductImage draws the product image in both themes", () => {
  const { p } = withProducts();
  const resolveProductImage = (o) => (o.product ? `https://cdn.example.com/${o.product.item}.png` : null);
  for (const build of [buildScene, buildIllustratedScene]) {
    const sc = build(p, { resolveProductImage });
    const imgs = sc.items.filter((i) => i.type === "image" && i.href.startsWith("https://cdn.example.com/"));
    assert.equal(imgs.length, 3, build.name);
    assert.deepEqual(new Set(imgs.map((i) => i.ref.id)), new Set(["cat_t", "cat_fx", "cat_dv"]));
    const svg = toSvg(sc);
    assert.ok(!/NaN|undefined/.test(svg));
    assert.ok(svg.includes('data-ref-id="cat_fx"'));
  }
  // without a resolver nothing changes
  assert.equal(buildIllustratedScene(p).items.filter((i) => i.type === "image" && i.href.includes("cdn.example")).length, 0);
});

test("illustrated theme replaces the generic fixture symbol with the image", () => {
  const { p } = withProducts();
  const n = (sc) => sc.items.filter((i) => i.ref?.id === "cat_fx").length;
  const plain = buildIllustratedScene(p), img = buildIllustratedScene(p, { resolveProductImage: () => "x.png" });
  assert.ok(n(plain) > 1);
  assert.equal(n(img), 1);
});
