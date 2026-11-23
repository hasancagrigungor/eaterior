import type { EateryPlan, Scene, SceneOptions } from "./eateryplan-render.js";

export interface IllustratedOptions extends SceneOptions {
  /** Walls with 3D depth (default true). */
  walls3d?: boolean;
  /** Camera position for the depth effect (default: floor centre). */
  camera?: { x: number; y: number };
  /** Scale of the depth effect (default 1). */
  wallDepth?: number;
}

export const ILLUSTRATED_LAYERS: string[];
export const ILLUSTRATED_THEME: Record<string, any>;

/** Colourful top-down illustration: floor textures, furniture, shadows, live effects — all drawn in code. */
export function buildIllustratedScene(plan: EateryPlan, options?: IllustratedOptions): Scene;
export function mix(a: string, b: string, t: number): string;
