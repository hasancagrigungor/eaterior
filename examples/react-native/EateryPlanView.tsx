/**
 * React Native view for Eatery Plan, using react-native-svg.
 *
 *   npm install react-native-svg
 *   copy js/src/eateryplan-render.mjs into your app (or install it from the repository)
 *
 * The same display list drives web and mobile, so both draw identical plans.
 */
import React, { useMemo } from "react";
import Svg, { G, Image as SvgImage, Path, Rect, Text as SvgText } from "react-native-svg";
import { buildScene } from "./eateryplan-render.mjs";

type Props = {
  plan: any;
  floorId?: string;
  tableStates?: any;
  readings?: Record<string, any>;
  width?: number | string;
  height?: number | string;
  resolveAsset?: (asset: any) => string | null;
  onPressObject?: (ref: { type: string; id: string }) => void;
};

export function EateryPlanView({ plan, floorId, tableStates, readings, width = "100%", height = "100%",
  resolveAsset, onPressObject }: Props) {
  const scene = useMemo(
    () => buildScene(plan, { floorId, tableStates, readings, resolveAsset }),
    [plan, floorId, tableStates, readings, resolveAsset],
  );

  return (
    <Svg width={width} height={height} viewBox={scene.viewBox} preserveAspectRatio="xMidYMid meet">
      <Rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.background} />
      {scene.items.map((it: any, i: number) => {
        const onPress = it.ref && onPressObject ? () => onPressObject(it.ref) : undefined;
        if (it.type === "path") {
          return (
            <Path key={i} d={it.d} fill={it.fill} stroke={it.stroke} strokeWidth={it.strokeWidth}
              strokeDasharray={it.dash ?? undefined} strokeLinejoin="round" opacity={it.opacity ?? 1} onPress={onPress} />
          );
        }
        if (it.type === "text") {
          return (
            <G key={i} rotation={it.rotation || 0} origin={`${it.x}, ${it.y}`}>
              <SvgText x={it.x} y={it.y} fontSize={it.fontSize} fontWeight={String(it.weight ?? 400)} fill={it.fill}
                textAnchor="middle" alignmentBaseline="central" onPress={onPress}>{it.text}</SvgText>
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
    </Svg>
  );
}
