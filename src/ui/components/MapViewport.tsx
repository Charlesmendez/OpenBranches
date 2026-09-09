import { useEffect, useRef, useState } from 'react';
import {
  Panel,
  useNodesInitialized,
  useReactFlow,
  useStore,
  getViewportForBounds,
} from '@xyflow/react';
import { Maximize2 } from 'lucide-react';
import { mapHasVisibleCard } from '../mapViewport';

/** Recover saved views after a resize or a changed layout. This component does
 * not change ReactFlow's identity or fitView configuration during pan events. */
export function MapViewport({ layout, restored }: { layout: string; restored: boolean }) {
  const flow = useReactFlow();
  const initialized = useNodesInitialized();
  const viewportReady = useStore((state) => !!state.panZoom);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const transform = useStore((state) => state.transform);
  const first = useRef(true);
  const [offscreen, setOffscreen] = useState(false);
  const visible = () =>
    mapHasVisibleCard(
      flow.getNodes().map((node) => ({
        ...node.position,
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
      })),
      flow.getViewport(),
      width,
      height,
    );
  // In ReactFlow 12.11 fitView schedules a controlled-node update. This map is
  // read-only and owns no node-change handler, so that queue can wait until the
  // next repository scan. Fit the measured bounds directly instead.
  const fit = () => {
    if (!viewportReady || !initialized || !width || !height) return;
    const bounds = flow.getNodesBounds(flow.getNodes());
    if (bounds.width && bounds.height)
      void flow.setViewport(getViewportForBounds(bounds, width, height, 0.3, 1, 0.18), {
        duration: 0,
      });
  };
  useEffect(() => {
    if (!initialized || !viewportReady || width <= 0 || height <= 0) return;
    const frame = requestAnimationFrame(() => {
      if ((first.current && !restored) || !visible()) fit();
      first.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, viewportReady, width, height, layout]);
  useEffect(() => {
    if (initialized) setOffscreen(!visible());
  }, [transform, initialized, width, height, layout]);
  return (
    <Panel position="top-right">
      <button className={`map-recenter ${offscreen ? 'offscreen' : ''}`} onClick={fit}>
        <Maximize2 size={13} />
        {offscreen ? 'Bring branches back' : 'Recenter'}
      </button>
    </Panel>
  );
}
