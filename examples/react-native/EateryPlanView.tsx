/**
 * React Native view for Eatery Plan, using react-native-svg.
 *
 *   npm install react-native-svg
 *   copy js/src/eateryplan-render.mjs and js/src/eateryplan-illustrated.mjs into your app
 *
 * The same display list drives web and mobile, so both draw identical plans.
 */
import React, { useMemo } from "react";
import Svg, { Defs, G, Image as SvgImage, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { buildScene, groupByObject } from "./eateryplan-render.mjs";
import { buildIllustratedScene } from "./eateryplan-illustrated.mjs";

type Props = {
  plan: any;
  floorId?: string;
  theme?: "plain" | "illustrated";
  tableStates?: any;
  objectStates?: any;          // live component state: active / open / power
  readings?: Record<string, any>;
  width?: number | string;
  height?: number | string;
  resolveAsset?: (asset: any) => string | null;
  onPressObject?: (ref: { type: string; id: string }) => void;
};

export function EateryPlanView({ plan, floorId, theme = "illustrated", tableStates, objectStates, readings, width = "100%", height = "100%",
  resolveAsset, onPressObject }: Props) {
  const scene = useMemo(
    () => (theme === "illustrated" ? buildIllustratedScene : buildScene)(plan, { floorId, tableStates, objectStates, readings, resolveAsset }),
    [plan, floorId, theme, tableStates, objectStates, readings, resolveAsset],
  );

  return (
    <Svg width={width} height={height} viewBox={scene.viewBox} preserveAspectRatio="xMidYMid meet">
      {scene.defs?.length ? (
        <Defs>
          {scene.defs.map((d: any) =>
            d.type === "pattern" ? (
              <Pattern key={d.id} id={d.id} patternUnits="userSpaceOnUse" width={d.width} height={d.height}
                patternTransform={d.rotation ? `rotate(${d.rotation})` : undefined}>
                {d.items.map((p: any, j: number) => (
                  <Path key={j} d={p.d} fill={p.fill} stroke={p.stroke ?? "none"} strokeWidth={p.strokeWidth ?? 0} opacity={p.opacity ?? 1} />
                ))}
              </Pattern>
            ) : d.type === "radialGradient" ? (
              <RadialGradient key={d.id} id={d.id} cx={String(d.cx)} cy={String(d.cy)} r={String(d.r)}>
                {d.stops.map((st: any, j: number) => (
                  <Stop key={j} offset={String(st.offset)} stopColor={st.color} stopOpacity={st.opacity ?? 1} />
                ))}
              </RadialGradient>
            ) : (
              <LinearGradient key={d.id} id={d.id} x1={String(d.x1)} y1={String(d.y1)} x2={String(d.x2)} y2={String(d.y2)}>
                {d.stops.map((st: any, j: number) => (
                  <Stop key={j} offset={String(st.offset)} stopColor={st.color} stopOpacity={st.opacity ?? 1} />
                ))}
              </LinearGradient>
            ),
          )}
        </Defs>
      ) : null}
      <Rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.background} />
      {/* each run of one plan object's items is its own pressable component; drawing order is preserved */}
      {groupByObject(scene).map((group: any, gi: number) => (
        <G key={`${group.ref ? `${group.ref.type}:${group.ref.id}` : "deco"}-${gi}`}
          onPress={group.ref && onPressObject ? () => onPressObject(group.ref) : undefined}>
          {group.items.map((it: any, i: number) => {
            if (it.type === "path") {
              return (
                <Path key={i} d={it.d} fill={it.fill} stroke={it.stroke ?? "none"} strokeWidth={it.strokeWidth ?? 0}
                  strokeDasharray={it.dash ?? undefined} strokeLinecap={it.linecap} strokeLinejoin="round" opacity={it.opacity ?? 1} />
              );
            }
            if (it.type === "text") {
              return (
                <G key={i} rotation={it.rotation || 0} origin={`${it.x}, ${it.y}`}>
                  <SvgText x={it.x} y={it.y} fontSize={it.fontSize} fontWeight={String(it.weight ?? 400)} fill={it.fill}
                    opacity={it.opacity ?? 1} textAnchor="middle" alignmentBaseline="central">{it.text}</SvgText>
                </G>
              );
            }
            if (it.type === "image") {
              return (
                <SvgImage key={i} href={{ uri: it.href }} x={it.x} y={it.y} width={it.width} height={it.height}
                  opacity={it.opacity} preserveAspectRatio="none" />
              );
            }
            return null;
          })}
        </G>
      ))}
    </Svg>
  );
}
