/**
 * Eaterior "illustrated" theme: a colourful, flat top-down drawing produced entirely in code.
 *
 * The plan only says what things are (`kind`, `appearance.floor`, `appearance.material`, colours, `chairStyle`).
 * This module decides how they look: floor textures, furniture symbols, shadows and highlights.
 *
 * Output is the same display list as buildScene(), plus `defs` (patterns and gradients) referenced by
 * `fill: "url(#id)"`. toSvg() renders it; react-native-svg supports the same Defs/Pattern/LinearGradient.
 */
import { shapeToPath, shapeCenter, WallGeom, autoChairs, circlePath, f, rot, asMap, formatReadings,
  objectStateMap, stateMap, resolveState, applyInactive } from "./eaterior-render.mjs";

export const ILLUSTRATED_LAYERS = ["background", "shadow", "zones", "fixtures", "walls", "openings", "chairs",
  "tables", "canopy", "climate", "badges", "sensors", "labels", "review"];

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
  const curve = (x1, y1, cx, cy, x2, y2, stroke, sw, opacity) =>
    items.push({ type: "path", d: `M${f(x1)} ${f(y1)} Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`, fill: "none", stroke, strokeWidth: sw, opacity });
  const dot = (x, y, r, fill, opacity = 1) => items.push({ type: "path", d: circlePath(x, y, r), fill, opacity });
  const ell = (x, y, rx, ry, fill, opacity) => items.push({ type: "path",
    d: `M${f(x + rx)} ${f(y)} A${f(rx)} ${f(ry)} 0 1 1 ${f(x - rx)} ${f(y)} A${f(rx)} ${f(ry)} 0 1 1 ${f(x + rx)} ${f(y)} Z`, fill, opacity });
  // a square tile with a bevel: light top/left edge, dark bottom/right edge
  const tile = (x, y, s, fill, grout) => {
    rect(x, y, s, s, fill);
    line(x + s * 0.06, y + s * 0.06, x + s * 0.94, y + s * 0.06, lighten(fill, 0.35), s * 0.03, 0.8);
    line(x + s * 0.06, y + s * 0.06, x + s * 0.06, y + s * 0.94, lighten(fill, 0.25), s * 0.03, 0.7);
    line(x + s * 0.06, y + s * 0.94, x + s * 0.94, y + s * 0.94, darken(fill, 0.18), s * 0.03, 0.7);
    line(x + s * 0.94, y + s * 0.06, x + s * 0.94, y + s * 0.94, darken(fill, 0.18), s * 0.03, 0.7);
    line(x, y, x + s, y, grout, s * 0.05); line(x, y, x, y + s, grout, s * 0.05);
  };
  const r = rng(id);
  let w, h, rotation = 0;
  switch (spec.floor) {
    case "wood_planks": {
      const pw = M(0.2), pl = M(1.4);
      w = pl; h = pw * 4;
      const shades = [c, darken(c, 0.07), lighten(c, 0.06), darken(c, 0.12)];
      [0, 0.5, 0.25, 0.75].forEach((o, row) => {
        for (const x0 of [o * pl - pl, o * pl]) {
          const y0 = row * pw, sh = shades[row];
          rect(x0, y0, pl, pw, sh, { stroke: darken(c, 0.3), strokeWidth: pw * 0.045 });
          for (let k = 1; k <= 2; k++) {
            const yy = y0 + (pw * k) / 3 + (r() - 0.5) * pw * 0.1;
            curve(x0 + pl * 0.04, yy, x0 + pl * 0.5, yy + (r() - 0.5) * pw * 0.35, x0 + pl * 0.96, yy, darken(sh, 0.22), pw * 0.025, 0.55);
          }
          if (r() < 0.35) ell(x0 + pl * (0.2 + r() * 0.6), y0 + pw * 0.5, pw * 0.16, pw * 0.08, darken(sh, 0.3), 0.6);
          line(x0, y0 + pw * 0.04, x0 + pl, y0 + pw * 0.04, lighten(sh, 0.18), pw * 0.03, 0.6);
        }
      });
      rotation = -45;
      break;
    }
    case "terrace_deck": {
      const pw = M(0.14);
      w = M(2); h = pw * 2;
      for (const [y0, sh] of [[0, c], [pw, darken(c, 0.06)]]) {
        rect(0, y0, w, pw, sh, { stroke: darken(c, 0.4), strokeWidth: pw * 0.14 });
        curve(w * 0.02, y0 + pw * 0.5, w * 0.5, y0 + pw * 0.35, w * 0.98, y0 + pw * 0.55, darken(sh, 0.2), pw * 0.04, 0.6);
        line(0, y0 + pw * 0.12, w, y0 + pw * 0.12, lighten(sh, 0.2), pw * 0.04, 0.6);
        for (const x of [w * 0.1, w * 0.9]) { dot(x, y0 + pw * 0.3, pw * 0.05, darken(c, 0.5)); dot(x, y0 + pw * 0.7, pw * 0.05, darken(c, 0.5)); }
      }
      break;
    }
    case "wood_herringbone": {
      const s = M(0.28), t = s * 0.45;
      w = 2 * s; h = 2 * t;
      for (let k = -4; k <= 4; k++) {
        const y = k * t, f1 = k % 2 ? darken(c, 0.1) : lighten(c, 0.05), f2 = k % 2 ? lighten(c, 0.05) : darken(c, 0.1);
        const st = { stroke: darken(c, 0.32), strokeWidth: t * 0.06 };
        items.push({ type: "path", d: `M0 ${f(y)} L${f(s)} ${f(y - s * 0.6)} L${f(s)} ${f(y - s * 0.6 + t)} L0 ${f(y + t)} Z`, fill: f1, ...st });
        items.push({ type: "path", d: `M${f(s)} ${f(y - s * 0.6)} L${f(2 * s)} ${f(y)} L${f(2 * s)} ${f(y + t)} L${f(s)} ${f(y - s * 0.6 + t)} Z`, fill: f2, ...st });
        line(s * 0.1, y + t * 0.45 - s * 0.06, s * 0.9, y + t * 0.45 - s * 0.54, darken(f1, 0.18), t * 0.05, 0.5);
        line(s * 1.1, y + t * 0.45 - s * 0.54, s * 1.9, y + t * 0.45 - s * 0.06, darken(f2, 0.18), t * 0.05, 0.5);
      }
      break;
    }
    case "wood_wide_planks": {
      const pw = M(0.3), pl = M(2.2);
      w = pl; h = pw * 4;
      const shades = [c, lighten(c, 0.05), darken(c, 0.06), lighten(c, 0.02)];
      [0, 0.4, 0.75, 0.2].forEach((o, row) => {
        for (const x0 of [o * pl - pl, o * pl]) {
          const y0 = row * pw, sh = shades[row];
          rect(x0, y0, pl, pw, sh, { stroke: darken(c, 0.32), strokeWidth: pw * 0.035 });
          for (let k = 1; k <= 3; k++) {
            const yy = y0 + (pw * k) / 4 + (r() - 0.5) * pw * 0.08;
            curve(x0 + pl * 0.03, yy, x0 + pl * (0.3 + r() * 0.4), yy + (r() - 0.5) * pw * 0.3, x0 + pl * 0.97, yy, darken(sh, 0.18), pw * 0.02, 0.5);
          }
          if (r() < 0.5) ell(x0 + pl * (0.15 + r() * 0.7), y0 + pw * (0.3 + r() * 0.4), pw * 0.12, pw * 0.06, darken(sh, 0.3), 0.55);
        }
      });
      break;
    }
    case "wood_chevron": {
      const s2 = M(0.3), t = s2 * 0.42, rise = s2 * 0.95;
      w = 2 * s2; h = 2 * t;
      for (let k = -6; k <= 6; k++) {
        const y = k * t, fill = k % 2 ? darken(c, 0.09) : lighten(c, 0.06), st = { stroke: darken(c, 0.32), strokeWidth: t * 0.06 };
        items.push({ type: "path", d: `M0 ${f(y)} L${f(s2)} ${f(y - rise)} L${f(s2)} ${f(y - rise + t)} L0 ${f(y + t)} Z`, fill, ...st });
        items.push({ type: "path", d: `M${f(s2)} ${f(y - rise)} L${f(2 * s2)} ${f(y)} L${f(2 * s2)} ${f(y + t)} L${f(s2)} ${f(y - rise + t)} Z`, fill, ...st });
        line(s2 * 0.15, y + t * 0.5 - rise * 0.15, s2 * 0.85, y + t * 0.5 - rise * 0.85, darken(fill, 0.15), t * 0.05, 0.45);
      }
      rotation = 90;
      break;
    }
    case "wood_basketweave": {
      const q = M(0.24), n = 3, st = q / n;
      w = h = 2 * q;
      [[0, 0, "v"], [q, q, "v"], [q, 0, "h"], [0, q, "h"]].forEach(([x0, y0, dir], i) => {
        for (let k = 0; k < n; k++) {
          const sh = [c, darken(c, 0.07), lighten(c, 0.05)][(k + i) % 3];
          if (dir === "v") rect(x0 + k * st, y0, st, q, sh, { stroke: darken(c, 0.3), strokeWidth: st * 0.06 });
          else rect(x0, y0 + k * st, q, st, sh, { stroke: darken(c, 0.3), strokeWidth: st * 0.06 });
        }
      });
      rotation = 45;
      break;
    }
    case "tile_checker": {
      const ts = M(0.3), b = a || "#F7F3EE", grout = darken(b, 0.18);
      w = h = 2 * ts;
      tile(0, 0, ts, c, grout); tile(ts, 0, ts, b, grout); tile(0, ts, ts, b, grout); tile(ts, ts, ts, c, grout);
      break;
    }
    case "tile_square": {
      const ts = M(0.3);
      w = h = 2 * ts;
      const fills = [c, darken(c, 0.04), lighten(c, 0.04), c];
      [[0, 0], [ts, 0], [0, ts], [ts, ts]].forEach(([x, y], i) => tile(x, y, ts, a && i % 3 === 0 ? mix(c, a, 0.35) : fills[i], darken(c, 0.2)));
      break;
    }
    case "stone": {
      const ts = M(0.4);
      w = 2 * ts; h = 2 * ts;
      rect(0, 0, w, h, darken(c, 0.25));
      for (const [x, y, ww] of [[0, 0, ts], [ts, 0, ts], [-ts / 2, ts, ts], [ts / 2, ts, ts], [1.5 * ts, ts, ts]]) {
        const sh = mix(c, r() < 0.5 ? "#FFFFFF" : "#8B7E6A", 0.08 + r() * 0.1), g = ts * 0.05;
        items.push({ type: "path", d: `M${f(x + g)} ${f(y + g)} h${f(ww - 2 * g)} v${f(ts - 2 * g)} h${f(-(ww - 2 * g))} Z`, fill: sh });
        line(x + g, y + g, x + ww - g, y + g, lighten(sh, 0.3), g * 0.6, 0.7);
        line(x + g, y + ts - g, x + ww - g, y + ts - g, darken(sh, 0.2), g * 0.6, 0.6);
        for (let k = 0; k < 3; k++) dot(x + g + r() * (ww - 2 * g), y + g + r() * (ts - 2 * g), ts * 0.015, darken(sh, 0.3), 0.4);
      }
      break;
    }
    case "marble": {
      w = h = M(1.2);
      rect(0, 0, w, h, c);
      const v = darken(c, 0.22);
      for (let k = 0; k < 4; k++) {
        const y0 = r() * h, y1 = r() * h;
        items.push({ type: "path", d: `M0 ${f(y0)} Q${f(w * 0.3)} ${f(r() * h)} ${f(w * 0.55)} ${f((y0 + y1) / 2)} T${f(w)} ${f(y1)}`,
          fill: "none", stroke: v, strokeWidth: w * (0.002 + r() * 0.004), opacity: 0.35 + r() * 0.3 });
      }
      line(w * 0.5, 0, w * 0.5, h, darken(c, 0.1), w * 0.004, 0.6); line(0, h * 0.5, w, h * 0.5, darken(c, 0.1), w * 0.004, 0.6);
      line(0, 0, w, 0, lighten(c, 0.5), w * 0.004, 0.8);
      break;
    }
    case "carpet": {
      w = h = M(0.2);
      rect(0, 0, w, h, c);
      line(0, h, w, 0, lighten(c, 0.12), w * 0.05, 0.45);
      line(0, 0, w, h, darken(c, 0.1), w * 0.03, 0.3);
      dot(w * 0.25, h * 0.25, w * 0.04, lighten(c, 0.2), 0.4);
      break;
    }
    case "grass": {
      w = h = M(0.6);
      rect(0, 0, w, h, c);
      for (let i = 0; i < 26; i++) {
        const x = r() * w, y = r() * h, l = M(0.06) * (0.6 + r());
        line(x, y, x + l * (r() - 0.5) * 0.6, y - l, i % 3 ? darken(c, 0.15) : lighten(c, 0.2), M(0.012));
      }
      break;
    }
    case "terrazzo": case "concrete": default: {
      const kind = spec.floor || "concrete";
      w = h = M(0.6);
      rect(0, 0, w, h, c);
      const colors = kind === "terrazzo" ? [a || "#E07A5F", "#3D405B", "#81B29A", "#F2CC8F", "#FFFFFF"] : [darken(c, 0.15), lighten(c, 0.15)];
      for (let i = 0; i < (kind === "terrazzo" ? 26 : 30); i++) {
        if (kind === "terrazzo") {
          const x = r() * w, y = r() * h, s = M(0.018) * (0.6 + r());
          items.push({ type: "path", d: `M${f(x)} ${f(y - s)} L${f(x + s)} ${f(y + s * 0.3)} L${f(x - s * 0.6)} ${f(y + s)} Z`, fill: colors[i % colors.length], opacity: 0.9 });
        } else dot(r() * w, r() * h, M(0.008) * (0.5 + r()), colors[i % colors.length], 0.35);
      }
    }
  }
  return { type: "pattern", id, width: w, height: h, rotation, items };
}

// ------------------------------------------------------------------ furniture symbols
function materialColor(theme, ap, fallback) {
  return ap?.color || theme.materials[ap?.material] || fallback;
}
const WOODS = new Set(["wood", "wood_light", "wood_dark"]);
const CANOPY = new Set(["pergola", "palm_tree"]);

/** Shared helpers for symbols drawn in a box's local frame. */
function kit(box, ref, layer, ctx) {
  const { push, u, grad, softShadow } = ctx;
  const p = painter(box);
  const out = (d, fill, e = {}) => push({ type: "path", d, fill, stroke: e.stroke ?? "none", strokeWidth: e.strokeWidth ?? 0, effect: e.effect,
    opacity: e.opacity, dash: e.dash, linecap: e.linecap, layer: e.layer || layer, ref });
  const shadow = (d, s = 1) => softShadow(d, layer, ref, s);
  const edge = (c, k = 0.35) => ({ stroke: darken(c, k), strokeWidth: u * 0.12 });
  const lineOut = (d, c, sw, opacity) => out(d, "none", { stroke: c, strokeWidth: sw, opacity, linecap: "round" });
  // fine wood grain along the longer axis of a local rectangle
  const grain = (c, x, y, ww, hh) => {
    const horiz = ww >= hh, across = horiz ? hh : ww, n = Math.max(3, Math.round(across / (u * 0.8)));
    for (let i = 1; i < n; i++) {
      const t = i / n, wob = (i % 2 ? 1 : -1) * across * 0.03;
      const d = horiz
        ? p.raw((P) => `M${P(x + ww * 0.04, y + hh * t)} Q${P(x + ww * 0.3, y + hh * t + wob)} ${P(x + ww * 0.55, y + hh * t)} Q${P(x + ww * 0.8, y + hh * t - wob)} ${P(x + ww * 0.96, y + hh * t)}`)
        : p.raw((P) => `M${P(x + ww * t, y + hh * 0.04)} Q${P(x + ww * t + wob, y + hh * 0.3)} ${P(x + ww * t, y + hh * 0.55)} Q${P(x + ww * t - wob, y + hh * 0.8)} ${P(x + ww * t, y + hh * 0.96)}`);
      out(d, "none", { stroke: darken(c, 0.25), strokeWidth: u * 0.06, opacity: 0.4 });
    }
  };
  return { p, out, shadow, edge, lineOut, grain, grad, u };
}

function drawFixture(fx, ctx) {
  const { theme, M, u, grad } = ctx;
  const box = boxOf(fx.shape), ap = fx.appearance || {};
  const { w, h } = box;
  const ref = { type: "fixture", id: fx.id };
  const layer = CANOPY.has(fx.kind) ? "canopy" : "fixtures";
  const { p, out, shadow, edge, lineOut, grain } = kit(box, ref, layer, ctx);
  const rr = Math.min(w, h) * 0.08;
  const st = ctx.stateOf(fx), on = st.power === "on", lvl = st.level;
  const body = (c, r = rr) => { const d = p.rect(-w / 2, -h / 2, w, h, r); shadow(d); out(d, grad(c), edge(c)); };
  const roundBody = (c) => { const d = p.ellipse(0, 0, w / 2, h / 2); shadow(d); out(d, grad(c, "rad"), edge(c)); };
  const metalLines = (c, n = 5) => { for (let i = 1; i < n; i++) lineOut(p.line(-w * 0.45, -h / 2 + (h * i) / n, w * 0.45, -h / 2 + (h * i) / n), lighten(c, 0.35), u * 0.05, 0.35); };

  if (box.free) {
    const base = { bar_counter: theme.materials.wood_dark, prep_counter: theme.materials.metal, rug: "#C2185B" }[fx.kind] || theme.materials.wood_light;
    const c = materialColor(theme, ap, base), d = shapeToPath(fx.shape);
    if (fx.kind !== "rug") shadow(d);
    out(d, grad(c), edge(c));
    if (fx.kind === "bar_counter" || fx.kind === "counter") {
      out(d, "none", { stroke: lighten(c, 0.3), strokeWidth: u * 0.6, opacity: 0.5 });
      out(d, "none", { stroke: "#C9A227", strokeWidth: u * 0.18, opacity: 0.8 });
    }
    return;
  }

  switch (fx.kind) {
    case "tree": {
      const leaf = ap.color || "#4F8A3C", r = Math.min(w, h) / 2, rnd = rng(fx.id), lobes = 10;
      const canopy = p.raw((P) => {
        let d = "";
        for (let i = 0; i <= lobes; i++) {
          const a = (i / lobes) * Math.PI * 2, rr2 = r * (0.86 + rnd() * 0.14);
          const am = ((i - 0.5) / lobes) * Math.PI * 2;
          d += i === 0 ? `M${P(Math.cos(a) * rr2, Math.sin(a) * rr2)}` : ` Q${P(Math.cos(am) * r * 1.12, Math.sin(am) * r * 1.12)} ${P(Math.cos(a) * rr2, Math.sin(a) * rr2)}`;
        }
        return d + " Z";
      });
      shadow(canopy, 1.3);
      out(canopy, grad(leaf, "rad"), { stroke: darken(leaf, 0.3), strokeWidth: u * 0.2 });
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2, d0 = r * 0.55 * rnd(), rr2 = r * (0.18 + rnd() * 0.2);
        out(p.circle(Math.cos(a) * d0, Math.sin(a) * d0, rr2), grad(i % 2 ? lighten(leaf, 0.12) : darken(leaf, 0.06), "rad"), { opacity: 0.9 });
      }
      out(p.circle(-r * 0.28, -r * 0.32, r * 0.2), lighten(leaf, 0.35), { opacity: 0.45 });
      break;
    }
    case "palm_tree": {
      const r = Math.min(w, h) / 2, leaf = ap.color || "#3F8F3A", rnd = rng(fx.id), n = 9;
      shadow(p.circle(0, 0, r * 0.8), 0.9);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3, len = r * (0.82 + rnd() * 0.18), bend = (rnd() - 0.5) * 0.6;
        const dir = [Math.cos(a), Math.sin(a)], perp = [-dir[1], dir[0]], m = 12;
        const rib = [], left = [], right = [];
        for (let k = 0; k <= m; k++) {
          const t = k / m, along = len * t, side = bend * len * t * t;
          const c0 = [dir[0] * along + perp[0] * side, dir[1] * along + perp[1] * side];
          const wid = len * 0.17 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - 0.25 * t) * (k % 2 ? 1 : 0.6);
          rib.push(c0);
          left.push([c0[0] + perp[0] * wid, c0[1] + perp[1] * wid]);
          right.push([c0[0] - perp[0] * wid, c0[1] - perp[1] * wid]);
        }
        const c = i % 2 ? leaf : lighten(leaf, 0.12);
        out(p.poly([...left, ...right.reverse()]), grad(c), { stroke: darken(leaf, 0.32), strokeWidth: u * 0.07 });
        out(p.poly(rib, false), "none", { stroke: darken(leaf, 0.35), strokeWidth: u * 0.12 });
      }
      out(p.circle(0, 0, r * 0.13), grad("#7A5533", "rad"), { stroke: "#4E331C", strokeWidth: u * 0.1 });
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4; out(p.circle(Math.cos(a) * r * 0.13, Math.sin(a) * r * 0.13, r * 0.06), "#5B3A22"); }
      break;
    }
    case "pergola": {
      const metalRoof = ["metal", "aluminium"].includes(ap.material);
      const roof = ap.roof || (metalRoof ? "louvered" : "slatted");
      const long = w >= h, L = long ? w : h, S = long ? h : w;
      const R = (a, b, la, lb) => (long ? p.rect(a, b, la, lb, 0) : p.rect(b, a, lb, la, 0));   // a runs along the long axis
      const LN = (a1, b1, a2, b2) => (long ? p.line(a1, b1, a2, b2) : p.line(b1, a1, b2, a2));
      if (roof === "slatted") {
        const c = materialColor(theme, ap, theme.materials.wood);
        const post = Math.max(M(0.16), u * 0.8), beam = Math.max(M(0.14), u * 0.6), slat = Math.max(M(0.07), u * 0.35), gap = Math.max(M(0.4), u * 2);
        const slats = [];
        for (let x = -L / 2 + gap / 2; x < L / 2; x += gap) slats.push(R(x - slat / 2, -S / 2 - beam * 0.6, slat, S + beam * 1.2));
        for (const d of slats) out(translatePath(d, u * 1.6, u * 2.1), theme.shadow, { opacity: 0.13 });
        for (const side of [-1, 1]) {
          const d = R(-L / 2, side < 0 ? -S / 2 : S / 2 - beam, L, beam);
          out(translatePath(d, u * 1.6, u * 2.1), theme.shadow, { opacity: 0.15 });
          out(d, grad(darken(c, 0.08)), edge(c));
        }
        for (const d of slats) out(d, grad(c), { stroke: darken(c, 0.35), strokeWidth: u * 0.08, opacity: 0.95 });
        const posts = Math.max(2, Math.ceil(L / M(3)) + 1);
        for (let i = 0; i < posts; i++) {
          const x = -L / 2 + post / 2 + ((L - post) * i) / (posts - 1);
          for (const side of [-1, 1]) out(R(x - post / 2, side < 0 ? -S / 2 - post * 0.1 : S / 2 - post * 0.9, post, post), grad(darken(c, 0.25)), edge(c, 0.5));
        }
        if (ap.accentColor) {
          const vr = rng(fx.id);
          for (let x = -L / 2 + gap; x < L / 2 - gap / 2; x += gap * 1.7) {
            for (const side of [-1, 1]) {
              const pt = long ? [x + (vr() - 0.5) * gap, side * (S / 2 - beam / 2)] : [side * (S / 2 - beam / 2), x + (vr() - 0.5) * gap];
              drawLeaves(p, pt[0], pt[1], Math.max(M(0.35), u * 1.8), ap.accentColor, out, fx.id + x + side, 6);
            }
          }
        }
        break;
      }
      // framed pergola (aluminium bioclimatic, glass, fabric or solid roof)
      const frame = ap.color || (metalRoof || roof === "louvered" ? "#BCA986" : theme.materials.wood);
      const roofC = ap.accentColor || { louvered: "#4A4F55", glass: "#BFE8F2", fabric: "#E9E1D0", solid: "#5A5F66" }[roof] || "#4A4F55";
      const op = theme.canopyOpacity ?? 0.62, openness = ctx.stateOf(fx).open;
      const beam = Math.max(M(0.2), u * 0.9), post = Math.max(M(0.16), u * 0.85);
      const bays = Math.max(1, Math.round(L / M(4.2))), bayL = L / bays;
      out(translatePath(R(-L / 2, -S / 2, L, S), u * 1.8, u * 2.4), theme.shadow, { opacity: 0.12 });
      for (let b = 0; b < bays; b++) {
        const x0 = -L / 2 + b * bayL + beam / 2 + (b === 0 ? beam / 2 : 0), x1 = -L / 2 + (b + 1) * bayL - beam / 2 - (b === bays - 1 ? beam / 2 : 0);
        const y0 = -S / 2 + beam, y1 = S / 2 - beam;
        if (roof === "louvered") {
          // open louvers turn edge-on: thinner blades with sky between them
          const pitch = Math.max(M(0.2), u * 0.9), n = Math.max(2, Math.round((x1 - x0) / pitch)), step = (x1 - x0) / n;
          const bw = step * 0.94 * (1 - 0.8 * openness), bop = op * (1 - 0.3 * openness);
          for (let i = 0; i < n; i++) {
            const x = x0 + i * step + (step * 0.94 - bw) / 2;
            out(R(x, y0, bw, y1 - y0), grad(roofC), { opacity: bop });
            out(LN(x + bw * 0.15, y0, x + bw * 0.15, y1), "none", { stroke: lighten(roofC, 0.45), strokeWidth: u * 0.08, opacity: bop * 0.8 });
            if (openness < 0.6) out(LN(x + bw * 0.9, y0, x + bw * 0.9, y1), "none", { stroke: darken(roofC, 0.4), strokeWidth: u * 0.06, opacity: bop * 0.8 });
          }
        } else if (roof === "glass") {
          out(R(x0, y0, x1 - x0, y1 - y0), roofC, { opacity: 0.3 });
          for (let x = x0 + M(1); x < x1 - M(0.2); x += M(1)) out(LN(x, y0, x, y1), "none", { stroke: frame, strokeWidth: u * 0.25 });
          out(LN(x0 + (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.15, x0 + (x1 - x0) * 0.35, y0 + (y1 - y0) * 0.15), "none", { stroke: "#FFFFFF", strokeWidth: u * 0.3, opacity: 0.6 });
        } else if (roof === "fabric") {
          // a retractable awning: the open part folds into a bundle at the far end of each bay
          const sw = Math.max(M(0.35), u * 1.5), end = x0 + (x1 - x0) * (1 - openness);
          let k = 0;
          for (let x = x0; x < end; x += sw, k++) out(R(x, y0, Math.min(sw, end - x), y1 - y0), k % 2 ? grad(roofC) : grad(lighten(roofC, 0.3)), { opacity: op + 0.1 });
          if (openness > 0.02) out(R(Math.max(x0, end - u * 0.4), y0, Math.min(x1 - x0, u * 1.6), y1 - y0), grad(darken(roofC, 0.15)), { stroke: darken(roofC, 0.4), strokeWidth: u * 0.1 });
        } else {
          out(R(x0, y0, x1 - x0, y1 - y0), grad(roofC), { opacity: op + 0.15 });
        }
      }
      const fe = { stroke: darken(frame, 0.35), strokeWidth: u * 0.12 };
      for (const side of [-1, 1]) {
        out(R(-L / 2, side < 0 ? -S / 2 : S / 2 - beam, L, beam), grad(frame), fe);
        out(R(side < 0 ? -L / 2 : L / 2 - beam, -S / 2, beam, S), grad(frame), fe);
      }
      for (let b = 1; b < bays; b++) out(R(-L / 2 + b * bayL - beam / 2, -S / 2, beam, S), grad(darken(frame, 0.05)), fe);
      for (let b = 0; b <= bays; b++) {
        const x = Math.min(L / 2 - post, Math.max(-L / 2, -L / 2 + b * bayL - post / 2));
        for (const side of [-1, 1]) out(R(x, side < 0 ? -S / 2 : S / 2 - post, post, post), grad(darken(frame, 0.2)), { stroke: darken(frame, 0.5), strokeWidth: u * 0.1 });
      }
      out(LN(-L / 2 + beam * 0.3, -S / 2 + beam * 0.3, L / 2 - beam * 0.3, -S / 2 + beam * 0.3), "none", { stroke: lighten(frame, 0.35), strokeWidth: u * 0.12, opacity: 0.8 });
      break;
    }
    case "parasol": {
      const style = ap.style || "classic";
      const c = ap.color || "#E9E4D8", c2 = ap.accentColor || "#D35D47";
      const square = fx.shape.kind === "rect";
      const rx = w / 2, ry = h / 2;
      // outline vertices: a polygon for square/rectangular canopies, a many-sided circle/oval otherwise
      const n = square ? 8 : style === "scalloped" ? 10 : 8;
      const vtx = [];
      if (square) {
        for (const [x, y] of [[-rx, -ry], [0, -ry], [rx, -ry], [rx, 0], [rx, ry], [0, ry], [-rx, ry], [-rx, 0]]) vtx.push([x, y]);
      } else for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; vtx.push([Math.cos(a) * rx, Math.sin(a) * ry]); }
      const outline = p.poly(vtx);
      shadow(outline, 1.2);
      if (style === "cantilever") {
        const px = -rx - Math.min(w, h) * 0.18;
        out(p.line(px, 0, -rx * 0.1, 0), "none", { stroke: "#4A4F55", strokeWidth: u * 0.4, linecap: "round" });
        out(p.rect(px - u * 1.2, -u * 1.2, u * 2.4, u * 2.4, u * 0.4), grad("#5B6168"), edge("#5B6168"));
      }
      for (let i = 0; i < vtx.length; i++) {
        const a0 = vtx[i], a1 = vtx[(i + 1) % vtx.length];
        const mid = [(a0[0] + a1[0]) / 2 * 0.93, (a0[1] + a1[1]) / 2 * 0.93];
        const d = p.raw((P) => `M${P(0, 0)} L${P(a0[0], a0[1])} Q${P(mid[0], mid[1])} ${P(a1[0], a1[1])} Z`);
        const fill = style === "solid" ? c : i % 2 ? c : c2;
        out(d, grad(fill), { stroke: darken(style === "solid" ? c : c2, 0.25), strokeWidth: u * 0.1, opacity: 0.95 });
      }
      if (style === "striped") {
        for (const k of [0.72, 0.42]) out(p.poly(vtx.map(([x, y]) => [x * k, y * k])), "none", { stroke: c2, strokeWidth: Math.min(w, h) * 0.05, opacity: 0.85 });
      }
      if (style === "scalloped") {
        for (let i = 0; i < vtx.length; i++) {
          const a0 = vtx[i], a1 = vtx[(i + 1) % vtx.length], m = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
          const rr2 = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) * 0.28;
          out(p.circle(m[0] * 1.02, m[1] * 1.02, rr2), grad(c2), { stroke: darken(c2, 0.3), strokeWidth: u * 0.08 });
        }
      }
      for (const [x, y] of vtx) out(p.line(0, 0, x * 0.97, y * 0.97), "none", { stroke: darken(c, 0.35), strokeWidth: u * 0.08, opacity: 0.55 });
      out(p.circle(0, 0, Math.min(w, h) * 0.06), grad("#6B5444", "rad"));
      break;
    }
    case "counter": case "prep_counter": case "bar_counter": {
      const c = materialColor(theme, ap, fx.kind === "prep_counter" ? theme.materials.metal : fx.kind === "bar_counter" ? theme.materials.wood_dark : theme.materials.wood_light);
      body(c, rr * 0.5);
      const top = lighten(c, fx.kind === "bar_counter" ? 0.18 : 0.1);
      out(p.rect(-w / 2 + w * 0.02, -h / 2 + h * 0.08, w * 0.96, h * 0.55, rr * 0.3), grad(top));
      if (fx.kind === "prep_counter") { metalLines(c, 6); for (let i = 1; i < 4; i++) lineOut(p.line(-w / 2 + (w * i) / 4, -h / 2, -w / 2 + (w * i) / 4, h / 2), darken(c, 0.2), u * 0.1); }
      else if (WOODS.has(ap.material) || !ap.material) grain(top, -w / 2 + w * 0.02, -h / 2 + h * 0.08, w * 0.96, h * 0.55);
      if (fx.kind === "bar_counter") lineOut(p.line(-w / 2 + w * 0.02, h / 2 + u * 0.5, w / 2 - w * 0.02, h / 2 + u * 0.5), "#C9A227", u * 0.35);
      break;
    }
    case "sofa": case "armchair": {
      const style = ap.style || "classic";
      const base = { chesterfield: "#6B2E1F", modern: "#5B6770", scandinavian: "#B9C4B0", classic: fx.kind === "sofa" ? "#C0504D" : "#D9776E" }[style] || "#C0504D";
      const c = ap.color || base, cush = ap.accentColor || lighten(c, 0.15);
      const P = { chesterfield: [0.16, 0.3, 0.5], modern: [0.07, 0.22, 0.12], scandinavian: [0.08, 0.24, 0.2], classic: [0.12, 0.3, 0.35] }[style] || [0.12, 0.3, 0.35];
      const arm = Math.min(w * P[0], h * 0.3), back = h * P[1], ar = arm * P[2] * 2;
      if (style === "scandinavian") {
        const wood = theme.materials.wood_light;
        const d = p.rect(-w / 2, -h / 2, w, h, rr);
        shadow(d); out(d, grad(wood), edge(wood));
        for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out(p.circle(x * (w / 2 - u * 0.4), y * (h / 2 - u * 0.4), u * 0.3), darken(wood, 0.35));
        out(p.rect(-w / 2 + arm, -h / 2 + u * 0.4, w - 2 * arm, back - u * 0.4, rr), grad(darken(c, 0.12)));
      } else {
        body(darken(c, 0.05), rr * 1.5);
        out(p.rect(-w / 2, -h / 2, w, back, Math.max(rr, ar * 0.5)), grad(darken(c, 0.15)));
        out(p.rect(-w / 2, -h / 2, arm, h, ar), grad(darken(c, 0.1))); out(p.rect(w / 2 - arm, -h / 2, arm, h, ar), grad(darken(c, 0.1)));
        if (style === "chesterfield" || style === "classic") for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2]) out(p.line(x, -h / 2 + back * 0.5, x, h / 2 - arm * 0.4), "none", { stroke: lighten(c, 0.2), strokeWidth: u * 0.1, opacity: 0.6 });
      }
      const n = fx.kind === "armchair" ? 1 : Math.max(1, Math.round((w - 2 * arm) / (h * 0.7))), cw = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + arm + i * cw + u * 0.2, y = -h / 2 + back + u * 0.1, cw2 = cw - u * 0.4, ch = h - back - u * 0.4;
        out(p.rect(x, y, cw2, ch, style === "modern" ? rr * 0.4 : rr), grad(cush), edge(cush, 0.25));
        if (style === "classic" || style === "scandinavian") out(p.rect(x + cw2 * 0.12, y + ch * 0.12, cw2 * 0.76, ch * 0.76, rr), "none", { stroke: darken(cush, 0.15), strokeWidth: u * 0.06, dash: [u * 0.3, u * 0.3], opacity: 0.7 });
      }
      if (style === "chesterfield") {
        const cols = Math.max(3, Math.round(w / (u * 2.2)));
        for (let i = 1; i < cols; i++) for (const yy of [-h / 2 + back * 0.35, -h / 2 + back * 0.75]) out(p.circle(-w / 2 + (w * i) / cols, yy, u * 0.18), darken(c, 0.4));
        for (let i = 0; i < n; i++) { const x = -w / 2 + arm + (i + 0.5) * cw; out(p.circle(x, -h / 2 + back + (h - back) * 0.45, u * 0.18), darken(cush, 0.4)); }
      }
      break;
    }
    case "corner_sofa": {
      const c = ap.color || "#4F6D7A", cush = ap.accentColor || lighten(c, 0.15);
      const b = Math.min(w, h) * 0.2, d = Math.min(w, h) * 0.42, arm = b * 0.8;
      const L = p.poly([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, -h / 2 + b + d], [-w / 2 + b + d, -h / 2 + b + d], [-w / 2 + b + d, h / 2], [-w / 2, h / 2]]);
      shadow(L); out(L, grad(darken(c, 0.05)), edge(c));
      out(p.rect(-w / 2, -h / 2, w, b, rr), grad(darken(c, 0.18))); out(p.rect(-w / 2, -h / 2, b, h, rr), grad(darken(c, 0.18)));
      out(p.rect(w / 2 - arm, -h / 2, arm, b + d, rr), grad(darken(c, 0.1))); out(p.rect(-w / 2, h / 2 - arm, b + d, arm, rr), grad(darken(c, 0.1)));
      const nTop = Math.max(1, Math.round((w - b - arm) / d)), cwT = (w - b - arm) / nTop;
      for (let i = 0; i < nTop; i++) out(p.rect(-w / 2 + b + i * cwT + u * 0.2, -h / 2 + b + u * 0.2, cwT - u * 0.4, d - u * 0.4, rr), grad(cush), edge(cush, 0.25));
      const nLeft = Math.max(1, Math.round((h - b - d - arm) / d)), chL = (h - b - d - arm) / nLeft;
      for (let i = 0; i < nLeft; i++) out(p.rect(-w / 2 + b + u * 0.2, -h / 2 + b + d + i * chL + u * 0.2, d - u * 0.4, chL - u * 0.4, rr), grad(cush), edge(cush, 0.25));
      break;
    }
    case "lounge_chair": case "pouf": {
      drawSeat(kit({ cx: box.cx, cy: box.cy, rot: box.rot }, ref, layer, ctx), Math.min(w, h) / (fx.kind === "pouf" ? 2.1 : 2.6), fx.kind === "pouf" ? "pouf" : "lounge",
        ap.color || (fx.kind === "pouf" ? "#D8A15B" : "#8E9F8A"));
      break;
    }
    case "bench": {
      const c = materialColor(theme, ap, theme.materials.wood);
      body(darken(c, 0.15), rr * 0.4);
      const long = w >= h, n = Math.max(3, Math.round((long ? h : w) / (u * 0.9)));
      for (let i = 0; i < n; i++) {
        const t2 = -0.5 + (i + 0.5) / n, sl = (long ? h : w) / n * 0.8;
        out(long ? p.rect(-w / 2 + u * 0.2, h * t2 - sl / 2, w - u * 0.4, sl, sl * 0.3) : p.rect(w * t2 - sl / 2, -h / 2 + u * 0.2, sl, h - u * 0.4, sl * 0.3), grad(lighten(c, i % 2 ? 0.04 : 0.1)));
      }
      break;
    }
    case "chair": case "bar_stool": {
      drawSeat(kit({ cx: box.cx, cy: box.cy, rot: box.rot }, ref, layer, ctx), Math.min(w, h) / 2, fx.kind === "bar_stool" ? "stool" : "chair", ap.color || theme.chair);
      break;
    }
    case "plant": case "planter": {
      const pot = ap.accentColor || "#8D5A3B", leaf = ap.color || "#3E8E41";
      if (fx.kind === "planter") {
        body(pot, rr);
        out(p.rect(-w / 2 + u * 0.4, -h / 2 + u * 0.4, w - u * 0.8, h - u * 0.8, rr), "#5A3D2B", { opacity: 0.8 });
        const n = Math.max(2, Math.round(w / h));
        for (let i = 0; i < n; i++) drawLeaves(p, -w / 2 + (w * (i + 0.5)) / n, 0, Math.min(w / n, h) * 0.6, leaf, out, fx.id + i);
      } else {
        const r = Math.min(w, h) / 2;
        shadow(p.circle(0, 0, r * 0.9));
        out(p.circle(0, 0, r * 0.48), grad(pot, "rad"), edge(pot));
        out(p.circle(0, 0, r * 0.38), "#4A3324");
        drawLeaves(p, 0, 0, r, leaf, out, fx.id);
      }
      break;
    }
    case "rug": {
      drawRug(fx, box, { p, out, shadow }, ctx);
      break;
    }
    case "sink": case "hand_sink": {
      const c = materialColor(theme, ap, "#E6E9EC");
      body(c, rr);
      const n = fx.kind === "sink" && w > h * 1.6 ? 2 : fx.kind === "sink" && h > w * 1.6 ? 2 : 1, vert = h > w;
      for (let i = 0; i < n; i++) {
        const x = vert ? 0 : -w / 2 + (w * (i + 0.5)) / n, y = vert ? -h / 2 + (h * (i + 0.5)) / n : h * 0.05;
        const bw = vert ? w * 0.32 : (w / n) * 0.32, bh = vert ? (h / n) * 0.32 : h * 0.3;
        out(p.ellipse(x, y, bw, bh), grad("#B8C2CB", "rad"), { stroke: "#8E9AA5", strokeWidth: u * 0.12 });
        out(p.circle(x, y, Math.min(bw, bh) * 0.12), "#6F7B86");
        out(p.circle(vert ? w * 0.36 : x, vert ? y : -h * 0.36, Math.min(w, h) * 0.06), grad("#C9D1D8", "rad"), { stroke: "#7D8892", strokeWidth: u * 0.06 });
      }
      break;
    }
    case "stove": {
      const c = materialColor(theme, ap, "#3A3F44");
      body(c, rr * 0.5);
      const cols = Math.max(2, Math.round(w / (h / 2))), rows = 2, r = Math.min(w / cols, h / rows) * 0.3;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = -w / 2 + (w * (i + 0.5)) / cols, y = -h / 2 + (h * (j + 0.45)) / rows;
        out(p.circle(x, y, r), "#1E2226", { stroke: "#6B7279", strokeWidth: u * 0.18 });
        if (on) {                                              // lit burner: blue flame ring, orange core, glow
          out(p.circle(x, y, r * 1.6), "url(#ep-glow)", { opacity: 0.5 + 0.5 * lvl, effect: "pulse" });
          out(p.circle(x, y, r * (0.55 + 0.3 * lvl)), "url(#ep-flame)", { effect: "flicker" });
          for (let k = 0; k < 10; k++) {
            const an = (k / 10) * Math.PI * 2, r0 = r * 0.5, r1 = r * (0.62 + 0.25 * lvl);
            out(p.line(x + Math.cos(an) * r0, y + Math.sin(an) * r0, x + Math.cos(an) * r1, y + Math.sin(an) * r1), "none",
              { stroke: "#60A5FA", strokeWidth: u * 0.12, opacity: 0.9, linecap: "round", effect: "flicker" });
          }
        }
        lineOut(p.line(x - r * 0.9, y, x + r * 0.9, y), "#565C63", u * 0.1);
        lineOut(p.line(x, y - r * 0.9, x, y + r * 0.9), "#565C63", u * 0.1);
        out(p.circle(x, h / 2 - h * 0.06, Math.min(r * 0.25, h * 0.04)), "#C9CED3");
      }
      break;
    }
    case "oven": case "dishwasher": case "fridge": case "freezer": {
      const base = { oven: "#5B6168", dishwasher: "#C5CCD2", fridge: "#E9EDF0", freezer: "#DDEBF3" }[fx.kind];
      const c = materialColor(theme, ap, base);
      body(c, rr * 0.5);
      metalLines(c, 7);
      if (fx.kind === "oven") {
        out(p.rect(-w * 0.35, -h * 0.25, w * 0.7, h * 0.45, rr * 0.3), on ? "url(#ep-ember)" : grad("#262A2E"), on ? { effect: "pulse" } : {});
        out(p.rect(-w * 0.3, -h * 0.2, w * 0.25, h * 0.12, u * 0.1), "#FFFFFF", { opacity: 0.12 });
        lineOut(p.line(-w * 0.3, h * 0.32, w * 0.3, h * 0.32), "#D6DADF", u * 0.3);
        for (const x of [-w * 0.3, -w * 0.1, w * 0.1, w * 0.3]) out(p.circle(x, -h * 0.38, Math.min(w, h) * 0.05), "#20242A");
      } else if (fx.kind === "dishwasher") {
        out(p.rect(-w * 0.42, -h * 0.42, w * 0.84, h * 0.12, u * 0.1), "#2A2E33");
        out(p.circle(w * 0.3, -h * 0.36, Math.min(w, h) * 0.03), on ? "#34D399" : "#6B7280");
      } else {
        lineOut(p.line(-w / 2, -h * 0.1, w / 2, -h * 0.1), darken(c, 0.25), u * 0.15);
        lineOut(p.line(w * 0.3, -h * 0.4, w * 0.3, -h * 0.2), "#8A95A0", u * 0.3); lineOut(p.line(w * 0.3, h * 0.05, w * 0.3, h * 0.35), "#8A95A0", u * 0.3);
      }
      break;
    }
    case "coffee_machine": {
      const c = materialColor(theme, ap, "#2F3337");
      body(c, rr);
      out(p.rect(-w * 0.42, -h * 0.42, w * 0.84, h * 0.3, rr * 0.5), grad("#C2C9CF"));
      for (const x of [-w * 0.22, w * 0.22]) {
        out(p.circle(x, h * 0.16, Math.min(w, h) * 0.14), "#FFFFFF", { stroke: "#C9CED3", strokeWidth: u * 0.1 });
        out(p.circle(x, h * 0.16, Math.min(w, h) * 0.08), "#6B3E26");
        if (on) out(p.raw((P) => `M${P(x, h * 0.1)} Q${P(x + u * 0.5, h * 0.1 + u * 0.6)} ${P(x, h * 0.1 + u * 1.2)} T${P(x, h * 0.1 + u * 2.4)}`), "none",
          { stroke: "#FFFFFF", strokeWidth: u * 0.18, opacity: 0.75, linecap: "round", effect: "flow", layer: "canopy" });
      }
      out(p.circle(w * 0.38, -h * 0.36, Math.min(w, h) * 0.05), on ? "#34D399" : "#6B7280");
      break;
    }
    case "display_case": {
      const c = materialColor(theme, ap, "#D8F3F8");
      body(c, rr * 0.5);
      out(p.rect(-w / 2, -h / 2, w, h, rr * 0.5), "none", { stroke: "#8CC7D3", strokeWidth: u * 0.3 });
      const palette = ["#E9A0B3", "#F2C46D", "#9B6A4E", "#F6E7C8", "#B5D99C"], r = rng(fx.id);
      const cols = Math.max(2, Math.round(w / (h * 0.45)));
      for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
        const cc = palette[Math.floor(r() * palette.length)];
        out(p.circle(-w / 2 + (w * (i + 0.5)) / cols, -h / 2 + (h * (j + 0.5)) / 2, Math.min(w / cols, h / 2) * 0.3), grad(cc, "rad"));
      }
      lineOut(p.line(-w * 0.45, -h * 0.4, w * 0.1, -h * 0.4), "#FFFFFF", u * 0.2, 0.7);
      if (on) out(p.rect(-w / 2, -h / 2, w, h, rr * 0.5), "#FFF7D6", { opacity: 0.25 * lvl + 0.1, effect: "pulse" });
      break;
    }
    case "wine_rack": case "shelf": {
      const c = materialColor(theme, ap, fx.kind === "wine_rack" ? theme.materials.wood_dark : theme.materials.wood);
      body(c, rr * 0.4);
      const cols = Math.max(2, Math.round(w / (h * 0.5))), r = rng(fx.id);
      for (let i = 0; i < cols; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / cols;
        if (fx.kind === "wine_rack") {
          out(p.circle(x, 0, Math.min(w / cols, h) * 0.32), grad(i % 2 ? "#5A1A27" : "#2E3B1F", "rad"));
          out(p.circle(x, 0, Math.min(w / cols, h) * 0.12), "#C9A227", { opacity: 0.8 });
        } else out(p.rect(x - (w / cols) * 0.35, -h * 0.3, (w / cols) * 0.7, h * 0.6, u * 0.2), grad(["#E07A5F", "#3D405B", "#81B29A", "#F2CC8F"][Math.floor(r() * 4)]));
      }
      break;
    }
    case "host_stand": case "pos_terminal": case "tv": {
      const c = materialColor(theme, ap, fx.kind === "host_stand" ? theme.materials.wood : "#2A2E33");
      body(c, rr);
      if (fx.kind === "host_stand") {
        grain(c, -w / 2, -h / 2, w, h);
        out(p.rect(-w * 0.25, -h * 0.3, w * 0.4, h * 0.55, u * 0.1), "#FFFFFF");
        for (let i = 1; i < 4; i++) lineOut(p.line(-w * 0.2, -h * 0.3 + h * 0.13 * i, w * 0.1, -h * 0.3 + h * 0.13 * i), "#B0B7BE", u * 0.06);
      } else {
        const lit = on;
        out(p.rect(-w * 0.38, -h * 0.32, w * 0.76, h * 0.5, u * 0.1), lit ? grad(fx.kind === "tv" ? "#4FA3E0" : "#7FD1E8") : grad("#2C333A"), lit ? { effect: "pulse" } : {});
      }
      break;
    }
    case "piano": {
      const c = ap.color || "#16181B";
      const shape = p.raw((P) => `M${P(-w / 2, -h / 2)} L${P(w / 2, -h / 2)} L${P(w / 2, h * 0.05)} ` +
        `Q${P(w / 2, h / 2)} ${P(w * 0.1, h / 2)} Q${P(-w * 0.15, h / 2)} ${P(-w * 0.2, h * 0.2)} Q${P(-w / 2, h * 0.1)} ${P(-w / 2, -h * 0.1)} Z`);
      shadow(shape); out(shape, grad(c), { stroke: "#000000", strokeWidth: u * 0.1 });
      out(p.rect(-w / 2 + u * 0.3, -h / 2 + u * 0.3, w - u * 0.6, h * 0.16, u * 0.1), "#FFFFFF");
      const keys = Math.max(8, Math.round(w / (u * 0.9)));
      for (let i = 1; i < keys; i++) if (i % 7 !== 3 && i % 7 !== 0) out(p.rect(-w / 2 + u * 0.3 + ((w - u * 0.6) * i) / keys - u * 0.12, -h / 2 + u * 0.3, u * 0.24, h * 0.1), "#16181B");
      break;
    }
    case "toilet": case "urinal": {
      if (fx.kind === "urinal") { body("#FFFFFF", Math.min(w, h) * 0.4); out(p.ellipse(0, h * 0.05, w * 0.28, h * 0.25), "#DDEFF5"); break; }
      shadow(p.ellipse(0, h * 0.1, w * 0.4, h * 0.38));
      out(p.rect(-w / 2, -h / 2, w, h * 0.3, u * 0.3), grad("#FFFFFF"), edge("#D5DBE0"));
      out(p.ellipse(0, h * 0.1, w * 0.4, h * 0.38), grad("#FFFFFF", "rad"), edge("#D5DBE0"));
      out(p.ellipse(0, h * 0.12, w * 0.24, h * 0.24), grad("#D6ECF3", "rad"));
      out(p.circle(0, -h * 0.36, Math.min(w, h) * 0.05), "#C9D1D8");
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

const RUG_COLORS = {
  persian: ["#8E1B2B", "#1F2E4D"], kilim: ["#B5442E", "#2F4A6D"], moroccan: ["#F3EDE2", "#2B2B2B"], striped: ["#2E5E7E", "#F2E9DA"],
  geometric: ["#D9A441", "#2F3E46"], shag: ["#D8C9B0", "#B9A68A"], jute: ["#C8A77A", "#8B6B43"], floral: ["#F1E4D0", "#B03A48"],
  bordered: ["#7A8C6E", "#E8E1D0"], abstract: ["#E7DCCB", "#D36A4A"], chevron: ["#2F3E46", "#E8E1D0"], braided: ["#B8864E", "#6E4B2A"],
};

/** Rugs: the field is filled with an SVG pattern (so motifs never leave the rug), borders and medallions are shapes. */
function drawRug(fx, box, k, ctx) {
  const { M, u, grad, addDef } = ctx;
  const { p, out, shadow } = k;
  const ap = fx.appearance || {};
  const style = RUG_COLORS[ap.style] ? ap.style : "bordered";
  const c = ap.color || RUG_COLORS[style][0], a = ap.accentColor || RUG_COLORS[style][1];
  const { w, h } = box, round = !!box.round, min = Math.min(w, h), rnd = rng(fx.id);
  const shapeAt = (inset) => round ? p.ellipse(0, 0, Math.max(0.1, w / 2 - inset), Math.max(0.1, h / 2 - inset))
    : p.rect(-w / 2 + inset, -h / 2 + inset, Math.max(0.1, w - 2 * inset), Math.max(0.1, h - 2 * inset), style === "shag" ? min * 0.08 : min * 0.015);
  const P = (d, fill, e = {}) => ({ type: "path", d, fill, stroke: e.stroke ?? "none", strokeWidth: e.sw ?? 0, opacity: e.op });
  const R = (x, y, ww, hh, fill, e) => P(`M${f(x)} ${f(y)} h${f(ww)} v${f(hh)} h${f(-ww)} Z`, fill, e);
  const C = (x, y, r, fill, e) => P(circlePath(x, y, r), fill, e);
  const Poly = (pts, fill, e) => P(pts.map((q, i) => `${i ? "L" : "M"}${f(q[0])} ${f(q[1])}`).join(" ") + " Z", fill, e);
  const L = (x1, y1, x2, y2, stroke, sw, op) => P(`M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`, "none", { stroke, sw, op });
  const pat = (name, pw, ph, items, extraRot = 0) =>
    addDef({ type: "pattern", id: `ep-rug-${fx.id}-${name}`, width: pw, height: ph, rotation: (box.rot || 0) + extraRot, items });
  const T = Math.max(M(0.22), u * 1.2);
  const border = min * 0.11;
  const outer = shapeAt(0);
  shadow(outer, 0.35);

  // fringe on the short ends of woven rectangular rugs
  if (!round && ["persian", "kilim", "moroccan", "jute", "bordered", "floral"].includes(style)) {
    const alongX = w >= h, len = min * 0.07, step = u * 0.5, span = alongX ? h : w;
    for (const side of [-1, 1]) for (let t = -span / 2 + step / 2; t < span / 2; t += step) {
      out(alongX ? p.line(side * w / 2, t, side * (w / 2 + len), t) : p.line(t, side * h / 2, t, side * (h / 2 + len)), "none",
        { stroke: "#EDE3CF", strokeWidth: u * 0.1, opacity: 0.9 });
    }
  }

  switch (style) {
    case "persian": {
      out(outer, grad(a), { stroke: darken(a, 0.3), strokeWidth: u * 0.1 });
      const field = pat("field", T, T, [R(0, 0, T, T, c),
        Poly([[T / 2, T * 0.15], [T * 0.85, T / 2], [T / 2, T * 0.85], [T * 0.15, T / 2]], "#D8B25A", { op: 0.85 }),
        Poly([[T / 2, T * 0.32], [T * 0.68, T / 2], [T / 2, T * 0.68], [T * 0.32, T / 2]], darken(c, 0.25)),
        C(0, 0, T * 0.07, "#F2E6C9"), C(T, 0, T * 0.07, "#F2E6C9"), C(0, T, T * 0.07, "#F2E6C9"), C(T, T, T * 0.07, "#F2E6C9")]);
      out(shapeAt(border), field);
      out(shapeAt(border * 0.45), "none", { stroke: "#D8B25A", strokeWidth: u * 0.18 });
      out(shapeAt(border), "none", { stroke: "#D8B25A", strokeWidth: u * 0.25 });
      const mw = (w - 2 * border) * 0.32, mh = (h - 2 * border) * 0.32;
      out(p.poly([[0, -mh], [mw, 0], [0, mh], [-mw, 0]]), grad(a), { stroke: "#D8B25A", strokeWidth: u * 0.2 });
      out(p.poly([[0, -mh * 0.62], [mw * 0.62, 0], [0, mh * 0.62], [-mw * 0.62, 0]]), grad(lighten(c, 0.08)), { stroke: "#D8B25A", strokeWidth: u * 0.12 });
      out(p.ellipse(0, 0, mw * 0.2, mh * 0.2), "#D8B25A");
      if (!round) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = sx * (w / 2 - border), cy = sy * (h / 2 - border), q = min * 0.14;
        out(p.poly([[cx, cy], [cx - sx * q, cy], [cx, cy - sy * q]]), a, { stroke: "#D8B25A", strokeWidth: u * 0.1 });
      }
      break;
    }
    case "kilim": {
      const bh = T * 0.5, cols = [c, a, "#E9D8B4", darken(c, 0.2)], items = [];
      cols.forEach((col, i) => items.push(R(0, i * bh, T * 2, bh, col)));
      for (let x = 0; x < T * 2; x += T / 2) {
        items.push(Poly([[x, bh * 1.5], [x + T / 4, bh * 1.05], [x + T / 2, bh * 1.5], [x + T / 4, bh * 1.95]], "#E9D8B4"));
        items.push(Poly([[x, bh * 3.5], [x + T / 4, bh * 3.1], [x + T / 2, bh * 3.5], [x + T / 4, bh * 3.9]], a));
      }
      out(outer, pat("bands", T * 2, bh * 4, items, w >= h ? 90 : 0), { stroke: darken(c, 0.35), strokeWidth: u * 0.15 });
      break;
    }
    case "moroccan": {
      const items = [R(0, 0, T, T * 1.4, c), Poly([[T / 2, 0], [T, T * 0.7], [T / 2, T * 1.4], [0, T * 0.7]], "none", { stroke: a, sw: T * 0.05, op: 0.85 })];
      out(outer, pat("trellis", T, T * 1.4, items), { stroke: darken(c, 0.15), strokeWidth: u * 0.15 });
      break;
    }
    case "striped": {
      const sw = T * 0.6, items = [R(0, 0, sw * 4, sw * 4, c), R(sw, 0, sw * 0.6, sw * 4, a), R(sw * 2.2, 0, sw * 0.25, sw * 4, mix(c, a, 0.5)), R(sw * 3, 0, sw * 0.6, sw * 4, a)];
      out(outer, pat("stripes", sw * 4, sw * 4, items, w >= h ? 0 : 90), { stroke: darken(c, 0.3), strokeWidth: u * 0.12 });
      break;
    }
    case "geometric": {
      const items = [R(0, 0, 2 * T, 2 * T, c), Poly([[0, 0], [T, 0], [0, T]], a), Poly([[T, T], [2 * T, T], [2 * T, 0]], a),
        Poly([[0, T], [T, 2 * T], [0, 2 * T]], mix(c, a, 0.5)), Poly([[T, T], [2 * T, 2 * T], [T, 2 * T]], a)];
      out(shapeAt(0), grad(a));
      out(shapeAt(border * 0.5), pat("tri", 2 * T, 2 * T, items), { stroke: lighten(c, 0.3), strokeWidth: u * 0.12 });
      break;
    }
    case "shag": {
      const tt = T * 0.6, items = [R(0, 0, tt, tt, c)];
      for (let i = 0; i < 40; i++) {
        const x = rnd() * tt, y = rnd() * tt, l = tt * 0.28;
        items.push(L(x, y, x + (rnd() - 0.5) * l, y + (rnd() - 0.5) * l, [darken(c, 0.18), lighten(c, 0.3), a][i % 3], tt * 0.07, 0.9));
      }
      out(outer, pat("pile", tt, tt, items), { stroke: lighten(c, 0.2), strokeWidth: u * 0.35, opacity: 0.95 });
      break;
    }
    case "jute": {
      const tt = T * 0.35, items = [R(0, 0, tt, tt, c)];
      for (let i = 0; i < 3; i++) {
        items.push(L(0, (tt * (i + 0.5)) / 3, tt / 2, (tt * (i + 0.5)) / 3, darken(c, 0.2), tt * 0.08, 0.8));
        items.push(L(tt / 2 + (tt * (i + 0.5)) / 6, 0, tt / 2 + (tt * (i + 0.5)) / 6, tt / 2, darken(c, 0.15), tt * 0.08, 0.8));
        items.push(L((tt * (i + 0.5)) / 6, tt / 2, (tt * (i + 0.5)) / 6, tt, darken(c, 0.15), tt * 0.08, 0.8));
        items.push(L(tt / 2, tt / 2 + (tt * (i + 0.5)) / 6, tt, tt / 2 + (tt * (i + 0.5)) / 6, darken(c, 0.2), tt * 0.08, 0.8));
      }
      out(outer, grad(a));
      out(shapeAt(border * 0.6), pat("weave", tt, tt, items));
      break;
    }
    case "floral": {
      const tt = T * 1.5, items = [R(0, 0, tt, tt, c)];
      for (const [fx2, fy] of [[tt * 0.3, tt * 0.3], [tt * 0.8, tt * 0.8]]) {
        for (let i = 0; i < 5; i++) { const an = (i / 5) * Math.PI * 2; items.push(C(fx2 + Math.cos(an) * tt * 0.07, fy + Math.sin(an) * tt * 0.07, tt * 0.06, a)); }
        items.push(C(fx2, fy, tt * 0.04, "#D8B25A"));
        items.push(P(`M${f(fx2 + tt * 0.1)} ${f(fy + tt * 0.08)} Q${f(fx2 + tt * 0.2)} ${f(fy + tt * 0.05)} ${f(fx2 + tt * 0.24)} ${f(fy + tt * 0.16)} Q${f(fx2 + tt * 0.14)} ${f(fy + tt * 0.18)} ${f(fx2 + tt * 0.1)} ${f(fy + tt * 0.08)} Z`, "#6E9B5A"));
      }
      out(outer, grad(a));
      out(shapeAt(border), pat("flowers", tt, tt, items));
      out(shapeAt(border * 0.5), "none", { stroke: c, strokeWidth: u * 0.18, opacity: 0.9 });
      break;
    }
    case "abstract": {
      out(outer, grad(c), { stroke: darken(c, 0.2), strokeWidth: u * 0.12 });
      const iw = w * 0.32, ih = h * 0.32;
      out(p.ellipse(-iw * 0.6, -ih * 0.3, iw * 0.55, ih * 0.45), a, { opacity: 0.85 });
      out(p.ellipse(iw * 0.7, ih * 0.4, iw * 0.45, ih * 0.55), mix(c, a, 0.4), { opacity: 0.9 });
      out(p.ellipse(iw * 0.2, -ih * 0.6, iw * 0.25, ih * 0.22), "#4E6E6A", { opacity: 0.8 });
      out(p.raw((Pt) => `M${Pt(-w * 0.38, h * 0.3)} Q${Pt(-w * 0.05, -h * 0.1)} ${Pt(w * 0.15, h * 0.2)} T${Pt(w * 0.38, -h * 0.25)}`), "none",
        { stroke: "#2F3E46", strokeWidth: u * 0.25, opacity: 0.7 });
      break;
    }
    case "chevron": {
      const tt = T, items = [R(0, 0, tt, tt, c), Poly([[0, tt * 0.25], [tt / 2, 0], [tt, tt * 0.25], [tt, tt * 0.5], [tt / 2, tt * 0.25], [0, tt * 0.5]], a),
        Poly([[0, tt * 0.75], [tt / 2, tt * 0.5], [tt, tt * 0.75], [tt, tt], [tt / 2, tt * 0.75], [0, tt]], a)];
      out(outer, pat("zigzag", tt, tt, items, w >= h ? 90 : 0), { stroke: darken(c, 0.3), strokeWidth: u * 0.12 });
      break;
    }
    case "braided": {
      const step = Math.max(u * 0.9, min * 0.06), n = Math.max(3, Math.floor(min / 2 / step));
      for (let i = 0; i < n; i++) {
        const d = shapeAt(i * step), col = [c, a, mix(c, a, 0.5)][i % 3];
        out(d, grad(col), { stroke: darken(col, 0.25), strokeWidth: u * 0.08 });
        out(shapeAt(i * step + step * 0.5), "none", { stroke: lighten(col, 0.25), strokeWidth: step * 0.35, dash: [step * 0.5, step * 0.4], opacity: 0.55 });
      }
      break;
    }
    default: { // bordered
      out(outer, grad(a), { stroke: darken(a, 0.3), strokeWidth: u * 0.1 });
      out(shapeAt(border), grad(c));
      out(shapeAt(border * 1.35), "none", { stroke: lighten(c, 0.35), strokeWidth: u * 0.15, opacity: 0.8 });
    }
  }
}

function drawLeaves(p, x, y, r, leaf, out, seed, count = 8) {
  const rnd = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.4, len = r * (0.75 + rnd() * 0.25);
    const lx = x + Math.cos(a) * len * 0.55, ly = y + Math.sin(a) * len * 0.55;
    const tip = [x + Math.cos(a) * len, y + Math.sin(a) * len], side = [-Math.sin(a) * len * 0.22, Math.cos(a) * len * 0.22];
    out(p.raw((P) => `M${P(x, y)} Q${P(lx + side[0], ly + side[1])} ${P(tip[0], tip[1])} Q${P(lx - side[0], ly - side[1])} ${P(x, y)} Z`),
      i % 2 ? leaf : lighten(leaf, 0.18), { stroke: darken(leaf, 0.25), strokeWidth: len * 0.02 });
    out(p.line(x, y, x + Math.cos(a) * len * 0.85, y + Math.sin(a) * len * 0.85), "none", { stroke: darken(leaf, 0.3), strokeWidth: len * 0.025, opacity: 0.7 });
  }
  out(p.circle(x, y, r * 0.12), darken(leaf, 0.2));
}

/** A seat in its local frame (+y faces the table). `k` is a kit() for that frame. */
function drawSeat(k, r, kind, color) {
  const { p, out, shadow, edge, grad, u } = k;
  const arc = (rad, a0, a1, sw, c, op = 1) => {
    const A = (a) => [Math.cos((a * Math.PI) / 180) * rad, Math.sin((a * Math.PI) / 180) * rad];
    const [x0, y0] = A(a0), [x1, y1] = A(a1);
    out(p.raw((P) => `M${P(x0, y0)} A${f(rad)} ${f(rad)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${P(x1, y1)}`), "none", { stroke: c, strokeWidth: sw, opacity: op, linecap: "round" });
  };
  switch (kind) {
    case "stool": case "stool_backrest": {
      const d = p.circle(0, 0, r);
      shadow(d);
      out(d, grad(color, "rad"), edge(color));
      out(p.circle(0, 0, r * 0.62), "none", { stroke: lighten(color, 0.3), strokeWidth: u * 0.1, opacity: 0.8 });
      if (kind === "stool_backrest") arc(r * 1.05, 215, 325, r * 0.28, darken(color, 0.25));
      return;
    }
    case "pouf": {
      const d = p.circle(0, 0, r * 1.05);
      shadow(d);
      out(d, grad(color, "rad"), edge(color, 0.25));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; out(p.line(0, 0, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95), "none", { stroke: darken(color, 0.18), strokeWidth: u * 0.07, opacity: 0.7 }); }
      out(p.circle(0, 0, r * 0.12), darken(color, 0.3));
      return;
    }
    case "bistro": case "cafe": {
      const d = p.circle(0, r * 0.08, r * 0.9);
      shadow(d);
      out(d, grad(kind === "bistro" ? lighten(color, 0.1) : color, "rad"), edge(color));
      if (kind === "bistro") {
        for (let i = -2; i <= 2; i++) {
          out(p.line(-r * 0.6, r * 0.08 + i * r * 0.22, r * 0.6, r * 0.08 + i * r * 0.22), "none", { stroke: darken(color, 0.2), strokeWidth: u * 0.05, opacity: 0.6 });
          out(p.line(i * r * 0.22, -r * 0.5, i * r * 0.22, r * 0.66), "none", { stroke: darken(color, 0.2), strokeWidth: u * 0.05, opacity: 0.6 });
        }
        arc(r * 0.98, 200, 340, r * 0.3, darken(color, 0.3));
      } else {
        out(p.circle(0, r * 0.08, r * 0.62), "none", { stroke: lighten(color, 0.25), strokeWidth: u * 0.08, opacity: 0.7 });
        arc(r * 1.02, 195, 345, r * 0.14, darken(color, 0.35));
        arc(r * 0.8, 215, 325, r * 0.08, darken(color, 0.35), 0.8);
      }
      return;
    }
    case "tub": {
      const d = p.circle(0, 0, r * 1.15);
      shadow(d);
      out(d, grad(darken(color, 0.12), "rad"), edge(color));
      out(p.circle(0, r * 0.25, r * 0.78), grad(lighten(color, 0.1), "rad"), edge(color, 0.2));
      return;
    }
    case "lounge": {
      const s = r * 2.6, seat = p.rect(-s / 2, -s / 2, s, s, s * 0.18);
      shadow(seat);
      out(seat, grad(color), edge(color));
      out(p.rect(-s / 2, -s / 2, s, s * 0.22, s * 0.1), grad(darken(color, 0.18)));
      out(p.rect(-s / 2, -s / 2, s * 0.13, s, s * 0.06), grad(darken(color, 0.1)));
      out(p.rect(s / 2 - s * 0.13, -s / 2, s * 0.13, s, s * 0.06), grad(darken(color, 0.1)));
      out(p.rect(-s * 0.33, -s * 0.24, s * 0.66, s * 0.66, s * 0.14), grad(lighten(color, 0.15)), edge(color, 0.15));
      return;
    }
  }
  const s = kind === "armchair" ? r * 2.3 : r * 2;
  const seat = p.rect(-s / 2, -s / 2, s, s, s * 0.2);
  shadow(seat);
  out(seat, grad(color), edge(color));
  out(p.rect(-s * 0.36, -s * 0.18, s * 0.72, s * 0.6, s * 0.16), lighten(color, 0.14), { opacity: 0.75 });
  out(p.rect(-s / 2, -s / 2, s, s * 0.27, s * 0.12), grad(darken(color, 0.2)));
  out(p.line(-s * 0.38, -s / 2 + s * 0.25, s * 0.38, -s / 2 + s * 0.25), "none", { stroke: lighten(color, 0.25), strokeWidth: u * 0.08, opacity: 0.7 });
  if (kind === "armchair") {
    out(p.rect(-s / 2, -s / 2, s * 0.18, s, s * 0.08), grad(darken(color, 0.1)));
    out(p.rect(s / 2 - s * 0.18, -s / 2, s * 0.18, s, s * 0.08), grad(darken(color, 0.1)));
  }
}

function drawTable(t, ctx, state) {
  const { theme, push, u, M, grad } = ctx;
  const box = boxOf(t.shape), ap = t.appearance || {}, cs = t.chairStyle || {};
  const { w, h } = box;
  const ref = { type: "table", id: t.id };
  const style = ap.style;
  const styleTop = { modern: "#F2F1EE", rustic: "#8A5A34", industrial: "#A0703F", bistro: "#ECE8E1", scandinavian: "#E3C79C", classic: "#6E3F22" }[style];
  const top = ap.color || theme.materials[ap.material] || styleTop || theme.materials.wood;
  const corner = { modern: 0.14, rustic: 0.03, industrial: 0.02, scandinavian: 0.22, classic: 0.06 }[style] ?? 0.08;
  const [cx, cy] = [box.cx, box.cy];
  const T = kit(box, ref, "tables", ctx), C = kit(box, ref, "chairs", ctx);

  // seats
  // real seat sizes (radius in metres) when the floor has a scale; otherwise proportional to the table
  const SEAT_M = { chair: 0.22, armchair: 0.25, stool: 0.18, stool_backrest: 0.19, bistro: 0.22, cafe: 0.21, tub: 0.27, lounge: 0.3, pouf: 0.22 };
  const seatR = ctx.scaled ? M(SEAT_M[cs.kind] ?? 0.22) : undefined;
  const seats = t.chairs?.length ? t.chairs.map((c) => ({ p: [c.x, c.y], r: M(SEAT_M[cs.kind] ?? 0.22) })) : autoChairs(t, u, seatR);
  const seatColor = cs.color || theme.chair;
  if ((cs.kind === "bench" || cs.kind === "booth") && !box.round && !box.free) {
    const depth = M(cs.kind === "booth" ? 0.55 : 0.4);
    for (const side of [-1, 1]) {
      const y = side * (h / 2 + depth / 2 + u * 0.3);
      const d = C.p.rect(-w / 2, y - depth / 2, w, depth, depth * 0.25);
      C.shadow(d);
      C.out(d, grad(seatColor), C.edge(seatColor));
      const n = Math.max(1, Math.round(w / M(0.6)));
      for (let i = 1; i < n; i++) C.out(C.p.line(-w / 2 + (w * i) / n, y - depth * 0.4, -w / 2 + (w * i) / n, y + depth * 0.4), "none",
        { stroke: darken(seatColor, 0.25), strokeWidth: u * 0.1, opacity: 0.7 });
      if (cs.kind === "booth") C.out(C.p.rect(-w / 2, side > 0 ? y + depth / 2 - depth * 0.3 : y - depth / 2, w, depth * 0.3, depth * 0.15), grad(darken(seatColor, 0.22)));
    }
  } else {
    for (const s of seats) {
      const a = Math.atan2(cy - s.p[1], cx - s.p[0]);
      drawSeat(kit({ cx: s.p[0], cy: s.p[1], rot: (a * 180) / Math.PI - 90 }, ref, "chairs", ctx), s.r, cs.kind || "chair", seatColor);
    }
  }

  // table top
  const shape = (inset = 0) => box.round ? T.p.ellipse(0, 0, w / 2 - inset, h / 2 - inset)
    : box.free ? null : T.p.rect(-w / 2 + inset, -h / 2 + inset, w - 2 * inset, h - 2 * inset, Math.max(0, Math.min(w, h) * corner - inset));
  const outline = shape() || shapeToPath(t.shape);
  T.shadow(outline, 1.2);
  if (ap.tablecloth) {
    T.out(box.round ? T.p.ellipse(0, 0, w / 2 + u * 0.4, h / 2 + u * 0.4) : outline, grad(ap.tablecloth), { stroke: darken(ap.tablecloth, 0.25), strokeWidth: u * 0.12 });
    T.out(shape(Math.min(w, h) * 0.06) || outline, lighten(ap.tablecloth, 0.12), { opacity: 0.8 });
  } else {
    const rim = { industrial: ["#2F3337", u * 0.7], bistro: ["#B08D57", u * 0.5], rustic: [darken(top, 0.45), u * 0.35] }[style];
    T.out(outline, grad(top, box.round ? "rad" : "lin"), { stroke: rim ? rim[0] : darken(top, 0.38), strokeWidth: rim ? rim[1] : u * 0.15, opacity: ap.material === "glass" ? 0.8 : 1 });
    if (!box.free) {
      const inset = Math.min(w, h) * 0.07, iw = w - 2 * inset, ih = h - 2 * inset;
      const woody = WOODS.has(ap.material) || (!ap.material && !["modern", "bistro"].includes(style));
      if (style === "modern") {
        T.out(T.p.raw((P) => `M${P(-w * 0.32, -h * 0.4)} L${P(-w * 0.12, -h * 0.4)} L${P(-w * 0.38, h * 0.3)} L${P(-w * 0.44, h * 0.1)} Z`), "#FFFFFF", { opacity: 0.35 });
      } else if (style === "rustic") {
        const long = w >= h, n = Math.max(2, Math.round((long ? h : w) / M(0.18)));
        for (let i = 1; i < n; i++) {
          const t2 = -0.5 + i / n;
          T.out(long ? T.p.line(-w / 2 + u * 0.3, h * t2, w / 2 - u * 0.3, h * t2) : T.p.line(w * t2, -h / 2 + u * 0.3, w * t2, h / 2 - u * 0.3), "none",
            { stroke: darken(top, 0.4), strokeWidth: u * 0.14, opacity: 0.8 });
        }
        T.grain(top, -w / 2 + inset, -h / 2 + inset, iw, ih);
        T.out(T.p.ellipse(w * 0.2, -h * 0.15, Math.min(w, h) * 0.05, Math.min(w, h) * 0.025), darken(top, 0.35), { opacity: 0.7 });
      } else if (style === "industrial") {
        T.grain(top, -w / 2 + inset, -h / 2 + inset, iw, ih);
        if (!box.round) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) T.out(T.p.circle(x * (w / 2 - u * 0.45), y * (h / 2 - u * 0.45), u * 0.18), "#8A9097");
      } else if (style === "bistro") {
        for (let k2 = 0; k2 < 3; k2++) T.out(T.p.raw((P) => `M${P(-w * 0.35, -h * (0.25 - k2 * 0.2))} Q${P(0, h * (0.05 + k2 * 0.1))} ${P(w * 0.3, -h * (0.1 - k2 * 0.15))}`), "none",
          { stroke: darken(top, 0.18), strokeWidth: u * 0.06, opacity: 0.55 });
      } else if (style === "classic") {
        T.out(shape(Math.min(w, h) * 0.12), "none", { stroke: lighten(top, 0.35), strokeWidth: u * 0.18, opacity: 0.8 });
        T.grain(top, -w / 2 + inset, -h / 2 + inset, iw, ih);
      } else {
        T.out(shape(inset), "none", { stroke: lighten(top, 0.25), strokeWidth: u * 0.1, opacity: 0.6 });
        if (woody) T.grain(top, -w / 2 + inset, -h / 2 + inset, iw, ih);
        if (ap.material === "marble") T.out(T.p.raw((P) => `M${P(-w * 0.35, -h * 0.2)} Q${P(0, h * 0.1)} ${P(w * 0.3, -h * 0.05)}`), "none", { stroke: darken(top, 0.2), strokeWidth: u * 0.06, opacity: 0.6 });
      }
    }
  }

  // place settings: plate, cutlery, glass
  if (ap.tableSetting && ap.tableSetting !== "none") {
    const pr = Math.min(Math.min(w, h) * 0.13, M(0.13));
    for (const s of seats) {
      const dx = cx - s.p[0], dy = cy - s.p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const pc = [s.p[0] + ux * (s.r * 1.3 + pr * 1.35), s.p[1] + uy * (s.r * 1.3 + pr * 1.35)];
      push({ type: "path", d: circlePath(pc[0], pc[1], pr), fill: grad("#FFFFFF", "rad"), stroke: "#C9CFD4", strokeWidth: u * 0.08, layer: "tables", ref });
      push({ type: "path", d: circlePath(pc[0], pc[1], pr * 0.62), fill: "#F6F7F8", stroke: "#E0E4E7", strokeWidth: u * 0.06, layer: "tables", ref });
      for (const side of [-1, 1]) {
        const ox = -uy * side * pr * 1.3, oy = ux * side * pr * 1.3;
        push({ type: "path", d: `M${f(pc[0] + ox - ux * pr * 0.8)} ${f(pc[1] + oy - uy * pr * 0.8)} L${f(pc[0] + ox + ux * pr * 0.8)} ${f(pc[1] + oy + uy * pr * 0.8)}`,
          fill: "none", stroke: "#9AA3AB", strokeWidth: u * 0.14, linecap: "round", layer: "tables", ref });
      }
      if (ap.tableSetting === "plates_glasses") {
        const gx = pc[0] - uy * pr * 1.3 + ux * pr * 1.2, gy = pc[1] + ux * pr * 1.3 + uy * pr * 1.2;
        push({ type: "path", d: circlePath(gx, gy, pr * 0.34), fill: grad("#D7F1F8", "rad"), stroke: "#9FD3E0", strokeWidth: u * 0.06, layer: "tables", ref });
      }
    }
  }

  // status ring and number badge
  const st = state?.status;
  if (st) push({ type: "path", d: outline, fill: "none", stroke: theme.status[st] || theme.status.unknown, strokeWidth: u * 0.6, opacity: 0.95, layer: "badges", ref });
  const br = u * 1.5;
  push({ type: "path", d: circlePath(cx, cy, br), fill: st ? theme.status[st] || theme.badge.fill : theme.badge.fill,
    stroke: theme.badge.stroke, strokeWidth: u * 0.15, layer: "badges", ref });
  push({ type: "text", x: cx, y: cy, text: t.number, fontSize: br * (t.number.length > 2 ? 0.85 : 1.15), weight: 700,
    fill: theme.badge.text, rotation: 0, layer: "badges", ref });
}

function drawClimate(dv, ctx) {
  const { theme, push, u, M, grad } = ctx;
  const box = boxOf(dv.shape), { w, h } = box;
  const ref = { type: "climateDevice", id: dv.id };
  const { p, out, shadow, lineOut } = kit(box, ref, "climate", ctx);
  const dst = ctx.stateOf(dv), metal = "#C3CAD0", on = dst.power !== "off", lvl = dst.level;
  const panel = (c, r = Math.min(w, h) * 0.2) => { const d = p.rect(-w / 2, -h / 2, w, h, r); shadow(d, 0.8); out(d, grad(c), { stroke: "#94A3AE", strokeWidth: u * 0.12 }); };

  if (dv.kind === "ventilation_duct") {
    if (box.free) {
      const d = shapeToPath(dv.shape);
      out(d, grad(metal), { stroke: "#56636D", strokeWidth: u * 0.22, opacity: 0.82 });
      return;
    }
    const long = w >= h, L = long ? w : h, S = long ? h : w;
    const R = (a, b, la, lb) => (long ? p.rect(a, b, la, lb, 0) : p.rect(b, a, lb, la, 0));
    const L2 = (a1, b1, a2, b2) => (long ? p.line(a1, b1, a2, b2) : p.line(b1, a1, b2, a2));
    out(translatePath(R(-L / 2, -S / 2, L, S), u * 0.8, u * 1.1), theme.shadow, { opacity: 0.12 });
    out(R(-L / 2, -S / 2, L, S), grad(metal), { stroke: "#56636D", strokeWidth: u * 0.22, opacity: 0.82 });
    lineOut(L2(-L / 2, -S * 0.22, L / 2, -S * 0.22), "#FFFFFF", u * 0.25, 0.7);
    lineOut(L2(-L / 2, S * 0.3, L / 2, S * 0.3), "#7F8C96", u * 0.12, 0.6);
    for (let x = -L / 2 + M(1.2); x < L / 2; x += M(1.2)) lineOut(L2(x, -S / 2, x, S / 2), "#56636D", u * 0.16, 0.75);
    for (let x = -L / 2 + M(1.5); x < L / 2 - M(0.5); x += M(3)) {
      const s = Math.min(S * 0.8, M(0.4));
      out(R(x - s / 2, -s / 2, s, s), "#E9EDF0", { stroke: "#7F8C96", strokeWidth: u * 0.1, opacity: 0.85 });
      for (let k = 1; k < 4; k++) lineOut(L2(x - s / 2 + (s * k) / 4, -s * 0.4, x - s / 2 + (s * k) / 4, s * 0.4), "#9AA6AF", u * 0.06, 0.9);
    }
    return;
  }

  if (dv.kind === "ceiling_cassette" || (dv.kind === "air_conditioner" && dv.mount === "ceiling")) {
    panel("#F4F6F8", Math.min(w, h) * 0.06);
    const s = Math.min(w, h);
    for (const [x, y, ww, hh] of [[-w * 0.35, -h * 0.42, w * 0.7, s * 0.08], [-w * 0.35, h * 0.34, w * 0.7, s * 0.08],
      [-w * 0.42, -h * 0.35, s * 0.08, h * 0.7], [w * 0.34, -h * 0.35, s * 0.08, h * 0.7]]) out(p.rect(x, y, ww, hh, s * 0.03), grad("#C3CDD5"));
    out(p.rect(-w * 0.24, -h * 0.24, w * 0.48, h * 0.48, s * 0.04), "#E8EDF1", { stroke: "#B7C2CA", strokeWidth: u * 0.08 });
    for (let k = 1; k < 5; k++) {
      lineOut(p.line(-w * 0.24 + (w * 0.48 * k) / 5, -h * 0.22, -w * 0.24 + (w * 0.48 * k) / 5, h * 0.22), "#C3CDD5", u * 0.06);
      lineOut(p.line(-w * 0.22, -h * 0.24 + (h * 0.48 * k) / 5, w * 0.22, -h * 0.24 + (h * 0.48 * k) / 5), "#C3CDD5", u * 0.06);
    }
    out(p.circle(w * 0.4, h * 0.4, s * 0.03), on ? "#34D399" : "#EF4444");
    if (on) for (const a of [0, 90, 180, 270]) {
      const r = (a * Math.PI) / 180, d0 = s * 0.62, n = [-Math.sin(r), Math.cos(r)];
      const c = [Math.cos(r) * d0, Math.sin(r) * d0];
      out(p.raw((P) => `M${P(c[0] - n[0] * s * 0.2, c[1] - n[1] * s * 0.2)} Q${P(c[0] + Math.cos(r) * s * 0.1, c[1] + Math.sin(r) * s * 0.1)} ${P(c[0] + n[0] * s * 0.2, c[1] + n[1] * s * 0.2)}`),
        "none", { stroke: "#3BA7D9", strokeWidth: u * 0.22, opacity: 0.35 + 0.3 * lvl, linecap: "round", effect: "flow" });
    }
    return;
  }

  if (dv.kind === "patio_heater") {
    const r = Math.min(w, h) / 2;
    if (on) {
      out(p.circle(0, 0, r * (1.5 + 1.2 * lvl)), "url(#ep-glow)", { effect: "pulse" });
      out(p.circle(0, 0, r * (1.2 + 0.6 * lvl)), "none", { stroke: "#F08A4B", strokeWidth: u * 0.18, dash: [u * 0.7, u * 0.5], opacity: 0.55, effect: "flow" });
    }
    shadow(p.circle(0, 0, r));
    out(p.circle(0, 0, r), grad("#D2D8DD", "rad"), { stroke: "#7F8C96", strokeWidth: u * 0.15 });
    for (const k of [0.72, 0.45]) out(p.circle(0, 0, r * k), "none", { stroke: "#9AA6AF", strokeWidth: u * 0.1 });
    out(p.circle(0, 0, r * 0.18), on ? "url(#ep-ember)" : grad("#3A3F45", "rad"), on ? { effect: "flicker" } : {});
    return;
  }

  if (dv.kind === "wall_heater") {
    if (on) out(p.ellipse(0, h / 2 + u * 1.5, w * (0.5 + 0.2 * lvl), u * (2.5 + 2 * lvl)), "url(#ep-glow)", { effect: "pulse" });
    panel("#3A3F45", Math.min(w, h) * 0.15);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const y = -h * 0.3 + (h * 0.6 * i) / (n - 1);
      out(p.rect(-w * 0.42, y - h * 0.07, w * 0.84, h * 0.14, h * 0.07), on ? "url(#ep-ember)" : grad("#6B7178"), { opacity: 0.95, effect: on ? "flicker" : undefined });
    }
    if (on) for (let k = 0; k < 3; k++) {
      const x = -w * 0.3 + (w * 0.6 * k) / 2, y0 = h / 2 + u * 0.8;
      out(p.raw((P) => `M${P(x, y0)} Q${P(x + u * 0.8, y0 + u * 1)} ${P(x, y0 + u * 2)} T${P(x, y0 + u * 4)}`), "none",
        { stroke: "#F08A4B", strokeWidth: u * 0.2, opacity: 0.35 + 0.4 * lvl, linecap: "round", effect: "flow" });
    }
    return;
  }

  const c = dv.appearance?.color || theme.materials[dv.appearance?.material] || (dv.kind === "exhaust_hood" ? "#C5CCD2" : "#FFFFFF");
  if (dv.kind === "exhaust_hood") {
    out(p.rect(-w / 2, -h / 2, w, h, u * 0.4), c, { opacity: 0.18 });
    out(p.rect(-w / 2, -h / 2, w, h, u * 0.4), "none", { stroke: "#6B7680", strokeWidth: u * 0.25, dash: [u * 1.2, u * 0.6] });
    return;
  }
  panel(c);
  if (["air_conditioner", "hvac_indoor_unit"].includes(dv.kind)) {
    out(p.rect(-w * 0.44, h * 0.08, w * 0.88, h * 0.26, h * 0.1), grad("#DCE3E8"));
    for (let i = 1; i <= 3; i++) lineOut(p.line(-w * 0.4, h * 0.08 + (h * 0.26 * i) / 4, w * 0.4, h * 0.08 + (h * 0.26 * i) / 4), "#AAB6BF", u * 0.07);
    out(p.circle(w * 0.38, -h * 0.22, Math.min(w, h) * 0.08), on ? "#34D399" : "#EF4444");
  } else if (/vent|fan|purifier/.test(dv.kind)) {
    for (let i = 1; i < 4; i++) {
      lineOut(p.line(-w / 2 + (w * i) / 4, -h * 0.4, -w / 2 + (w * i) / 4, h * 0.4), "#9AA9B4", u * 0.1);
      lineOut(p.line(-w * 0.4, -h / 2 + (h * i) / 4, w * 0.4, -h / 2 + (h * i) / 4), "#9AA9B4", u * 0.1);
    }
  } else if (/heater|radiator|underfloor/.test(dv.kind)) {
    const n = Math.max(3, Math.round(w / (u * 1.2)));
    if (on) out(p.ellipse(0, 0, w * 0.75, h * (1 + lvl)), "url(#ep-glow)", { opacity: 0.6, effect: "pulse" });
    for (let i = 1; i < n; i++) out(p.line(-w / 2 + (w * i) / n, -h * 0.35, -w / 2 + (w * i) / n, h * 0.35), "none",
      { stroke: on ? "#E4572E" : "#8A939B", strokeWidth: u * 0.15, opacity: 0.85, linecap: "round", effect: on ? "flicker" : undefined });
  } else if (dv.kind === "thermostat") {
    out(p.circle(0, 0, Math.min(w, h) * 0.3), "none", { stroke: "#3BA7D9", strokeWidth: u * 0.15 });
  }
  if (dv.airflowDirectionDeg != null && on) {
    const a = (dv.airflowDirectionDeg * Math.PI) / 180;
    for (let k = 0; k < 3; k++) {
      const d0 = u * (3 + k * 1.6), mid = [box.cx + Math.cos(a) * d0, box.cy + Math.sin(a) * d0], n = [-Math.sin(a) * u * 1.4, Math.cos(a) * u * 1.4];
      push({ type: "path", d: `M${f(mid[0] - n[0])} ${f(mid[1] - n[1])} Q${f(mid[0] + Math.cos(a) * u * 0.8)} ${f(mid[1] + Math.sin(a) * u * 0.8)} ${f(mid[0] + n[0])} ${f(mid[1] + n[1])}`,
        fill: "none", stroke: "#3BA7D9", strokeWidth: u * 0.25, opacity: (0.7 - k * 0.18) * (0.5 + 0.5 * lvl), linecap: "round", layer: "climate", ref, effect: "flow" });
    }
  }
}

// ------------------------------------------------------------------ scene
/**
 * @param plan    Eaterior document
 * @param options floorId, tableStates, readings, theme (partial), showZoneNames (default true),
 *                objectStates (object-state document: active / open / power),
 *                walls3d (default true), camera {x, y} (default: floor centre), wallDepth (default 1),
 *                showChairs, highlightReview, resolveAsset/showBackground (ignored: the illustration replaces the drawing)
 */
export function buildIllustratedScene(plan, options = {}) {
  const floor = plan.floors.find((x) => x.id === options.floorId) || plan.floors[0];
  const theme = { ...ILLUSTRATED_THEME, ...(options.theme || {}) };
  const states = stateMap(options.tableStates, "tableId", plan);
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
  const gradIds = new Set();
  const grad = (c, mode = "lin") => {
    const id = `ep-${mode}-${c.slice(1).toLowerCase()}`;
    if (!gradIds.has(id)) {
      gradIds.add(id);
      defs.push(mode === "rad"
        ? { type: "radialGradient", id, cx: 0.4, cy: 0.35, r: 0.75, stops: [{ offset: 0, color: lighten(c, 0.28) }, { offset: 1, color: darken(c, 0.1) }] }
        : { type: "linearGradient", id, x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, color: lighten(c, 0.16) }, { offset: 0.55, color: c }, { offset: 1, color: darken(c, 0.14) }] });
    }
    return `url(#${id})`;
  };
  const softShadow = (d, layer, ref, strength = 1) => {
    push({ type: "path", d: translatePath(d, u * 0.3, u * 0.4), fill: theme.shadow, opacity: 0.16 * strength, layer, ref });
    push({ type: "path", d: translatePath(d, u * 0.9, u * 1.2), fill: theme.shadow, opacity: 0.07 * strength, layer, ref });
  };
  defs.push({ type: "radialGradient", id: "ep-flame", cx: 0.5, cy: 0.5, r: 0.5, stops: [
    { offset: 0, color: "#FFF1B8" }, { offset: 0.45, color: "#FFB347" }, { offset: 0.8, color: "#FF6A1A", opacity: 0.9 }, { offset: 1, color: "#3B82F6", opacity: 0.6 }] });
  defs.push({ type: "radialGradient", id: "ep-ember", cx: 0.5, cy: 0.5, r: 0.65, stops: [
    { offset: 0, color: "#FFD27A" }, { offset: 0.6, color: "#F06A35" }, { offset: 1, color: "#B83A1B" }] });
  defs.push({ type: "radialGradient", id: "ep-glow", cx: 0.5, cy: 0.5, r: 0.5, stops: [
    { offset: 0, color: "#FFB36B", opacity: 0.55 }, { offset: 0.6, color: "#FF8A3D", opacity: 0.18 }, { offset: 1, color: "#FF8A3D", opacity: 0 }] });
  const defIds = new Set();
  const addDef = (d) => { if (!defIds.has(d.id)) { defIds.add(d.id); defs.push(d); } return `url(#${d.id})`; };
  const objStates = objectStateMap(options.objectStates, plan);
  const stateOf = (o) => resolveState(o, objStates);
  const ctx = { theme, push, u, M, grad, softShadow, stateOf, addDef, scaled: !!mpu };
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
    wallData.push({ w, g, gaps, solid, color: w.appearance?.color || theme.wall, open: stateOf(w).open });
  }

  if (use3d) {
    drawWalls3D(wallData, { theme, push, u, M, cam: options.camera ? [options.camera.x, options.camera.y] : [W / 2, H / 2],
      depth: options.wallDepth ?? 1 });
  } else {
    for (const wd of wallData) if (GLASS.has(wd.w.kind)) drawGlassFlat(wd, { theme, push, u, M });
    for (const pass of ["edge", "fill"]) {
      for (const { w, g, solid, color } of wallData) {
        if (GLASS.has(w.kind)) continue;
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
      } else if (o.kind === "window" && stateOf(o).hasOpen && stateOf(o).open > 0) {
        // open casement: two sashes swing inwards from the jambs
        const ang = (stateOf(o).open * 70 * Math.PI) / 180, outward = o.opensToward === "outside" ? -1 : 1;
        for (const [hinge, other] of [[p0, p1], [p1, p0]]) {
          const L = Math.hypot(other[0] - hinge[0], other[1] - hinge[1]) / 2, t = [(other[0] - hinge[0]) / (2 * L), (other[1] - hinge[1]) / (2 * L)];
          const [tx, ty] = g.tangentAt((t0 + t1) / 2), n = [-ty * outward, tx * outward];
          const end = [hinge[0] + L * (Math.cos(ang) * t[0] + Math.sin(ang) * n[0]), hinge[1] + L * (Math.cos(ang) * t[1] + Math.sin(ang) * n[1])];
          push({ type: "path", d: `M${f(hinge[0])} ${f(hinge[1])} L${f(end[0])} ${f(end[1])}`, fill: "none", stroke: theme.window,
            strokeWidth: u * 0.45, linecap: "round", layer: "openings", ref });
        }
      } else if (o.kind === "door" && o.swing !== "none") {
        const outward = o.opensToward === "outside" ? -1 : 1;
        const os = stateOf(o), angle = os.hasOpen ? (os.open * Math.PI) / 2 : Math.PI / 2;   // live state sets the leaf angle
        const leaf = (hinge, jamb, tH, len) => {
          const [tx, ty] = g.tangentAt(tH), n = [-ty * outward, tx * outward];
          const tj = [(jamb[0] - hinge[0]) / (Math.hypot(jamb[0] - hinge[0], jamb[1] - hinge[1]) || 1), (jamb[1] - hinge[1]) / (Math.hypot(jamb[0] - hinge[0], jamb[1] - hinge[1]) || 1)];
          const end = [hinge[0] + len * (Math.cos(angle) * tj[0] + Math.sin(angle) * n[0]), hinge[1] + len * (Math.cos(angle) * tj[1] + Math.sin(angle) * n[1])];
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
      const fs = Math.max(u * 0.9, Math.min(u * 1.7, (b.w * 0.9) / (z.name.length * 0.56 + 1.2)));   // fit the chip inside the zone
      chip(push, b.cx, b.cy - b.h / 2 + fs * 1.6, z.name, fs, theme, { type: "zone", id: z.id }, "labels");
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

  const scene = { floorId: floor.id, width: W, height: H, viewBox: `0 0 ${f(W)} ${f(H)}`, background: theme.background, defs, items };
  applyInactive(scene, plan, floor.id, objStates, "badges");
  const order = new Map(ILLUSTRATED_LAYERS.map((l, i) => [l, i]));
  scene.items = scene.items.map((it, i) => [it, i]).sort((p, q) => order.get(p[0].layer) - order.get(q[0].layer) || p[1] - q[1]).map((p) => p[0]);
  return scene;
}

/**
 * Walls with depth: a camera above `cam` sees each wall's top shifted away from it and the wall face that points
 * towards it. Faces, window decals and tops are plain 2D polygons, so any SVG/Canvas renderer can draw them.
 */
const GLASS = new Set(["glass", "glass_folding", "glass_sliding"]);
const glassFrame = (w) => w.appearance?.color || "#5C6166";
const panelUnits = (w, M) => M(w.panelWidthMeters ?? (w.kind === "glass" ? 1.5 : 0.8));

/** Panel boundaries (as t values) of a solid glass segment. */
function glassPanels(w, g, t0, t1, M) {
  const n = Math.max(1, Math.round(((t1 - t0) * g.length) / panelUnits(w, M)));
  return Array.from({ length: n + 1 }, (_, k) => t0 + ((t1 - t0) * k) / n);
}

function drawGlassFlat({ w, g, solid, open }, { theme, push, u, M }) {
  const frame = glassFrame(w), T = w.thickness, ref = { type: "wall", id: w.id };
  const off = (t, k) => { const p = g.pointAt(t), [tx, ty] = g.tangentAt(t); return [p[0] - ty * k, p[1] + tx * k]; };
  const seg = (t0, t1, k) => { const a = off(t0, k), b = off(t1, k); return `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`; };
  for (const [s0, t1] of solid) {
    const all = glassPanels(w, g, s0, t1, M), k = Math.round((all.length - 1) * open);
    const t0 = s0, tEnd = all[all.length - 1 - k];
    if (k > 0) {                                     // opened panels stacked at the end of the run
      for (let j = 0; j < k; j++) {
        const t = t1 - (j * u * 0.6) / g.length, a = off(t, -T * 0.9), b = off(t, T * 0.9);
        push({ type: "path", d: `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`, fill: "none", stroke: frame, strokeWidth: u * 0.28, layer: "walls", ref });
      }
    }
    if (tEnd <= t0 + 1e-6) continue;
    push({ type: "path", d: g.segmentPath(t0, tEnd), fill: "none", stroke: theme.window, strokeWidth: T * 0.6, opacity: 0.55, layer: "walls", ref });
    const ts = all.slice(0, all.length - k);
    if (w.kind === "glass_sliding") {
      for (let i = 0; i < ts.length - 1; i++) {
        const k = (i % 2 ? 1 : -1) * T * 0.2;
        push({ type: "path", d: seg(ts[i] - (i ? 0.004 : 0), ts[i + 1] + (i < ts.length - 2 ? 0.004 : 0), k), fill: "none", stroke: frame, strokeWidth: u * 0.22, layer: "walls", ref });
      }
    } else {
      for (const kk of [-T * 0.3, T * 0.3]) push({ type: "path", d: seg(t0, tEnd, kk), fill: "none", stroke: frame, strokeWidth: u * 0.14, layer: "walls", ref });
    }
    for (let i = 0; i < ts.length; i++) {
      const z = w.kind === "glass_folding" ? (i % 2 ? 0.35 : -0.35) * T : 0;
      const a = off(ts[i], -T * 0.4 + z * 0.3), b = off(ts[i], T * 0.4 + z * 0.3);
      push({ type: "path", d: `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`, fill: "none", stroke: frame, strokeWidth: u * 0.3, linecap: "round", layer: "walls", ref });
    }
  }
}

function drawWalls3D(wallData, { theme, push, u, M, cam, depth }) {
  const K = 0.03 * depth;                      // top offset per metre of wall height, relative to distance from cam
  const faces = [], decals = [], tops = [], aos = [];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const poly = (pts) => pts.map((q, i) => `${i ? "L" : "M"}${f(q[0])} ${f(q[1])}`).join(" ") + " Z";
  const faceColor = theme.wallFace || "#E4ECF1";

  // T junctions: a wall end that lands on the body of another straight wall stops at that wall's face
  // (no half-thickness extension, no end cap), so it does not poke through or draw its top over the host.
  const teeHost = (w, end) => {
    const p = [w[end].x, w[end].y];
    for (const { w: v } of wallData) {
      if (v === w || v.bulge) continue;
      const dx = v.b.x - v.a.x, dy = v.b.y - v.a.y, L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const t = ((p[0] - v.a.x) * dx + (p[1] - v.a.y) * dy) / (L * L);
      if (t * L < v.thickness / 2 || (1 - t) * L < v.thickness / 2) continue; // at the host's end: a corner, not a T
      const d = Math.abs(((p[0] - v.a.x) * dy - (p[1] - v.a.y) * dx) / L);
      if (d <= Math.max(v.thickness / 2, u * 0.05)) return v.thickness;
    }
    return 0;
  };

  for (const { w, g, gaps, solid, color, open } of wallData) {
    const isGlass = GLASS.has(w.kind);
    const hgt = w.heightMeters ?? (w.kind === "half_height" ? 1.1 : isGlass ? 2.4 : 2.8);
    const cap = Math.max(w.thickness * 2.6, u * 2.5) * depth, T = w.thickness;
    const lift = (q, frac = 1) => {
      let ox = (q[0] - cam[0]) * K * hgt, oy = (q[1] - cam[1]) * K * hgt;
      const L = Math.hypot(ox, oy);
      if (L > cap) { ox *= cap / L; oy *= cap / L; }
      return [q[0] + ox * frac, q[1] + oy * frac];
    };
    const ref = { type: "wall", id: w.id };
    if (isGlass) {
      const frame = glassFrame(w), T = w.thickness;
      const at = (t, k = 0) => { const p = g.pointAt(t), [tx, ty] = g.tangentAt(t); return [p[0] - ty * k, p[1] + tx * k]; };
      for (const [t0, t1] of solid) {
        const all = glassPanels(w, g, t0, t1, M), k = Math.round((all.length - 1) * open);
        for (let j = 0; j < k; j++) {               // opened panels folded/slid to the end of the run
          const t = t1 - (j * u * 0.6) / g.length, a = at(t, -T * 0.9), b = at(t, T * 0.9);
          faces.push({ type: "path", d: poly([a, b, lift(b), lift(a)]), fill: theme.window, stroke: frame, strokeWidth: u * 0.12, opacity: 0.4, layer: "walls", ref });
        }
        const ts = all.slice(0, all.length - k);
        if (ts.length < 2) continue;
        const zig = (i) => (w.kind === "glass_folding" ? (i % 2 ? 0.45 : -0.45) * T : w.kind === "glass_sliding" ? (i % 2 ? 0.2 : -0.2) * T : 0);
        for (let i = 0; i < ts.length - 1; i++) {
          const a = at(ts[i], zig(i)), b = at(ts[i + 1], w.kind === "glass_folding" ? zig(i + 1) : zig(i));
          faces.push({ type: "path", d: poly([a, b, lift(b), lift(a)]), fill: theme.window, stroke: frame, strokeWidth: u * 0.1, opacity: 0.32, layer: "walls", ref });
          const hl = (q, fr) => { const tp = lift(q); return [q[0] + (tp[0] - q[0]) * fr, q[1] + (tp[1] - q[1]) * fr]; };
          decals.push({ type: "path", d: `M${f(hl(a, 0.25)[0])} ${f(hl(a, 0.25)[1])} L${f(hl(b, 0.6)[0])} ${f(hl(b, 0.6)[1])}`, fill: "none",
            stroke: "#FFFFFF", strokeWidth: u * 0.2, opacity: 0.55, layer: "walls", ref });
        }
        for (let i = 0; i < ts.length; i++) {
          const q = at(ts[i], zig(Math.min(i, ts.length - 2) + (w.kind === "glass_folding" && i === ts.length - 1 ? 1 : 0))), tp = lift(q);
          decals.push({ type: "path", d: `M${f(q[0])} ${f(q[1])} L${f(tp[0])} ${f(tp[1])}`, fill: "none", stroke: frame, strokeWidth: u * 0.28, linecap: "round", layer: "walls", ref });
        }
        const b0 = at(t0), b1 = at(ts[ts.length - 1]), c0 = lift(b0), c1 = lift(b1);
        decals.push({ type: "path", d: `M${f(b0[0])} ${f(b0[1])} L${f(b1[0])} ${f(b1[1])}`, fill: "none", stroke: frame, strokeWidth: u * 0.35, layer: "walls", ref });
        tops.push({ type: "path", d: `M${f(c0[0])} ${f(c0[1])} L${f(c1[0])} ${f(c1[1])}`, fill: "none", stroke: frame, strokeWidth: u * 0.45, layer: "walls", ref, order: 0 });
      }
      continue;
    }
    const teeA = g.curved ? 0 : teeHost(w, "a"), teeB = g.curved ? 0 : teeHost(w, "b");
    for (const [t0, t1] of solid) {
      const n = g.curved ? Math.max(2, Math.ceil(16 * (t1 - t0))) : 1;
      const samples = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n, [tx, ty] = g.tangentAt(t);
        let p = g.pointAt(t);
        // corners: extend by half the own thickness; T ends: pull back to the host wall's face
        const e0 = teeA ? -teeA / 2 : T / 2, e1 = teeB ? -teeB / 2 : T / 2;
        if (!g.curved && i === 0 && t0 === 0) p = [p[0] - tx * e0, p[1] - ty * e0];
        if (!g.curved && i === n && t1 === 1) p = [p[0] + tx * e1, p[1] + ty * e1];
        samples.push({ p, nrm: [-ty, tx], tan: [tx, ty] });
      }
      const Ls = samples.map(({ p, nrm }) => [p[0] + nrm[0] * T / 2, p[1] + nrm[1] * T / 2]);
      const Rs = samples.map(({ p, nrm }) => [p[0] - nrm[0] * T / 2, p[1] - nrm[1] * T / 2]);
      const face = (a, b, nrm) => {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (dot(nrm, [cam[0] - mid[0], cam[1] - mid[1]]) <= 0) return;
        const shade = 0.16 + 0.3 * ((1 - nrm[1]) / 2) + 0.06 * Math.abs(nrm[0]);
        for (const [s, op] of [[u * 1.8, 0.07], [u * 0.8, 0.08]]) {
          aos.push({ type: "path", d: poly([a, b, [b[0] + nrm[0] * s, b[1] + nrm[1] * s], [a[0] + nrm[0] * s, a[1] + nrm[1] * s]]),
            fill: theme.shadow, opacity: op, layer: "zones" });
        }
        faces.push({ type: "path", d: poly([a, b, lift(b), lift(a)]), fill: mix(faceColor, "#7F95A3", shade),
          stroke: mix(faceColor, "#7F95A3", shade + 0.15), strokeWidth: u * 0.06, layer: "walls", ref,
          dist: Math.hypot(mid[0] - cam[0], mid[1] - cam[1]) });
      };
      for (let i = 0; i < n; i++) {
        const nm = samples[i].nrm;
        face(Ls[i], Ls[i + 1], nm);
        face(Rs[i + 1], Rs[i], [-nm[0], -nm[1]]);
      }
      if (!(t0 === 0 && teeA)) face(Rs[0], Ls[0], [-samples[0].tan[0], -samples[0].tan[1]]);
      if (!(t1 === 1 && teeB)) face(Ls[n], Rs[n], samples[n].tan);

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
  for (const it of aos) push(it);
  // painter's order: faces farther from the camera first, so a wall in front covers the one behind it
  faces.sort((a, b) => (b.dist ?? 0) - (a.dist ?? 0));
  for (const it of faces) { delete it.dist; push(it); }
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
