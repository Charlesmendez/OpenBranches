import { BaseEdge, type EdgeProps } from '@xyflow/react';

/** Route through the gutters between cards, never through another branch. */
export function MapConnection(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, data } = props;
  const lane = sourceX - 180 + Number(data?.lane ?? 0) * 4;
  const bus = 112 + Number(data?.lane ?? 0) * 16;
  const path = `M ${sourceX} ${sourceY} L ${sourceX} ${sourceY - 12} L ${lane} ${sourceY - 12} L ${lane} ${bus} L ${targetX} ${bus} L ${targetX} ${targetY}`;
  return (
    <BaseEdge
      {...props}
      path={path}
      labelX={(lane + targetX) / 2}
      labelY={bus}
      style={{ ...props.style, strokeLinejoin: 'round' }}
    />
  );
}
