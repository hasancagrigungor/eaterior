/** Eaterior reference renderer: plan JSON -> platform-neutral display list -> SVG / react-native-svg / Canvas. */

/** An Eaterior document (see schemas/ in the repository for the full JSON Schema). */
export type Eaterior = { format: "eaterior"; schemaVersion: string; planId: string; floors: Array<Record<string, any>>; [k: string]: any };

export interface ObjectRef { type: string; id: string }

export interface PathItem {
  type: "path";
  /** SVG path data in floor units. */
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[] | null;
  opacity?: number;
  linecap?: "round" | "butt" | "square";
  layer: string;
  ref?: ObjectRef;
  /** Live effect for animation: pulse, flicker or flow. */
  effect?: "pulse" | "flicker" | "flow";
  status?: string | null;
  inactive?: boolean;
}
export interface TextItem { type: "text"; x: number; y: number; text: string; fontSize: number; fill: string; weight?: number; rotation?: number; opacity?: number; layer: string; ref?: ObjectRef }
export interface ImageItem { type: "image"; href: string; x: number; y: number; width: number; height: number; opacity?: number; rotation?: number; layer: string }
export type SceneItem = PathItem | TextItem | ImageItem;

export interface PatternDef { type: "pattern"; id: string; width: number; height: number; rotation?: number; items: PathItem[] }
export interface GradientStop { offset: number; color: string; opacity?: number }
export interface LinearGradientDef { type: "linearGradient"; id: string; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] }
export interface RadialGradientDef { type: "radialGradient"; id: string; cx: number; cy: number; r: number; stops: GradientStop[] }
export type SceneDef = PatternDef | LinearGradientDef | RadialGradientDef;

export interface Scene {
  floorId: string;
  width: number;
  height: number;
  /** "0 0 width height" — scale with preserveAspectRatio "xMidYMid meet". */
  viewBox: string;
  background: string;
  items: SceneItem[];
  defs?: SceneDef[];
}

/** Live state inputs: a document, an array of entries, a Map or { id: entry }. Entries may use externalRef instead of an id. */
export type StateInput = Record<string, any> | Array<Record<string, any>> | Map<string, any> | null | undefined;

export interface SceneOptions {
  floorId?: string;
  /** table-state document (status per table). */
  tableStates?: StateInput;
  /** object-state document (active / open / power / level per object). */
  objectStates?: StateInput;
  /** sensorId -> telemetry document or readings. */
  readings?: StateInput;
  theme?: Record<string, any>;
  resolveAsset?: (asset: Record<string, any>) => string | null;
  showBackground?: boolean;
  showChairs?: boolean;
  showZoneNames?: boolean;
  highlightReview?: boolean;
}

export interface ResolvedState { active: boolean; open: number; power: "on" | "off"; level: number; hasOpen: boolean; mode: string | null }

export const LAYERS: string[];
export const DEFAULT_THEME: Record<string, any>;

/** Plain architectural theme. */
export function buildScene(plan: Eaterior, options?: SceneOptions): Scene;
/** Scene -> standalone SVG markup. `animate` adds CSS animations for live effects. */
export function toSvg(scene: Scene, options?: { title?: string; className?: string; animate?: boolean }): string;
/** Runs of consecutive items per plan object, for rendering each object as a component without changing draw order. */
export function groupByObject(scene: Scene): Array<{ ref: ObjectRef | null; items: SceneItem[] }>;

export function shapeToPath(shape: Record<string, any>): string;
export function shapeCenter(shape: Record<string, any>): [number, number];
export function circlePath(cx: number, cy: number, r: number): string;
export function externalIndex(plan: Eaterior): Map<string, string>;
export function stateMap(input: StateInput, idKey: string, plan?: Eaterior): Map<string, any>;
export function objectStateMap(input: StateInput, plan?: Eaterior): Map<string, any>;
export function resolveState(obj: Record<string, any>, states: Map<string, any>): ResolvedState;
export function applyInactive(scene: Scene, plan: Eaterior, floorId: string, states: Map<string, any>, overlayLayer: string): Scene;
export function autoChairs(table: Record<string, any>, unit: number, seatRadius?: number): Array<{ p: [number, number]; r: number }>;
export function formatReadings(readings: Record<string, number> | null | undefined): string | null;
export function asMap(input: StateInput, key: string): Map<string, any>;
export function rot(p: [number, number], deg: number, c: [number, number]): [number, number];
export function f(n: number): string;

export class WallGeom {
  constructor(wall: Record<string, any>);
  length: number;
  curved: boolean;
  pointAt(t: number): [number, number];
  tangentAt(t: number): [number, number];
  segmentPath(t0: number, t1: number, extendStart?: number, extendEnd?: number): string;
}
