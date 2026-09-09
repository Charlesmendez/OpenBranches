import { memo, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
} from '@xyflow/react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Laptop,
  Layers,
  Radio,
} from 'lucide-react';
import type { Branch, Repository } from '../../domain/types';
import { BranchStatus, EmptyState, Locations } from './Primitives';
import { clusterFor, MAP_PAGE_SIZE, type MapPosition } from '../navigation';
import '@xyflow/react/dist/style.css';

type MapData = {
  kind: 'target' | 'branch' | 'cluster';
  label: string;
  tone: string;
  branch?: Branch;
  count?: number;
  preview?: string;
  hint?: string;
  clusterId?: string;
  activate?: () => void;
} & Record<string, unknown>;
type MapNode = Node<MapData, 'mapNode'>;
const MapNodeView = memo(function MapNodeView({ data, selected }: NodeProps<MapNode>) {
  const keyboard = {
    role: 'button',
    tabIndex: 0,
    'aria-label':
      data.kind === 'cluster'
        ? `Expand ${data.label}, ${data.count} branches`
        : `Inspect ${data.label}`,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        data.activate?.();
      }
    },
  };
  if (data.kind === 'target')
    return (
      <div className={`target-node ${data.tone}`}>
        <Handle type="target" position={Position.Bottom} />
        <GitBranch size={18} />
        <div>
          <strong>{data.label}</strong>
          <small>{data.hint}</small>
        </div>
        <span className="target-dot" />
      </div>
    );
  if (data.kind === 'branch')
    return (
      <div {...keyboard} className={`branch-map-card ${data.tone} ${selected ? 'selected' : ''}`}>
        <Handle type="source" position={Position.Top} />
        <span className="node-indicator" />
        <div className="node-card-title">
          {data.label}
          <ArrowUpRight size={15} />
        </div>
        <code>{data.branch!.name}</code>
        <div className="node-card-bottom">
          <Locations branch={data.branch!} />
          <BranchStatus branch={data.branch!} />
        </div>
      </div>
    );
  const Icon =
    data.clusterId === 'review' ? GitPullRequest : data.clusterId === 'local' ? Laptop : Layers;
  return (
    <div {...keyboard} className={`cluster-card ${data.tone}`}>
      <Handle type="source" position={Position.Top} />
      <div className="cluster-heading">
        <span className="cluster-icon">
          <Icon size={18} />
        </span>
        <span>{data.label}</span>
        <ChevronRight size={16} />
      </div>
      <div className="cluster-number">
        {data.count}
        <span>branches</span>
      </div>
      <div className="cluster-preview">{data.preview}</div>
      <div className="cluster-footer">
        <span>{data.hint}</span>
        <ArrowUpRight size={14} />
      </div>
    </div>
  );
});
const nodeTypes = { mapNode: MapNodeView };
const colors: Record<string, string> = {
  teal: '#6dcbb2',
  violet: '#a39be9',
  amber: '#e2c47d',
  neutral: '#808b94',
};

export function BranchMap({
  repository,
  branches,
  selectedId,
  onSelect,
  onInventory,
  initialPosition,
  remember,
  onScopeChange,
}: {
  repository: Repository;
  branches: Branch[];
  selectedId: string | null;
  onSelect: (branch: Branch) => void;
  onInventory: () => void;
  initialPosition?: MapPosition;
  remember: (position: MapPosition) => void;
  onScopeChange: () => void;
}) {
  const [position, setPosition] = useState<MapPosition>(
    initialPosition ?? { expanded: null, page: 0 },
  );
  const { expanded, page } = position;
  const move = (next: MapPosition) => {
    setPosition(next);
    remember(next);
  };
  const changeScope = (next: MapPosition) => {
    onScopeChange();
    move(next);
  };
  const clusters = useMemo(
    () =>
      [
        {
          id: 'review',
          label: 'Pull requests',
          tone: 'violet',
          branches: branches.filter((b) => clusterFor(b) === 'review'),
          hint: 'Drafts and review',
        },
        {
          id: 'local',
          label: 'On your Mac',
          tone: 'amber',
          branches: branches.filter((b) => clusterFor(b) === 'local'),
          hint: 'Local branches',
        },
        {
          id: 'tracked',
          label: 'Connected work',
          tone: 'teal',
          branches: branches.filter((b) => clusterFor(b) === 'tracked'),
          hint: 'With remote references',
        },
      ].filter((c) => c.branches.length),
    [branches],
  );
  const cluster = clusters.find((c) => c.id === expanded);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil((cluster?.branches.length ?? 0) / MAP_PAGE_SIZE) - 1),
  );
  const visible = useMemo(
    () =>
      cluster?.branches.slice(currentPage * MAP_PAGE_SIZE, (currentPage + 1) * MAP_PAGE_SIZE) ?? [],
    [cluster, currentPage],
  );
  const { nodes, edges } = useMemo(() => {
    const nodes: MapNode[] = repository.targets.map((target, i) => ({
      id: `target:${target.name}`,
      type: 'mapNode',
      position: { x: Math.max(0, (948 - repository.targets.length * 265) / 2) + i * 265, y: 20 },
      draggable: false,
      data: {
        kind: 'target',
        label: target.name,
        tone: ['master', 'main'].includes(target.name) ? 'amber' : 'teal',
        hint:
          target.source === 'local'
            ? 'Local history'
            : target.source === 'github'
              ? 'GitHub history'
              : 'Cached history',
      },
    }));
    const edges: Edge[] = [];
    if (cluster) {
      visible.forEach((branch, i) => {
        const tone = cluster.tone;
        nodes.push({
          id: branch.id,
          type: 'mapNode',
          position: { x: (i % 3) * 330, y: 160 + Math.floor(i / 3) * 180 },
          selected: branch.id === selectedId,
          draggable: false,
          data: {
            kind: 'branch',
            label: branch.title,
            tone,
            branch,
            activate: () => onSelect(branch),
          },
        });
        const targetName =
          branch.pullRequest?.state === 'open'
            ? branch.pullRequest.base
            : Object.entries(branch.integration).find(([, s]) => s === 'integrated')?.[0];
        if (targetName && repository.targets.some((t) => t.name === targetName)) {
          const integrated = branch.integration[targetName] === 'integrated';
          edges.push({
            id: `${branch.id}:${targetName}`,
            source: branch.id,
            target: `target:${targetName}`,
            type: 'smoothstep',
            style: {
              stroke: colors[tone],
              strokeWidth: branch.id === selectedId ? 2.3 : 1.3,
              strokeDasharray: integrated ? undefined : '5 6',
              opacity: selectedId && selectedId !== branch.id ? 0.25 : 0.85,
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: colors[tone], width: 15, height: 15 },
          });
        }
      });
    } else {
      clusters.forEach((c, i) => {
        nodes.push({
          id: `cluster:${c.id}`,
          type: 'mapNode',
          position: { x: i * 330, y: 175 },
          draggable: false,
          data: {
            kind: 'cluster',
            label: c.label,
            tone: c.tone,
            count: c.branches.length,
            preview: c.branches[0].title,
            hint: c.hint,
            clusterId: c.id,
            activate: () => {
              changeScope({ expanded: c.id as MapPosition['expanded'], page: 0 });
            },
          },
        });
        const bases = new Set(
          c.branches.map((b) => (b.pullRequest?.state === 'open' ? b.pullRequest.base : undefined)),
        );
        if (bases.size === 1 && !bases.has(undefined)) {
          const target = [...bases][0]!;
          if (repository.targets.some((t) => t.name === target))
            edges.push({
              id: `cluster-edge:${c.id}`,
              source: `cluster:${c.id}`,
              target: `target:${target}`,
              type: 'smoothstep',
              style: { stroke: colors[c.tone], strokeWidth: 1.5, strokeDasharray: '5 6' },
              label: `${c.branches.length} open PRs`,
              labelStyle: { fill: colors[c.tone], fontSize: 12 },
              labelBgStyle: { fill: '#131719' },
              labelBgPadding: [8, 5],
              markerEnd: { type: MarkerType.ArrowClosed, color: colors[c.tone] },
            });
        }
      });
    }
    return { nodes, edges };
  }, [repository.targets, clusters, cluster, selectedId, visible, onSelect]);
  if (!branches.length)
    return (
      <EmptyState
        icon={Check}
        title="Nothing in this group"
        description="Every branch is still available in the full inventory."
      >
        <button className="secondary-button" onClick={onInventory}>
          View all branches
          <ArrowUpRight size={15} />
        </button>
      </EmptyState>
    );
  return (
    <div className="map-panel">
      <div className="map-toolbar">
        <div>
          {cluster ? (
            <button
              className="text-button"
              onClick={() => changeScope({ expanded: null, page: 0 })}
            >
              <ArrowLeft size={14} />
              All groups<span className="toolbar-slash">/</span>
              <strong>{cluster.label}</strong>
            </button>
          ) : (
            <span className="map-instruction">
              <Radio size={14} />
              Expand a group to follow the work
            </span>
          )}
        </div>
        <span className="map-count">
          {cluster
            ? `${visible.length} shown · ${branches.length - visible.length} elsewhere`
            : `${branches.length} branches · ${clusters.length} groups`}
        </span>
      </div>
      <div className="flow-canvas">
        <ReactFlow
          key={`${repository.id}:${cluster?.id ?? 'groups'}:${currentPage}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesFocusable={false}
          fitView={!position.viewport}
          defaultViewport={position.viewport}
          onMoveEnd={(_event, viewport) => {
            move({
              expanded: (cluster?.id as MapPosition['expanded']) ?? null,
              page: currentPage,
              viewport,
            });
          }}
          fitViewOptions={{ padding: 0.16, maxZoom: 1.06 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnScroll
          zoomOnDoubleClick={false}
          colorMode="dark"
          onNodeClick={(_event, node) => node.data.activate?.()}
        >
          <Background variant={BackgroundVariant.Dots} color="#30373b" gap={22} size={0.8} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </div>
      {cluster && cluster.branches.length > MAP_PAGE_SIZE && (
        <div className="map-pagination">
          <button
            disabled={currentPage === 0}
            onClick={() => changeScope({ expanded: position.expanded, page: currentPage - 1 })}
          >
            Previous
          </button>
          <span>
            {currentPage * MAP_PAGE_SIZE + 1}–
            {Math.min((currentPage + 1) * MAP_PAGE_SIZE, cluster.branches.length)} of{' '}
            {cluster.branches.length}
          </span>
          <button
            disabled={(currentPage + 1) * MAP_PAGE_SIZE >= cluster.branches.length}
            onClick={() => changeScope({ expanded: position.expanded, page: currentPage + 1 })}
          >
            Next
          </button>
          <button className="text-button" onClick={onInventory}>
            Search all
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-line solid" />
          Verified history
        </span>
        <span>
          <i className="legend-line" />
          Open PR target
        </span>
        <span className="map-legend-note">Integration targets stay visible</span>
      </div>
    </div>
  );
}
