import { BaseEdge, type EdgeProps } from '@xyflow/react';

/** Route through the gutters between cards, never through another branch. */
export function MapConnection(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
    style,
    markerStart,
    markerEnd,
    interactionWidth,
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
  } = props;
  const lane = sourceX - 180 + Number(data?.lane ?? 0) * 4;
  const bus = 112 + Number(data?.lane ?? 0) * 16;
  const path = `M ${sourceX} ${sourceY} L ${sourceX} ${sourceY - 12} L ${lane} ${sourceY - 12} L ${lane} ${bus} L ${targetX} ${bus} L ${targetX} ${targetY}`;
  return (
    <BaseEdge
      id={id}
      path={path}
      labelX={(lane + targetX) / 2}
      labelY={bus}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
      style={{ ...style, strokeLinejoin: 'round' }}
    />
  );
}
