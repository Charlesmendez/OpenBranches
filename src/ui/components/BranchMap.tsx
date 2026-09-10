import { AgentBadges, ToolIcon } from './AgentBadges';
import { memo, useEffect, useMemo, useState, useRef } from 'react';
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
import type { Branch, Repository, CodexStatus } from '../../domain/types';
import { EmptyState, Locations } from './Primitives';
import { clusterFor, MAP_PAGE_SIZE, type MapPosition } from '../navigation';
import '@xyflow/react/dist/style.css';
import { MapViewport } from './MapViewport';
import { MapConnection } from './MapConnection';
import { BranchActivity } from './BranchActivity';
import { mapEvidence, mapTargets, type MapTargetEvidence } from '../../domain/mapEvidence';
import { targetHistoryLabel } from '../../domain/integrationTargets';
import { idleWork } from '../../domain/branchActivity';
import { useClock } from '../hooks/useClock';
import {
  prioritizeWork,
  workSignal,
  type WorkSignal,
  type WorkSignalKind,
} from '../../domain/workSpotlight';
import { IntegrationTargetNotice } from './IntegrationTargetNotice';

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
  evidence?: MapTargetEvidence[];
  signal?: WorkSignal;
  liveCount?: number;
  now?: number;
} & Record<string, unknown>;
type MapNode = Node<MapData, 'mapNode'>;
const MapNodeView = memo(function MapNodeView({ data, selected }: NodeProps<MapNode>) {
  const SignalIcon = data.signal ? signalIcons[data.signal.kind] : Radio;
  const keyboard = {
    role: 'button',
    tabIndex: 0,
    'aria-label':
      data.kind === 'cluster'
        ? `Expand ${data.label}, ${data.count} branches`
        : `Inspect ${data.label}${data.signal ? `, ${data.signal.label}` : ''}`,
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
      <div
        {...keyboard}
        data-branch-id={data.branch!.id}
        className={`branch-map-card ${data.tone} ${data.signal ? `work-${data.signal.kind}` : ''} ${selected ? 'selected' : ''}`}
      >
        <Handle type="source" position={Position.Top} />
        <span className="node-indicator" />
        {data.signal && (
          <div className={`map-work-signal ${data.signal.kind}`} title={data.signal.detail}>
            {data.signal.tools.length ? (
              data.signal.tools.slice(0, 2).map((tool) => <ToolIcon key={tool} tool={tool} />)
            ) : (
              <SignalIcon size={12} />
            )}
            <span>{data.signal.label}</span>
          </div>
        )}
        <div className="node-card-title">
          {data.label}
          <ArrowUpRight size={15} />
        </div>
        <div className="branch-ref-line">
          <code>{data.branch!.name}</code>
          <AgentBadges branch={data.branch!} compact />
        </div>
        <div className="node-card-bottom">
          <Locations branch={data.branch!} />
          {data.branch!.pullRequest && (
            <span className="pill neutral">PR #{data.branch!.pullRequest.number}</span>
          )}
        </div>
        <BranchActivity branch={data.branch!} now={data.now} showPresence={!data.signal} />
        <div className="map-target-checks">
          {data.evidence?.map((item) => (
            <span
              key={item.target.name}
              className={`map-target-check ${item.state} ${item.stale ? 'cached' : ''}`}
              title={item.detail}
            >
              {item.state === 'integrated' ? (
                <Check size={11} />
              ) : (
                <span>{item.state === 'pending' ? '−' : '?'}</span>
              )}
              {item.label}
            </span>
          ))}
        </div>
      </div>
    );
  const Icon =
    data.clusterId === 'review' ? GitPullRequest : data.clusterId === 'local' ? Laptop : Layers;
  return (
    <div
      {...keyboard}
      className={`cluster-card ${data.tone} ${data.signal ? `work-${data.signal.kind}` : ''}`}
    >
      <Handle type="source" position={Position.Top} />
      <div className="cluster-heading">
        <span className="cluster-icon">
          <Icon size={18} />
        </span>
        <span>{data.label}</span>
        {data.signal && (
          <span className={`cluster-work-signal ${data.signal.kind}`}>
            <i />
            {clusterSignalLabel(data.signal, data.liveCount)}
          </span>
        )}
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
const signalIcons = {
  live: Radio,
  waiting: Radio,
  changes: Laptop,
  recent: Radio,
  checkout: Laptop,
} satisfies Record<WorkSignalKind, typeof Radio>;
const clusterSignalLabel = (signal: WorkSignal, liveCount = 0) =>
  liveCount
    ? `${liveCount} live`
    : signal.kind === 'waiting'
      ? 'Waiting'
      : signal.kind === 'changes'
        ? 'In progress'
        : signal.kind === 'recent'
          ? 'Recent'
          : 'Current';
const nodeTypes = { mapNode: MapNodeView };
const edgeTypes = { mapConnection: MapConnection };
const colors: Record<string, string> = {
  blue: '#8aabff',
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
  liveState,
}: {
  repository: Repository;
  branches: Branch[];
  selectedId: string | null;
  onSelect: (branch: Branch) => void;
  onInventory: () => void;
  initialPosition?: MapPosition;
  remember: (position: MapPosition) => void;
  onScopeChange: () => void;
  liveState?: CodexStatus['liveState'];
}) {
  const now = useClock();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MapPosition>(
    initialPosition ?? { expanded: null, page: 0 },
  );
  const positionRef = useRef(position);
  const { expanded, page } = position;
  const source = position.source ?? 'local';
  const targets = useMemo(() => mapTargets(repository, source), [repository, source]);
  const move = (next: MapPosition) => {
    positionRef.current = next;
    setPosition(next);
    remember(next);
  };
  const changeScope = (next: MapPosition) => {
    onScopeChange();
    move({ source, ...next });
  };
  const clusters = useMemo(() => {
    return [
      {
        id: 'review',
        label: 'Pull requests',
        tone: 'violet',
        branches: prioritizeWork(
          branches.filter((b) => clusterFor(b) === 'review'),
          repository.path,
          now,
        ),
        hint: 'Drafts and review',
      },
      {
        id: 'local',
        label: 'On your Mac',
        tone: 'amber',
        branches: prioritizeWork(
          branches.filter((b) => clusterFor(b) === 'local'),
          repository.path,
          now,
        ),
        hint: 'Local branches',
      },
      {
        id: 'tracked',
        label: 'Remote branches',
        tone: 'blue',
        branches: prioritizeWork(
          branches.filter((b) => clusterFor(b) === 'tracked'),
          repository.path,
          now,
        ),
        hint: 'Published or cached references',
      },
    ].filter((c) => c.branches.length);
  }, [branches, repository.path, now]);
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
  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() =>
      panel.current
        ?.querySelector<HTMLElement>(`[data-branch-id="${CSS.escape(selectedId)}"]`)
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selectedId, currentPage, expanded]);
  const { nodes, edges } = useMemo(() => {
    const evidenceByBranch = new Map(
      branches.map((branch) => [branch.id, mapEvidence(repository, branch, now, source, targets)]),
    );
    const nodes: MapNode[] = targets.map((target, i) => ({
      id: `target:${target.name}`,
      type: 'mapNode',
      position: { x: Math.max(0, (1020 - targets.length * 265) / 2) + i * 265, y: 20 },
      draggable: false,
      width: 230,
      height: 68,
      measured: { width: 230, height: 68 },
      data: {
        kind: 'target',
        label: target.name,
        tone:
          target.role === 'default' || ['master', 'main'].includes(target.name) ? 'amber' : 'blue',
        hint: targetHistoryLabel(target),
      },
    }));
    const edges: Edge[] = [];
    if (cluster) {
      visible.forEach((branch, i) => {
        const tone = cluster.tone;
        nodes.push({
          id: branch.id,
          type: 'mapNode',
          position: {
            x: (i % 3) * 350,
            y: (targets.length ? 175 : 45) + Math.floor(i / 3) * 235,
          },
          selected: branch.id === selectedId,
          draggable: false,
          width: 320,
          height: 205,
          measured: { width: 320, height: 205 },
          data: {
            kind: 'branch',
            label: branch.title,
            tone,
            branch,
            evidence: evidenceByBranch.get(branch.id),
            signal: workSignal(branch, repository.path, now),
            now,
            activate: () => onSelect(branch),
          },
        });
        for (const item of evidenceByBranch.get(branch.id) ?? []) {
          if (!item.connection) continue;
          const targetName = item.target.name;
          const integrated = item.connection === 'history';
          const color = item.stale ? colors.neutral : integrated ? colors.blue : colors.violet;
          edges.push({
            id: `${branch.id}:${targetName}`,
            source: branch.id,
            target: `target:${targetName}`,
            type: 'mapConnection',
            data: { lane: targets.findIndex((target) => target.name === targetName) },
            style: {
              stroke: color,
              strokeWidth: branch.id === selectedId ? 2.3 : 1.3,
              strokeDasharray: integrated ? undefined : '5 6',
              opacity: selectedId && selectedId !== branch.id ? 0.25 : 0.85,
            },
            label:
              branch.id === selectedId
                ? integrated
                  ? `In ${targetName}${item.stale ? ' · cached' : ''}`
                  : item.pullLabel
                : undefined,
            labelStyle: { fill: color, fontSize: 11 },
            labelBgStyle: { fill: '#17191e' },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
          });
        }
      });
    } else {
      clusters.forEach((c, i) => {
        const signals = c.branches.flatMap((branch) => {
          const signal = workSignal(branch, repository.path, now);
          return signal ? [{ branch, signal }] : [];
        });
        const primarySignal = signals[0];
        const liveCount = signals.filter(({ signal }) => signal.kind === 'live').length;
        const idleCount = c.branches.filter((b) => idleWork(b, now)).length;
        nodes.push({
          id: `cluster:${c.id}`,
          type: 'mapNode',
          position: { x: i * 330, y: targets.length ? 175 : 45 },
          draggable: false,
          width: 300,
          height: 200,
          measured: { width: 300, height: 200 },
          data: {
            kind: 'cluster',
            label: c.label,
            tone: c.tone,
            count: c.branches.length,
            preview: primarySignal?.branch.title ?? c.branches[0].title,
            signal: primarySignal?.signal,
            liveCount,
            hint: liveCount
              ? `${liveCount} live now · ${idleCount} idle`
              : primarySignal
                ? `${primarySignal.signal.label} · ${idleCount} idle`
                : `${liveState === 'connected' || liveState === 'partial' ? 'No confirmed live work' : 'Live agent status unavailable'} · ${idleCount} idle`,
            clusterId: c.id,
            activate: () => {
              changeScope({ expanded: c.id as MapPosition['expanded'], page: 0 });
            },
          },
        });
        for (const target of targets) {
          const facts = c.branches.map((branch) =>
            evidenceByBranch.get(branch.id)!.find((item) => item.target.name === target.name)!,
          );
          const integrated = facts.every((item) => item.connection === 'history');
          const pr = facts.every((item) => item.connection === 'pull-request');
          if (integrated || pr)
            edges.push({
              id: `cluster-edge:${c.id}:${target.name}`,
              source: `cluster:${c.id}`,
              target: `target:${target.name}`,
              type: 'smoothstep',
              style: {
                stroke: colors[c.tone],
                strokeWidth: 1.5,
                strokeDasharray: integrated ? undefined : '5 6',
              },
              label: integrated
                ? `${c.branches.length} in ${target.name}${facts.some((f) => f.stale) ? ' · cached' : ''}`
                : `${c.branches.length} open PRs`,
              labelStyle: { fill: colors[c.tone], fontSize: 12 },
              labelBgStyle: { fill: '#131719' },
              labelBgPadding: [8, 5],
              markerEnd: { type: MarkerType.ArrowClosed, color: colors[c.tone] },
            });
        }
      });
    }
    return { nodes, edges };
  }, [
    repository,
    branches,
    targets,
    source,
    clusters,
    cluster,
    selectedId,
    visible,
    onSelect,
    now,
    liveState,
  ]);
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
    <div className="map-panel" ref={panel}>
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
        <div className="map-source-toggle" aria-label="Branch copy to compare">
          <button
            aria-pressed={source === 'local'}
            onClick={() => changeScope({ expanded, page: currentPage, source: 'local' })}
          >
            Local Git
          </button>
          <button
            aria-pressed={source === 'github'}
            onClick={() => changeScope({ expanded, page: currentPage, source: 'github' })}
          >
            GitHub
          </button>
        </div>
        <span className="map-count">
          {cluster
            ? `${visible.length} shown · ${branches.length - visible.length} elsewhere`
            : `${branches.length} branches · ${clusters.length} groups`}
        </span>
      </div>
      <IntegrationTargetNotice
        repository={repository}
        targets={targets}
        source={source}
        partial={repository.github?.partial}
      />
      <div className="flow-canvas">
        <ReactFlow
          key={`${repository.id}:${source}:${cluster?.id ?? 'groups'}:${currentPage}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesFocusable={false}
          defaultViewport={position.viewport}
          onMoveEnd={(event, viewport) => {
            // Programmatic fitting must not disable fitting mid-flight. Events
            // from an unmounting page must not overwrite the new scope either.
            if (
              !event ||
              positionRef.current.expanded !== expanded ||
              positionRef.current.page !== page ||
              (positionRef.current.source ?? 'local') !== source
            )
              return;
            move({
              source,
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
          <MapViewport
            layout={nodes.map((node) => node.id).join('|')}
            restored={!!position.viewport}
          />
          <Background variant={BackgroundVariant.Dots} color="#30373b" gap={22} size={0.8} />
          <Controls showInteractive={false} showFitView={false} position="bottom-left" />
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
      {!!targets.length && (
        <div className="map-legend">
          <span>
            <i className="legend-line solid" />
            {source === 'github'
              ? 'Published commit included'
              : 'Commit included in target history'}
          </span>
          <span>
            <i className="legend-line" />
            Open PR destination
          </span>
          <span className="map-legend-note">No line = no verified connection</span>
        </div>
      )}
    </div>
  );
}
