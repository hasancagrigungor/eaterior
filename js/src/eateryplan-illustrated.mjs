/**
 * Eatery Plan "illustrated" theme: a colourful, flat top-down drawing produced entirely in code.
 *
 * The plan only says what things are (`kind`, `appearance.floor`, `appearance.material`, colours, `chairStyle`).
 * This module decides how they look: floor textures, furniture symbols, shadows and highlights.
 *
 * Output is the same display list as buildScene(), plus `defs` (patterns and gradients) referenced by
 * `fill: "url(#id)"`. toSvg() renders it; react-native-svg supports the same Defs/Pattern/LinearGradient.
 */
import { shapeToPath, shapeCenter, WallGeom, autoChairs, circlePath, f, rot, asMap, formatReadings }
  from "./eateryplan-render.mjs";

export const ILLUSTRATED_LAYERS = ["background", "shadow", "zones", "fixtures", "walls", "openings", "chairs",
  "tables", "climate", "sensors", "labels", "review"];

export const ILLUSTRATED_THEME = {
  background: "#8FD3E6",
  buildingShadow: "#000000",
  wall: "#FFFFFF",
  wallEdge: "#B9D3DD",
  wallFace: "#E4ECF1",
  window: "#7FE3F2",
  door: "#2B3A4A",
  shadow: "#1B2430",
  badge: { fill: "#FFFFFF", stroke: "#2B3A4A", text: "#1F2328" },
  zoneText: "#1F2328",
  review: "#F59E0B",
  status: {
    available: "#34D399", occupied: "#F87171", reserved: "#FBBF24",
    blocked: "#9CA3AF", cleaning: "#60A5FA", unknown: "#E5E7EB",
  },
  floors: {
    dining: { floor: "wood_planks", color: "#B5733F" },
    bar: { floor: "wood_herringbone", color: "#8E4B2A" },
    kitchen: { floor: "tile_checker", color: "#D9534F", accentColor: "#F7F3EE" },
    restroom: { floor: "tile_square", color: "#A68BD6" },
    corridor: { floor: "tile_square", color: "#D8D2C8" },
    entrance: { floor: "marble", color: "#ECE6DC" },
    terrace: { floor: "terrace_deck", color: "#C9A27A" },
    outdoor: { floor: "grass", color: "#7FB069" },
    storage: { floor: "concrete", color: "#B8B5AE" },
    staff: { floor: "concrete", color: "#C9C3B8" },
    other: { floor: "wood_planks", color: "#C49A6C" },
  },
  materials: {
    wood: "#C8915A", wood_light: "#E2BE8C", wood_dark: "#7A4A2A", marble: "#EEEBE5", metal: "#B9C0C6",
    glass: "#CFEFF5", fabric: "#C0504D", leather: "#7B3F2A", plastic: "#F2F2F2", stone: "#A9A39A", concrete: "#BDBAB3",
  },
  chair: "#6E8B3D",
};

// ------------------------------------------------------------------ colour helpers
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
export function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * t));
}
const lighten = (c, t) => mix(c, "#FFFFFF", t);
const darken = (c, t) => mix(c, "#000000", t);

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ------------------------------------------------------------------ local drawing frame
/** Unrotated box of a shape: centre, width, height, rotation, round. */
function boxOf(s) {
  if (s.kind === "rect") return { cx: s.x + s.width / 2, cy: s.y + s.height / 2, w: s.width, h: s.height, rot: s.rotationDeg || 0 };
  if (s.kind === "ellipse") return { cx: s.cx, cy: s.cy, w: 2 * s.rx, h: 2 * s.ry, rot: s.rotationDeg || 0, round: true };
  const pts = s.kind === "polygon" ? s.points.map((p) => [p.x, p.y])
    : s.commands.filter((c) => "x" in c).map((c) => [c.x, c.y]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [cx, cy] = shapeCenter(s);
  return { cx, cy, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rot: s.rotationDeg || 0, free: true };
}

/** Painter in a box's local frame: origin at the centre, +y towards the "front", rotation baked in. */
function painter(box, dx = 0, dy = 0) {
  const c = [box.cx + dx, box.cy + dy], deg = box.rot || 0;
  const P = (x, y) => { const q = rot([c[0] + x, c[1] + y], deg, c); return `${f(q[0])} ${f(q[1])}`; };
  return {
    rect(x, y, w, h, r = 0) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      if (!r) return `M${P(x, y)} L${P(x + w, y)} L${P(x + w, y + h)} L${P(x, y + h)} Z`;
      const A = (ex, ey) => `A${f(r)} ${f(r)} 0 0 1 ${P(ex, ey)}`;
      return `M${P(x + r, y)} L${P(x + w - r, y)} ${A(x + w, y + r)} L${P(x + w, y + h - r)} ${A(x + w - r, y + h)} ` +
        `L${P(x + r, y + h)} ${A(x, y + h - r)} L${P(x, y + r)} ${A(x + r, y)} Z`;
    },
    ellipse(x, y, rx, ry) {
      return `M${P(x + rx, y)} A${f(rx)} ${f(ry)} ${f(deg)} 1 1 ${P(x - rx, y)} A${f(rx)} ${f(ry)} ${f(deg)} 1 1 ${P(x + rx, y)} Z`;
    },
    circle(x, y, r) { return this.ellipse(x, y, r, r); },
    line(x1, y1, x2, y2) { return `M${P(x1, y1)} L${P(x2, y2)}`; },
    poly(pts, close = true) { return pts.map(([x, y], i) => `${i ? "L" : "M"}${P(x, y)}`).join(" ") + (close ? " Z" : ""); },
    raw(fn) { return fn(P); },
  };
}

// ------------------------------------------------------------------ floor textures
function floorPattern(id, spec, M) {
  const c = spec.color, a = spec.accentColor;
  const items = [];
  const rect = (x, y, w, h, fill, extra = {}) => items.push({ type: "path", d: `M${f(x)} ${f(y)} h${f(w)} v${f(h)} h${f(-w)} Z`, fill, ...extra });
  const line = (x1, y1, x2, y2, stroke, sw, opacity = 1) =>
    items.push({ type: "path", d: `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`, fill: "none", stroke, strokeWidth: sw, opacity });
  const dot = (x, y, r, fill, opacity = 1) => items.push({ type: "path", d: circlePath(x, y, r), fill, opacity });
  let w, h, rotation = 0;
  switch (spec.floor) {
    case "wood_planks": {
      const pw = M(0.2), pl = M(1.4);
      w = pl; h = pw * 4;
      const shades = [c, darken(c, 0.07), lighten(c, 0.06), darken(c, 0.12)];
      [0, 0.5, 0.25, 0.75].forEach((o, r) => {
        for (const x0 of [o * pl - pl, o * pl]) {
          rect(x0, r * pw, pl, pw, shades[r], { stroke: darken(c, 0.28), strokeWidth: pw * 0.05 });
        }
      });
      rotation = -45;
      break;
    }
    case "terrace_deck": {
      const pw = M(0.14);
      w = M(2); h = pw * 2;
      rect(0, 0, w, pw, c, { stroke: darken(c, 0.35), strokeWidth: pw * 0.12 });
      rect(0, pw, w, pw, darken(c, 0.06), { stroke: darken(c, 0.35), strokeWidth: pw * 0.12 });
      break;
    }
    case "wood_herringbone": {
      const s = M(0.28), t = s * 0.45;
      w = 2 * s; h = 2 * t;
      for (let k = -4; k <= 4; k++) {
        const y = k * t, fill = k % 2 ? darken(c, 0.1) : lighten(c, 0.05), st = { stroke: darken(c, 0.3), strokeWidth: t * 0.06 };
        items.push({ type: "path", d: `M0 ${f(y)} L${f(s)} ${f(y - s * 0.6)} L${f(s)} ${f(y - s * 0.6 + t)} L0 ${f(y + t)} Z`, fill, ...st });
        items.push({ type: "path", d: `M${f(s)} ${f(y - s * 0.6)} L${f(2 * s)} ${f(y)} L${f(2 * s)} ${f(y + t)} L${f(s)} ${f(y - s * 0.6 + t)} Z`,
          fill: k % 2 ? lighten(c, 0.05) : darken(c, 0.1), ...st });
      }
      break;
    }
    case "tile_checker": {
      const ts = M(0.3), b = a || "#F7F3EE";
      w = h = 2 * ts;
      rect(0, 0, w, h, b); rect(0, 0, ts, ts, c); rect(ts, ts, ts, ts, c);
      line(0, ts, w, ts, darken(b, 0.15), ts * 0.04); line(ts, 0, ts, h, darken(b, 0.15), ts * 0.04);
      break;
    }
    case "tile_square": {
      const ts = M(0.3);
      w = h = ts;
      rect(0, 0, ts, ts, c);
      if (a) rect(ts * 0.08, ts * 0.08, ts * 0.84, ts * 0.84, a, { opacity: 0.25 });
      line(0, 0, ts, 0, darken(c, 0.18), ts * 0.06); line(0, 0, 0, ts, darken(c, 0.18), ts * 0.06);
      break;
    }
    case "stone": {
      const ts = M(0.4);
      w = 2 * ts; h = 2 * ts;
      rect(0, 0, w, h, c);
      for (const [x, y, ww] of [[0, 0, ts], [ts, 0, ts], [-ts / 2, ts, ts], [ts / 2, ts, ts], [1.5 * ts, ts, ts]]) {
        rect(x + ts * 0.04, y + ts * 0.04, ww - ts * 0.08, ts - ts * 0.08, (x + y) % 2 ? lighten(c, 0.08) : darken(c, 0.05));
      }
      break;
    }
    case "marble": {
      w = h = M(1.4);
      rect(0, 0, w, h, c);
      const v = darken(c, 0.18);
      items.push({ type: "path", d: `M0 ${f(h * 0.2)} Q${f(w * 0.35)} ${f(h * 0.05)} ${f(w * 0.55)} ${f(h * 0.35)} T${f(w)} ${f(h * 0.45)}`, fill: "none", stroke: v, strokeWidth: w * 0.006, opacity: 0.6 });
      items.push({ type: "path", d: `M${f(w * 0.1)} ${f(h)} Q${f(w * 0.3)} ${f(h * 0.7)} ${f(w * 0.6)} ${f(h * 0.8)} T${f(w)} ${f(h * 0.6)}`, fill: "none", stroke: v, strokeWidth: w * 0.004, opacity: 0.45 });
      line(w * 0.5, 0, w * 0.5, h, darken(c, 0.08), w * 0.004, 0.5); line(0, h * 0.5, w, h * 0.5, darken(c, 0.08), w * 0.004, 0.5);
      break;
    }
    case "terrazzo": case "concrete": case "grass": case "carpet": default: {
      const kind = spec.floor || "concrete";
      w = h = M(kind === "carpet" ? 0.25 : 0.6);
      rect(0, 0, w, h, c);
      const r = rng(kind + c);
      if (kind === "carpet") {
        line(0, h, w, 0, lighten(c, 0.2), w * 0.04, 0.5);
      } else if (kind === "grass") {
        for (let i = 0; i < 14; i++) {
          const x = r() * w, y = r() * h, l = M(0.05) * (0.6 + r());
          line(x, y, x + l * 0.3, y - l, i % 2 ? darken(c, 0.15) : lighten(c, 0.15), M(0.012));
        }
      } else {
        const colors = kind === "terrazzo" ? [a || "#E07A5F", "#3D405B", "#81B29A", "#F2CC8F", "#FFFFFF"] : [darken(c, 0.15), lighten(c, 0.15)];
        for (let i = 0; i < (kind === "terrazzo" ? 18 : 22); i++) {
          dot(r() * w, r() * h, M(kind === "terrazzo" ? 0.018 : 0.008) * (0.5 + r()), colors[i % colors.length], kind === "terrazzo" ? 0.9 : 0.35);
        }
      }
    }
  }
  return { type: "pattern", id, width: w, height: h, rotation, items };
}

// ------------------------------------------------------------------ furniture symbols
function materialColor(theme, ap, fallback) {
  return ap?.color || theme.materials[ap?.material] || fallback;
}

function drawFixture(fx, ctx) {
  const { theme, push, M, u } = ctx;
  const box = boxOf(fx.shape), ap = fx.appearance || {};
  const { w, h } = box;
  const p = painter(box), sh = painter(box, u * 0.5, u * 0.6);
  const ref = { type: "fixture", id: fx.id };
  const out = (d, fill, extra = {}) => push({ type: "path", d, fill, stroke: extra.stroke ?? "none", strokeWidth: extra.strokeWidth ?? 0,
    opacity: extra.opacity, dash: extra.dash, linecap: extra.linecap, layer: "fixtures", ref });
  const shadow = (d) => out(d, theme.shadow, { opacity: 0.18 });
  const edge = (c) => ({ stroke: darken(c, 0.35), strokeWidth: u * 0.15 });
  const rr = Math.min(w, h) * 0.08;
  const body = (c, r = rr) => { shadow(sh.rect(-w / 2, -h / 2, w, h, r)); out(p.rect(-w / 2, -h / 2, w, h, r), c, edge(c)); };
  const roundBody = (c) => { shadow(sh.ellipse(0, 0, w / 2, h / 2)); out(p.ellipse(0, 0, w / 2, h / 2), c, edge(c)); };
  const lineOut = (d, c, sw, opacity) => out(d, "none", { stroke: c, strokeWidth: sw, opacity, linecap: "round" });

  if (box.free) {
    // polygon / path outline (e.g. a curved bar): draw the real shape with its material
    const base = { bar_counter: theme.materials.wood_dark, prep_counter: theme.materials.metal, rug: "#C2185B" }[fx.kind] || theme.materials.wood_light;
    const c = materialColor(theme, ap, base), d = shapeToPath(fx.shape);
    if (fx.kind !== "rug") shadow(translatePath(d, u * 0.5, u * 0.6));
    out(d, c, edge(c));
    if (fx.kind === "bar_counter" || fx.kind === "counter") out(d, "none", { stroke: lighten(c, 0.25), strokeWidth: u * 0.5, opacity: 0.6 });
    return;
  }
  switch (fx.kind) {
    case "tree": {
      const leaf = ap.color || "#4F8A3C", r = Math.min(w, h) / 2, rnd = rng(fx.id);
      shadow(sh.circle(u * 0.8, u * 0.8, r));
      const lobes = 9;
      out(p.raw((P) => {
        let d = "";
        for (let i = 0; i <= lobes; i++) {
          const a = (i / lobes) * Math.PI * 2, rr2 = r * (0.86 + rnd() * 0.14);
          const pt = [Math.cos(a) * rr2, Math.sin(a) * rr2];
          const am = ((i - 0.5) / lobes) * Math.PI * 2, cp = [Math.cos(am) * r * 1.12, Math.sin(am) * r * 1.12];
          d += i === 0 ? `M${P(pt[0], pt[1])}` : ` Q${P(cp[0], cp[1])} ${P(pt[0], pt[1])}`;
        }
        return d + " Z";
      }), leaf, { stroke: darken(leaf, 0.3), strokeWidth: u * 0.2 });
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2, d0 = r * 0.45 * rnd();
        out(p.circle(Math.cos(a) * d0, Math.sin(a) * d0, r * (0.25 + rnd() * 0.2)), i % 2 ? lighten(leaf, 0.15) : darken(leaf, 0.08), { opacity: 0.85 });
      }
      out(p.circle(-r * 0.25, -r * 0.3, r * 0.22), lighten(leaf, 0.3), { opacity: 0.5 });
      break;
    }
    case "parasol": {
      const c = ap.color || "#E9E4D8", c2 = ap.accentColor || "#D35D47", r = Math.min(w, h) / 2, n = 8;
      shadow(sh.circle(u * 1.2, u * 1.2, r));
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        out(p.poly([[0, 0], [Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]]), i % 2 ? c : c2,
          { stroke: darken(c2, 0.25), strokeWidth: u * 0.1, opacity: 0.92 });
      }
      out(p.circle(0, 0, r * 0.08), "#5B4636");
      break;
    }
    case "counter": case "prep_counter": case "bar_counter": {
      const c = materialColor(theme, ap, fx.kind === "prep_counter" ? theme.materials.metal : fx.kind === "bar_counter" ? theme.materials.wood_dark : theme.materials.wood_light);
      body(c, rr * 0.5);
      out(p.rect(-w / 2 + w * 0.02, -h / 2 + h * 0.08, w * 0.96, h * 0.55, rr * 0.3), lighten(c, fx.kind === "bar_counter" ? 0.18 : 0.1));
      if (fx.kind === "prep_counter") for (let i = 1; i < 4; i++) lineOut(p.line(-w / 2 + (w * i) / 4, -h / 2, -w / 2 + (w * i) / 4, h / 2), darken(c, 0.2), u * 0.1);
      if (fx.kind === "bar_counter") lineOut(p.line(-w / 2 + w * 0.02, h / 2 + u * 0.5, w / 2 - w * 0.02, h / 2 + u * 0.5), "#C9A227", u * 0.35);
      break;
    }
    case "sofa": case "armchair": {
      const c = ap.color || (fx.kind === "sofa" ? "#C0504D" : "#D9776E"), cush = ap.accentColor || lighten(c, 0.15);
      body(darken(c, 0.05), rr * 1.5);
      const arm = Math.min(w * 0.12, h * 0.25), back = h * 0.3;
      out(p.rect(-w / 2, -h / 2, w, back, rr), darken(c, 0.15));
      out(p.rect(-w / 2, -h / 2, arm, h, rr), darken(c, 0.1)); out(p.rect(w / 2 - arm, -h / 2, arm, h, rr), darken(c, 0.1));
      const n = fx.kind === "armchair" ? 1 : Math.max(1, Math.round((w - 2 * arm) / (h * 0.7)));
      const cw = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) out(p.rect(-w / 2 + arm + i * cw + u * 0.2, -h / 2 + back + u * 0.1, cw - u * 0.4, h - back - u * 0.4, rr), cush, edge(cush));
      break;
    }
    case "chair": case "bar_stool": {
      drawSeat(p, sh, Math.min(w, h) / 2, fx.kind === "bar_stool" ? "stool" : "chair", ap.color || theme.chair, (d, fill, e) => out(d, fill, e), shadow, u);
      break;
    }
    case "plant": case "planter": {
      const pot = ap.accentColor || "#8D5A3B", leaf = ap.color || "#3E8E41";
      if (fx.kind === "planter") {
        body(pot, rr);
        const n = Math.max(2, Math.round(w / h));
        for (let i = 0; i < n; i++) drawLeaves(p, -w / 2 + (w * (i + 0.5)) / n, 0, Math.min(w / n, h) * 0.55, leaf, out, fx.id + i);
      } else {
        const r = Math.min(w, h) / 2;
        shadow(sh.circle(0, 0, r * 0.95));
        out(p.circle(0, 0, r * 0.45), pot, edge(pot));
        drawLeaves(p, 0, 0, r, leaf, out, fx.id);
      }
      break;
    }
    case "rug": {
      const c = ap.color || "#C2185B", a2 = ap.accentColor || lighten(c, 0.45);
      if (box.round) { out(p.ellipse(0, 0, w / 2, h / 2), c); out(p.ellipse(0, 0, w / 2 - u, h / 2 - u), "none", { stroke: a2, strokeWidth: u * 0.4, dash: [u, u * 0.6] }); }
      else { out(p.rect(-w / 2, -h / 2, w, h, rr), c); out(p.rect(-w / 2 + u, -h / 2 + u, w - 2 * u, h - 2 * u, rr), "none", { stroke: a2, strokeWidth: u * 0.4, dash: [u, u * 0.6] }); }
      break;
    }
    case "sink": case "hand_sink": {
      const c = materialColor(theme, ap, "#E6E9EC");
      body(c, rr);
      const n = fx.kind === "sink" && w > h * 1.6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n;
        out(p.ellipse(x, h * 0.05, (w / n) * 0.32, h * 0.3), "#C3CCD4", { stroke: "#9AA5AF", strokeWidth: u * 0.12 });
        out(p.circle(x, -h * 0.32, Math.min(w, h) * 0.06), "#8A95A0");
      }
      break;
    }
    case "stove": {
      const c = materialColor(theme, ap, "#3A3F44");
      body(c, rr * 0.5);
      const cols = Math.max(2, Math.round(w / (h / 2))), rows = 2, r = Math.min(w / cols, h / rows) * 0.3;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = -w / 2 + (w * (i + 0.5)) / cols, y = -h / 2 + (h * (j + 0.5)) / rows;
        out(p.circle(x, y, r), "#1E2226", { stroke: "#6B7279", strokeWidth: u * 0.2 });
        out(p.circle(x, y, r * 0.35), "#E4572E", { opacity: 0.7 });
      }
      break;
    }
    case "oven": case "dishwasher": case "fridge": case "freezer": {
      const base = { oven: "#5B6168", dishwasher: "#C5CCD2", fridge: "#E9EDF0", freezer: "#DDEBF3" }[fx.kind];
      const c = materialColor(theme, ap, base);
      body(c, rr * 0.5);
      if (fx.kind === "oven") { out(p.rect(-w * 0.35, -h * 0.25, w * 0.7, h * 0.45, rr * 0.3), "#262A2E"); lineOut(p.line(-w * 0.3, h * 0.32, w * 0.3, h * 0.32), "#D6DADF", u * 0.3); }
      else if (fx.kind === "dishwasher") { for (let i = 1; i < 4; i++) lineOut(p.line(-w * 0.4, -h / 2 + (h * i) / 4, w * 0.4, -h / 2 + (h * i) / 4), darken(c, 0.2), u * 0.12); }
      else { lineOut(p.line(-w / 2, -h * 0.1, w / 2, -h * 0.1), darken(c, 0.2), u * 0.15); lineOut(p.line(w * 0.3, h * 0.1, w * 0.3, h * 0.4), "#8A95A0", u * 0.3); }
      break;
    }
    case "coffee_machine": {
      const c = materialColor(theme, ap, "#2F3337");
      body(c, rr);
      out(p.rect(-w * 0.4, -h * 0.4, w * 0.8, h * 0.3, rr * 0.5), "#B9C0C6");
      for (const x of [-w * 0.22, w * 0.22]) out(p.circle(x, h * 0.18, Math.min(w, h) * 0.12), "#FFFFFF", { stroke: "#C9CED3", strokeWidth: u * 0.1 });
      break;
    }
    case "display_case": {
      const c = materialColor(theme, ap, "#D8F3F8");
      body(c, rr * 0.5);
      out(p.rect(-w / 2, -h / 2, w, h, rr * 0.5), "none", { stroke: "#8CC7D3", strokeWidth: u * 0.3 });
      const palette = ["#E9A0B3", "#F2C46D", "#9B6A4E", "#F6E7C8", "#B5D99C"], r = rng(fx.id);
      const cols = Math.max(2, Math.round(w / (h * 0.45)));
      for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
        out(p.circle(-w / 2 + (w * (i + 0.5)) / cols, -h / 2 + (h * (j + 0.5)) / 2, Math.min(w / cols, h / 2) * 0.28), palette[Math.floor(r() * palette.length)]);
      }
      break;
    }
    case "wine_rack": case "shelf": {
      const c = materialColor(theme, ap, fx.kind === "wine_rack" ? theme.materials.wood_dark : theme.materials.wood);
      body(c, rr * 0.4);
      const cols = Math.max(2, Math.round(w / (h * 0.5))), r = rng(fx.id);
      for (let i = 0; i < cols; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / cols;
        if (fx.kind === "wine_rack") out(p.circle(x, 0, Math.min(w / cols, h) * 0.3), i % 2 ? "#5A1A27" : "#2E3B1F");
        else out(p.rect(x - (w / cols) * 0.35, -h * 0.3, (w / cols) * 0.7, h * 0.6, u * 0.2), ["#E07A5F", "#3D405B", "#81B29A", "#F2CC8F"][Math.floor(r() * 4)]);
      }
      break;
    }
    case "host_stand": case "pos_terminal": case "tv": {
      const c = materialColor(theme, ap, fx.kind === "host_stand" ? theme.materials.wood : "#2A2E33");
      body(c, rr);
      if (fx.kind === "host_stand") out(p.rect(-w * 0.25, -h * 0.3, w * 0.4, h * 0.55, u * 0.1), "#FFFFFF");
      else out(p.rect(-w * 0.38, -h * 0.32, w * 0.76, h * 0.5, u * 0.1), fx.kind === "tv" ? "#3B4652" : "#7FD1E8");
      break;
    }
    case "piano": {
      const c = ap.color || "#16181B";
      const body2 = (q) => q.raw((P) => `M${P(-w / 2, -h / 2)} L${P(w / 2, -h / 2)} L${P(w / 2, h * 0.05)} ` +
        `Q${P(w / 2, h / 2)} ${P(w * 0.1, h / 2)} Q${P(-w * 0.15, h / 2)} ${P(-w * 0.2, h * 0.2)} Q${P(-w / 2, h * 0.1)} ${P(-w / 2, -h * 0.1)} Z`);
      shadow(body2(sh)); out(body2(p), c, { stroke: "#000000", strokeWidth: u * 0.1 });
      out(p.rect(-w / 2 + u * 0.3, -h / 2 + u * 0.3, w - u * 0.6, h * 0.16, u * 0.1), "#FFFFFF");
      const keys = Math.max(8, Math.round(w / (u * 0.9)));
      for (let i = 1; i < keys; i++) if (i % 7 !== 3 && i % 7 !== 0) out(p.rect(-w / 2 + u * 0.3 + ((w - u * 0.6) * i) / keys - u * 0.12, -h / 2 + u * 0.3, u * 0.24, h * 0.1), "#16181B");
      break;
    }
    case "toilet": case "urinal": {
      const c = "#FFFFFF";
      if (fx.kind === "urinal") { body(c, Math.min(w, h) * 0.4); break; }
      shadow(sh.ellipse(0, h * 0.1, w * 0.4, h * 0.38));
      out(p.rect(-w / 2, -h / 2, w, h * 0.3, u * 0.3), c, edge("#D5DBE0"));
      out(p.ellipse(0, h * 0.1, w * 0.4, h * 0.38), c, edge("#D5DBE0"));
      out(p.ellipse(0, h * 0.12, w * 0.24, h * 0.24), "#DDEFF5");
      break;
    }
    case "stairs": case "elevator": {
      const c = materialColor(theme, ap, fx.kind === "stairs" ? "#D9D4CB" : "#AEB5BC");
      body(c, 0);
      if (fx.kind === "stairs") { const n = Math.max(4, Math.round(h / (w * 0.18))); for (let i = 1; i < n; i++) lineOut(p.line(-w / 2, -h / 2 + (h * i) / n, w / 2, -h / 2 + (h * i) / n), darken(c, 0.25), u * 0.12); }
      else { lineOut(p.line(-w / 2, -h / 2, w / 2, h / 2), darken(c, 0.3), u * 0.15); lineOut(p.line(w / 2, -h / 2, -w / 2, h / 2), darken(c, 0.3), u * 0.15); }
      break;
    }
    case "column": {
      const c = materialColor(theme, ap, "#E4E0D8");
      if (box.round) roundBody(c); else body(c, 0);
      break;
    }
    default: {
      const c = materialColor(theme, ap, "#B0B7BE");
      if (box.round) roundBody(c); else body(c, rr);
      out(box.round ? p.ellipse(0, 0, w * 0.35, h * 0.35) : p.rect(-w * 0.35, -h * 0.35, w * 0.7, h * 0.7, rr), lighten(c, 0.18));
    }
  }
}

function drawLeaves(p, x, y, r, leaf, out, seed) {
  const rnd = rng(seed);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rnd() * 0.4, len = r * (0.75 + rnd() * 0.25);
    const lx = x + Math.cos(a) * len * 0.55, ly = y + Math.sin(a) * len * 0.55;
    out(p.raw((P) => {
      const tip = [x + Math.cos(a) * len, y + Math.sin(a) * len], side = [-Math.sin(a) * len * 0.22, Math.cos(a) * len * 0.22];
      return `M${P(x, y)} Q${P(lx + side[0], ly + side[1])} ${P(tip[0], tip[1])} Q${P(lx - side[0], ly - side[1])} ${P(x, y)} Z`;
    }), i % 2 ? leaf : lighten(leaf, 0.18));
  }
  out(p.circle(x, y, r * 0.12), darken(leaf, 0.2));
}

/** A seat in local frame: +y faces the table. */
function drawSeat(p, sh, r, kind, color, out, shadow, u) {
  const edge = { stroke: darken(color, 0.35), strokeWidth: u * 0.12 };
  if (kind === "stool") {
    shadow(sh.circle(0, 0, r));
    out(p.circle(0, 0, r), color, edge);
    out(p.circle(0, 0, r * 0.55), lighten(color, 0.2));
    return;
  }
  const s = kind === "armchair" ? r * 2.3 : r * 2;
  shadow(sh.rect(-s / 2, -s / 2, s, s, s * 0.2));
  out(p.rect(-s / 2, -s / 2, s, s, s * 0.2), color, edge);
  out(p.rect(-s / 2, -s / 2, s, s * 0.26, s * 0.12), darken(color, 0.18));
  if (kind === "armchair") {
    out(p.rect(-s / 2, -s / 2, s * 0.18, s, s * 0.08), darken(color, 0.1));
    out(p.rect(s / 2 - s * 0.18, -s / 2, s * 0.18, s, s * 0.08), darken(color, 0.1));
  }
}

function drawTable(t, ctx, state) {
  const { theme, push, u, M } = ctx;
  const box = boxOf(t.shape), ap = t.appearance || {}, cs = t.chairStyle || {};
  const { w, h } = box;
  const ref = { type: "table", id: t.id };
  const out = (layer) => (d, fill, extra = {}) => push({ type: "path", d, fill, stroke: extra.stroke ?? "none",
    strokeWidth: extra.strokeWidth ?? 0, opacity: extra.opacity, dash: extra.dash, layer, ref });
  const chairOut = out("chairs"), tableOut = out("tables");
  const shadowChair = (d) => chairOut(d, theme.shadow, { opacity: 0.18 });
  const top = materialColor(theme, ap, theme.materials.wood);
  const [cx, cy] = [box.cx, box.cy];

  // seats
  const seats = t.chairs?.length ? t.chairs.map((c) => ({ p: [c.x, c.y], r: M(0.22) })) : autoChairs(t, u);
  const seatColor = cs.color || theme.chair;
  if ((cs.kind === "bench" || cs.kind === "booth") && !box.round && !box.free) {
    const p = painter(box), sh = painter(box, u * 0.5, u * 0.6), depth = M(cs.kind === "booth" ? 0.55 : 0.4);
    for (const side of [-1, 1]) {
      const y = side * (h / 2 + depth / 2 + u * 0.3);
      shadowChair(sh.rect(-w / 2, y - depth / 2, w, depth, depth * 0.25));
      chairOut(p.rect(-w / 2, y - depth / 2, w, depth, depth * 0.25), seatColor, { stroke: darken(seatColor, 0.35), strokeWidth: u * 0.12 });
      if (cs.kind === "booth") chairOut(p.rect(-w / 2, side > 0 ? y + depth / 2 - depth * 0.3 : y - depth / 2, w, depth * 0.3, depth * 0.15), darken(seatColor, 0.2));
    }
  } else {
    for (const s of seats) {
      const a = Math.atan2(cy - s.p[1], cx - s.p[0]);
      const sb = { cx: s.p[0], cy: s.p[1], rot: (a * 180) / Math.PI - 90 };
      drawSeat(painter(sb), painter(sb, u * 0.5, u * 0.6), s.r, cs.kind || "chair", seatColor, chairOut, shadowChair, u);
    }
  }

  // table top
  const p = painter(box), sh = painter(box, u * 0.6, u * 0.8);
  const shape = (q, inset = 0) => box.round ? q.ellipse(0, 0, w / 2 - inset, h / 2 - inset)
    : box.free ? null : q.rect(-w / 2 + inset, -h / 2 + inset, w - 2 * inset, h - 2 * inset, Math.max(0, Math.min(w, h) * 0.08 - inset));
  const outline = shape(p) || shapeToPath(t.shape);
  tableOut(shape(sh) || outline, theme.shadow, { opacity: 0.22 });
  if (ap.tablecloth) {
    tableOut(box.round ? p.ellipse(0, 0, w / 2 + u * 0.4, h / 2 + u * 0.4) : outline, ap.tablecloth, { stroke: darken(ap.tablecloth, 0.25), strokeWidth: u * 0.12 });
    tableOut(shape(p, Math.min(w, h) * 0.06) || outline, lighten(ap.tablecloth, 0.12));
  } else {
    tableOut(outline, top, { stroke: darken(top, 0.35), strokeWidth: u * 0.15, opacity: ap.material === "glass" ? 0.85 : 1 });
    tableOut(shape(p, Math.min(w, h) * 0.07) || outline, lighten(top, 0.12));
  }

  // place settings
  if (ap.tableSetting && ap.tableSetting !== "none") {
    const pr = Math.min(Math.min(w, h) * 0.13, M(0.13));
    for (const s of seats) {
      const dx = cx - s.p[0], dy = cy - s.p[1], L = Math.hypot(dx, dy) || 1;
      const inward = s.r * 1.3 + pr * 1.25;
      const pc = [s.p[0] + (dx / L) * inward, s.p[1] + (dy / L) * inward];
      tableOut(circlePath(pc[0], pc[1], pr), "#FFFFFF", { stroke: "#D5D9DD", strokeWidth: u * 0.1 });
      tableOut(circlePath(pc[0], pc[1], pr * 0.6), "#F4F6F7", { stroke: "#E2E6E9", strokeWidth: u * 0.08 });
      if (ap.tableSetting === "plates_glasses") {
        tableOut(circlePath(pc[0] - (dy / L) * pr * 1.25, pc[1] + (dx / L) * pr * 1.25, pr * 0.32), "#CDEFF7", { stroke: "#9FD3E0", strokeWidth: u * 0.06 });
      }
    }
  }

  // status ring and number badge
  const st = state?.status;
  if (st) tableOut(outline, "none", { stroke: theme.status[st] || theme.status.unknown, strokeWidth: u * 0.6, opacity: 0.95 });
  const br = u * 1.5;
  tableOut(circlePath(cx, cy, br), st ? theme.status[st] || theme.badge.fill : theme.badge.fill,
    { stroke: theme.badge.stroke, strokeWidth: u * 0.15 });
  push({ type: "text", x: cx, y: cy, text: t.number, fontSize: br * (t.number.length > 2 ? 0.85 : 1.15), weight: 700,
    fill: theme.badge.text, rotation: 0, layer: "tables", ref });
}

function drawClimate(dv, ctx) {
  const { theme, push, u } = ctx;
  const box = boxOf(dv.shape), { w, h } = box, p = painter(box), sh = painter(box, u * 0.4, u * 0.5);
  const ref = { type: "climateDevice", id: dv.id };
  const out = (d, fill, extra = {}) => push({ type: "path", d, fill, stroke: extra.stroke ?? "none", strokeWidth: extra.strokeWidth ?? 0,
    opacity: extra.opacity, dash: extra.dash, linecap: "round", layer: "climate", ref });
  const c = materialColor(theme, dv.appearance, dv.kind === "exhaust_hood" ? "#C5CCD2" : "#FFFFFF");
  if (dv.kind === "exhaust_hood") {
    // ceiling-mounted over the cooking line: outline only, so the equipment below stays visible
    out(p.rect(-w / 2, -h / 2, w, h, u * 0.4), c, { opacity: 0.18 });
    out(p.rect(-w / 2, -h / 2, w, h, u * 0.4), "none", { stroke: "#6B7680", strokeWidth: u * 0.25, dash: [u * 1.2, u * 0.6] });
    return;
  }
  out(sh.rect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.25), theme.shadow, { opacity: 0.15 });
  out(p.rect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.25), c, { stroke: "#9AA9B4", strokeWidth: u * 0.15 });
  if (["air_conditioner", "hvac_indoor_unit"].includes(dv.kind)) {
    for (let i = 1; i <= 2; i++) out(p.line(-w * 0.4, -h / 2 + (h * i) / 3, w * 0.4, -h / 2 + (h * i) / 3), "none", { stroke: "#B7C4CC", strokeWidth: u * 0.15 });
    out(p.circle(w * 0.38, -h * 0.22, Math.min(w, h) * 0.08), "#34D399");
  } else if (/vent|fan|purifier/.test(dv.kind)) {
    const n = 3;
    for (let i = 1; i < n; i++) {
      out(p.line(-w / 2 + (w * i) / n, -h * 0.4, -w / 2 + (w * i) / n, h * 0.4), "none", { stroke: "#9AA9B4", strokeWidth: u * 0.12 });
      out(p.line(-w * 0.4, -h / 2 + (h * i) / n, w * 0.4, -h / 2 + (h * i) / n), "none", { stroke: "#9AA9B4", strokeWidth: u * 0.12 });
    }
  } else if (/heater|radiator/.test(dv.kind)) {
    const n = Math.max(3, Math.round(w / (u * 1.2)));
    for (let i = 1; i < n; i++) out(p.line(-w / 2 + (w * i) / n, -h * 0.35, -w / 2 + (w * i) / n, h * 0.35), "none", { stroke: "#E4572E", strokeWidth: u * 0.15, opacity: 0.8 });
  }
  if (dv.airflowDirectionDeg != null) {
    const a = (dv.airflowDirectionDeg * Math.PI) / 180;
    for (let k = 0; k < 3; k++) {
      const d0 = u * (3 + k * 1.6), mid = [box.cx + Math.cos(a) * d0, box.cy + Math.sin(a) * d0], n = [-Math.sin(a) * u * 1.4, Math.cos(a) * u * 1.4];
      push({ type: "path", d: `M${f(mid[0] - n[0])} ${f(mid[1] - n[1])} Q${f(mid[0] + Math.cos(a) * u * 0.8)} ${f(mid[1] + Math.sin(a) * u * 0.8)} ${f(mid[0] + n[0])} ${f(mid[1] + n[1])}`,
        fill: "none", stroke: "#3BA7D9", strokeWidth: u * 0.25, opacity: 0.7 - k * 0.18, linecap: "round", layer: "climate", ref });
    }
  }
}

// ------------------------------------------------------------------ scene
/**
 * @param plan    Eatery Plan document
 * @param options floorId, tableStates, readings, theme (partial), showZoneNames (default true),
 *                walls3d (default true), camera {x, y} (default: floor centre), wallDepth (default 1),
 *                showChairs, highlightReview, resolveAsset/showBackground (ignored: the illustration replaces the drawing)
 */
export function buildIllustratedScene(plan, options = {}) {
  const floor = plan.floors.find((x) => x.id === options.floorId) || plan.floors[0];
  const theme = { ...ILLUSTRATED_THEME, ...(options.theme || {}) };
  const states = asMap(options.tableStates, "tableId");
  const readings = asMap(options.readings, "sensorId");
  const { width: W, height: H, realWorldScale } = floor.coordinateSpace;
  const u = Math.min(W, H) / 100;
  const mpu = realWorldScale?.metersPerUnit;
  const M = (m) => (mpu ? m / mpu : m * 10 * u);
  const items = [], defs = [];
  const push = (it) => items.push(it);
  const vis = (o) => o.visible !== false;
  const ordered = (arr) => (arr || []).filter(vis).map((o, i) => [o, i])
    .sort((p, q) => (p[0].zIndex || 0) - (q[0].zIndex || 0) || p[1] - q[1]).map((p) => p[0]);
  const ctx = { theme, push, u, M };
  const review = (d, o, type) => {
    if (options.highlightReview !== false && o.needsReview) {
      push({ type: "path", d, fill: "none", stroke: theme.review, strokeWidth: u * 0.5, dash: [u * 1.2, u * 0.8], layer: "review", ref: { type, id: o.id } });
    }
  };

  defs.push({ type: "linearGradient", id: "ep-sheen", x1: 0, y1: 0, x2: 1, y2: 1, stops: [
    { offset: 0, color: "#FFFFFF", opacity: 0.22 }, { offset: 0.4, color: "#FFFFFF", opacity: 0 },
    { offset: 0.62, color: "#FFFFFF", opacity: 0.1 }, { offset: 0.75, color: "#FFFFFF", opacity: 0 }] });

  // building shadow + floors
  const zones = ordered(floor.zones);
  for (const z of zones) {
    if (!z.parentZoneId) {
      const d = shapeToPath(z.shape);
      push({ type: "path", d: translatePath(d, u * 1.2, u * 1.6), fill: theme.buildingShadow, opacity: 0.16, layer: "shadow" });
    }
  }
  for (const z of zones) {
    const spec = { ...(theme.floors[z.kind] || theme.floors.other), ...(z.appearance || {}) };
    if (!spec.floor) spec.floor = (theme.floors[z.kind] || theme.floors.other).floor;
    const pid = `ep-floor-${z.id}`;
    defs.push(floorPattern(pid, spec, M));
    const d = shapeToPath(z.shape);
    push({ type: "path", d, fill: `url(#${pid})`, stroke: "none", strokeWidth: 0, layer: "zones", ref: { type: "zone", id: z.id } });
    push({ type: "path", d, fill: "url(#ep-sheen)", stroke: "none", strokeWidth: 0, layer: "zones", ref: { type: "zone", id: z.id } });
    review(d, z, "zone");
  }

  for (const fx of ordered(floor.fixtures)) { drawFixture(fx, ctx); review(shapeToPath(fx.shape), fx, "fixture"); }

  // walls (white, with an outline) and openings
  const openingsByWall = new Map();
  for (const o of ordered(floor.openings)) {
    if (!openingsByWall.has(o.wallId)) openingsByWall.set(o.wallId, []);
    openingsByWall.get(o.wallId).push(o);
  }
  const walls = ordered(floor.walls);
  const use3d = options.walls3d !== false;
  const wallData = [];
  for (const w of walls) {
    const g = new WallGeom(w);
    if (g.length <= 0) continue;
    const gaps = (openingsByWall.get(w.id) || []).map((o) => {
      const c = o.position * g.length, hh = o.width / 2;
      return [Math.max(0, (c - hh) / g.length), Math.min(1, (c + hh) / g.length), o];
    }).sort((a, b) => a[0] - b[0]);
    // in 3D the wall stays solid behind windows; windows are drawn on the visible wall face
    const cuts = use3d ? gaps.filter(([, , o]) => o.kind !== "window") : gaps;
    let t = 0;
    const solid = [];
    for (const [t0, t1] of cuts) { if (t0 > t) solid.push([t, t0]); t = Math.max(t, t1); }
    if (t < 1) solid.push([t, 1]);
    wallData.push({ w, g, gaps, solid, color: w.appearance?.color || theme.wall });
  }

  if (use3d) {
    drawWalls3D(wallData, { theme, push, u, cam: options.camera ? [options.camera.x, options.camera.y] : [W / 2, H / 2],
      depth: options.wallDepth ?? 1 });
  } else {
    for (const pass of ["edge", "fill"]) {
      for (const { w, g, solid, color } of wallData) {
        for (const [t0, t1] of solid) {
          const ext = pass === "edge" ? w.thickness / 2 + u * 0.25 : w.thickness / 2;
          const d = g.segmentPath(t0, t1, t0 === 0 ? ext : pass === "edge" ? u * 0.25 : 0, t1 === 1 ? ext : pass === "edge" ? u * 0.25 : 0);
          push({ type: "path", d, fill: "none", stroke: pass === "edge" ? theme.wallEdge : color,
            strokeWidth: w.thickness + (pass === "edge" ? u * 0.5 : 0), dash: w.kind === "half_height" && pass === "fill" ? [w.thickness, w.thickness * 0.5] : null,
            layer: "walls", ref: { type: "wall", id: w.id } });
        }
      }
    }
  }

  for (const { w, g, gaps } of wallData) {
    for (const [t0, t1, o] of gaps) {
      const p0 = g.pointAt(t0), p1 = g.pointAt(t1), ref = { type: "opening", id: o.id };
      if (o.kind === "window") {
        if (!use3d) {
          push({ type: "path", d: g.segmentPath(t0, t1), fill: "none", stroke: o.appearance?.color || theme.window, strokeWidth: w.thickness * 0.7, layer: "openings", ref });
          push({ type: "path", d: g.segmentPath(t0, t1), fill: "none", stroke: "#FFFFFF", strokeWidth: w.thickness * 0.12, layer: "openings", ref });
        }
      } else if (o.kind === "door" && o.swing !== "none") {
        const outward = o.opensToward === "outside" ? -1 : 1;
        const leaf = (hinge, jamb, tH, len) => {
          const [tx, ty] = g.tangentAt(tH), n = [-ty * outward, tx * outward];
          const end = [hinge[0] + n[0] * len, hinge[1] + n[1] * len];
          const v1 = [end[0] - hinge[0], end[1] - hinge[1]], v2 = [jamb[0] - hinge[0], jamb[1] - hinge[1]];
          const sweep = v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 1 : 0;
          push({ type: "path", d: `M${f(hinge[0])} ${f(hinge[1])} L${f(end[0])} ${f(end[1])}`, fill: "none", stroke: o.appearance?.color || theme.door,
            strokeWidth: u * 0.35, opacity: 0.75, linecap: "round", layer: "openings", ref });
          push({ type: "path", d: `M${f(end[0])} ${f(end[1])} A${f(len)} ${f(len)} 0 0 ${sweep} ${f(jamb[0])} ${f(jamb[1])}`, fill: "none",
            stroke: theme.door, strokeWidth: u * 0.18, dash: [u * 0.7, u * 0.5], opacity: 0.55, layer: "openings", ref });
        };
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (o.swing === "double") { const mid = g.pointAt((t0 + t1) / 2); leaf(p0, mid, t0, L / 2); leaf(p1, mid, t1, L / 2); }
        else if (o.swing === "sliding") {
          const [tx, ty] = g.tangentAt((t0 + t1) / 2), off = w.thickness * 0.4;
          push({ type: "path", d: `M${f(p0[0] - ty * off)} ${f(p0[1] + tx * off)} L${f(p1[0] - ty * off)} ${f(p1[1] + tx * off)}`, fill: "none",
            stroke: theme.door, strokeWidth: u * 0.35, opacity: 0.75, layer: "openings", ref });
        } else if (o.hinge === "end") leaf(p1, p0, t1, L); else leaf(p0, p1, t0, L);
      }
      if (o.needsReview) review(circlePath(...g.pointAt((t0 + t1) / 2), o.width / 2), o, "opening");
    }
  }

  for (const t of ordered(floor.tables)) {
    drawTable(options.showChairs === false ? { ...t, seats: 0, chairs: [] } : t, ctx, states.get(t.id));
    review(shapeToPath(t.shape), t, "table");
  }
  for (const dv of ordered(floor.climateDevices)) { drawClimate(dv, ctx); review(shapeToPath(dv.shape), dv, "climateDevice"); }

  for (const s of ordered(floor.environmentalSensors)) {
    const { x, y } = s.position, ref = { type: "sensor", id: s.id };
    push({ type: "path", d: circlePath(x, y, u * 1.1), fill: "#FFFFFF", stroke: "#3BA7D9", strokeWidth: u * 0.3, layer: "sensors", ref });
    push({ type: "path", d: circlePath(x, y, u * 0.45), fill: "#3BA7D9", layer: "sensors", ref });
    const r = readings.get(s.id), text = formatReadings(r?.readings ?? r);
    if (text) chip(push, x, y + u * 3.2, text, u * 1.5, theme, ref, "sensors");
  }

  // zone names as chips, labels and dimensions
  if (options.showZoneNames !== false) {
    for (const z of zones) {
      if (!z.name) continue;
      const b = boxOf(z.shape);
      chip(push, b.cx, b.cy - b.h / 2 + u * 3, z.name, u * 1.7, theme, { type: "zone", id: z.id }, "labels");
    }
  }
  for (const lb of ordered(floor.labels)) {
    const ref = { type: "label", id: lb.id };
    if (lb.kind === "dimension") {
      const a = [lb.a.x, lb.a.y], b = [lb.b.x, lb.b.y], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n = [-(b[1] - a[1]) / L * u, (b[0] - a[0]) / L * u];
      push({ type: "path", d: `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])} M${f(a[0] - n[0])} ${f(a[1] - n[1])} L${f(a[0] + n[0])} ${f(a[1] + n[1])} ` +
        `M${f(b[0] - n[0])} ${f(b[1] - n[1])} L${f(b[0] + n[0])} ${f(b[1] + n[1])}`, fill: "none", stroke: "#FFFFFF", strokeWidth: u * 0.2, layer: "labels", ref });
      let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
      if (lb.rotationDeg || Math.abs(deg) > 1) {
        push({ type: "text", x: lb.position.x, y: lb.position.y, text: lb.text, fontSize: lb.fontSize || u * 1.8, weight: 600, fill: "#FFFFFF",
          rotation: lb.rotationDeg || deg, layer: "labels", ref });
      } else {
        chip(push, lb.position.x, lb.position.y, lb.text, lb.fontSize || u * 1.6, theme, ref, "labels");
      }
    } else {
      chip(push, lb.position.x, lb.position.y, lb.text, lb.fontSize || u * 1.7, theme, ref, "labels");
    }
  }

  const order = new Map(ILLUSTRATED_LAYERS.map((l, i) => [l, i]));
  const sorted = items.map((it, i) => [it, i]).sort((p, q) => order.get(p[0].layer) - order.get(q[0].layer) || p[1] - q[1]).map((p) => p[0]);
  return { floorId: floor.id, width: W, height: H, viewBox: `0 0 ${f(W)} ${f(H)}`, background: theme.background, defs, items: sorted };
}

/**
 * Walls with depth: a camera above `cam` sees each wall's top shifted away from it and the wall face that points
 * towards it. Faces, window decals and tops are plain 2D polygons, so any SVG/Canvas renderer can draw them.
 */
function drawWalls3D(wallData, { theme, push, u, cam, depth }) {
  const K = 0.03 * depth;                      // top offset per metre of wall height, relative to distance from cam
  const faces = [], decals = [], tops = [];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const poly = (pts) => pts.map((q, i) => `${i ? "L" : "M"}${f(q[0])} ${f(q[1])}`).join(" ") + " Z";
  const faceColor = theme.wallFace || "#E4ECF1";

  for (const { w, g, gaps, solid, color } of wallData) {
    const hgt = w.heightMeters ?? (w.kind === "half_height" ? 1.1 : 2.8);
    const cap = Math.max(w.thickness * 2.6, u * 2.5) * depth, T = w.thickness;
    const lift = (q, frac = 1) => {
      let ox = (q[0] - cam[0]) * K * hgt, oy = (q[1] - cam[1]) * K * hgt;
      const L = Math.hypot(ox, oy);
      if (L > cap) { ox *= cap / L; oy *= cap / L; }
      return [q[0] + ox * frac, q[1] + oy * frac];
    };
    const ref = { type: "wall", id: w.id };
    for (const [t0, t1] of solid) {
      const n = g.curved ? Math.max(2, Math.ceil(16 * (t1 - t0))) : 1;
      const samples = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n, [tx, ty] = g.tangentAt(t);
        let p = g.pointAt(t);
        if (!g.curved && i === 0 && t0 === 0) p = [p[0] - tx * T / 2, p[1] - ty * T / 2];
        if (!g.curved && i === n && t1 === 1) p = [p[0] + tx * T / 2, p[1] + ty * T / 2];
        samples.push({ p, nrm: [-ty, tx], tan: [tx, ty] });
      }
      const Ls = samples.map(({ p, nrm }) => [p[0] + nrm[0] * T / 2, p[1] + nrm[1] * T / 2]);
      const Rs = samples.map(({ p, nrm }) => [p[0] - nrm[0] * T / 2, p[1] - nrm[1] * T / 2]);
      const face = (a, b, nrm) => {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (dot(nrm, [cam[0] - mid[0], cam[1] - mid[1]]) <= 0) return;
        const shade = 0.16 + 0.3 * ((1 - nrm[1]) / 2) + 0.06 * Math.abs(nrm[0]);
        faces.push({ type: "path", d: poly([a, b, lift(b), lift(a)]), fill: mix(faceColor, "#7F95A3", shade),
          stroke: mix(faceColor, "#7F95A3", shade + 0.15), strokeWidth: u * 0.06, layer: "walls", ref });
      };
      for (let i = 0; i < n; i++) {
        const nm = samples[i].nrm;
        face(Ls[i], Ls[i + 1], nm);
        face(Rs[i + 1], Rs[i], [-nm[0], -nm[1]]);
      }
      face(Rs[0], Ls[0], [-samples[0].tan[0], -samples[0].tan[1]]);
      face(Ls[n], Rs[n], samples[n].tan);

      // windows: decal on the visible face, glass line on the top
      if (!g.curved) {
        for (const [wa, wb, o] of gaps) {
          if (o.kind !== "window") continue;
          const a0 = Math.max(wa, t0), a1 = Math.min(wb, t1);
          if (a1 <= a0) continue;
          const nm = samples[0].nrm, at = (t, side) => {
            const p = g.pointAt(t);
            return [p[0] + side * nm[0] * T / 2, p[1] + side * nm[1] * T / 2];
          };
          for (const side of [1, -1]) {
            const b1 = at(a0, side), b2 = at(a1, side), mid = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
            if (dot([nm[0] * side, nm[1] * side], [cam[0] - mid[0], cam[1] - mid[1]]) <= 0) continue;
            const q = (b, fr) => { const top = lift(b); return [b[0] + (top[0] - b[0]) * fr, b[1] + (top[1] - b[1]) * fr]; };
            decals.push({ type: "path", d: poly([q(b1, 0.3), q(b2, 0.3), q(b2, 0.85), q(b1, 0.85)]), fill: o.appearance?.color || theme.window,
              stroke: "#FFFFFF", strokeWidth: u * 0.25, opacity: 0.9, layer: "walls", ref: { type: "opening", id: o.id } });
          }
          const c0 = lift(g.pointAt(a0)), c1 = lift(g.pointAt(a1));
          tops.push({ type: "path", d: `M${f(c0[0])} ${f(c0[1])} L${f(c1[0])} ${f(c1[1])}`, fill: "none", stroke: o.appearance?.color || theme.window,
            strokeWidth: T * 0.45, layer: "walls", ref: { type: "opening", id: o.id }, order: 1 });
        }
      }
      tops.push({ type: "path", d: poly([...Ls.map((q) => lift(q)), ...Rs.slice().reverse().map((q) => lift(q))]), fill: color,
        stroke: theme.wallEdge, strokeWidth: u * 0.12, layer: "walls", ref, order: 0 });
    }
  }
  for (const it of faces) push(it);
  for (const it of decals) push(it);
  for (const it of tops.filter((t) => t.order === 0)) { delete it.order; push(it); }
  for (const it of tops.filter((t) => t.order === 1)) { delete it.order; push(it); }
}

function chip(push, x, y, text, fs, theme, ref, layer) {
  const w = text.length * fs * 0.56 + fs * 1.2, h = fs * 1.7, r = h / 2;
  push({ type: "path", d: `M${f(x - w / 2 + r)} ${f(y - h / 2)} H${f(x + w / 2 - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w / 2 - r)} ${f(y + h / 2)} ` +
    `H${f(x - w / 2 + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x - w / 2 + r)} ${f(y - h / 2)} Z`, fill: "#FFFFFF", opacity: 0.88, stroke: "none", strokeWidth: 0, layer, ref });
  push({ type: "text", x, y, text, fontSize: fs, weight: 600, fill: theme.zoneText, rotation: 0, layer, ref });
}

/** Translate every absolute coordinate pair in a path made by shapeToPath (M/L/Q/C/A Z). */
function translatePath(d, dx, dy) {
  return d.replace(/([MLQCA])([^MLQCAZ]*)/g, (_, cmd, args) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === "A") {
      for (let i = 0; i + 6 < n.length + 1; i += 7) { n[i + 5] += dx; n[i + 6] += dy; }
    } else {
      for (let i = 0; i + 1 < n.length; i += 2) { n[i] += dx; n[i + 1] += dy; }
    }
    return cmd + n.map(f).join(" ") + " ";
  });
}
