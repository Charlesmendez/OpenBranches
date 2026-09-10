import { AgentBadges } from './AgentBadges';
import { Search, X, ArrowUpDown, GitBranch } from 'lucide-react';
import { useRef } from 'react';
import type { Branch, Repository } from '../../domain/types';
import { integrationLabel, lifecycleOf, locationOf, relativeTime } from '../../domain/branches';
import { EmptyState, IntegrationBadge, Locations } from './Primitives';
import { useInventoryNavigation } from '../hooks/useInventoryNavigation';
import { IntegrationTargetNotice } from './IntegrationTargetNotice';
import {
  INVENTORY_ROW_HEIGHT as ROW_HEIGHT,
  INVENTORY_HEADER_HEIGHT as HEADER_HEIGHT,
  type InventoryPosition,
} from '../navigation';

export function Inventory({
  repository,
  branches,
  selectedId,
  onSelect,
  initialPosition,
  remember,
  onFocus,
}: {
  repository: Repository;
  branches: Branch[];
  selectedId: string | null;
  onSelect: (branch: Branch) => void;
  initialPosition?: InventoryPosition;
  remember: (position: InventoryPosition) => void;
  onFocus?: (element: HTMLElement) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const navigation = useInventoryNavigation(
    branches,
    selectedId,
    initialPosition,
    remember,
    onSelect,
  );
  const {
    position: { query, location, lifecycle },
    filtered,
    scrollRef,
    filter,
  } = navigation;
  const targets = repository.targets;
  const columns = `minmax(220px, 1.65fr) 175px ${targets.map(() => '140px').join(' ')} 90px`;
  const minWidth = 220 + 175 + targets.length * 140 + 90 + (targets.length + 2) * 12 + 30;
  return (
    <div className="inventory">
      <div className="inventory-search">
        <Search size={18} />
        <input
          ref={searchRef}
          aria-label="Search branches"
          maxLength={2048}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          value={query}
          onChange={(e) => filter({ query: e.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && filtered.length) {
              event.preventDefault();
              navigation.focusList(0);
            }
          }}
          placeholder="Search any branch or task…"
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => {
              filter({ query: '' });
              searchRef.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        )}
        <span>All {branches.length}</span>
      </div>
      <div className="inventory-filters">
        <div>
          <select
            aria-label="Filter location"
            value={location}
            onChange={(e) => filter({ location: e.target.value as InventoryPosition['location'] })}
          >
            <option value="all">All locations</option>
            <option value="local">On this Mac</option>
            <option value="remote">With Git remote evidence</option>
          </select>
          <select
            aria-label="Filter lifecycle"
            value={lifecycle}
            onChange={(e) =>
              filter({ lifecycle: e.target.value as InventoryPosition['lifecycle'] })
            }
          >
            <option value="all">Any activity</option>
            <option value="active">Active work</option>
            <option value="integrated">Integrated</option>
            <option value="quiet">Quiet</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>
        <span>
          <ArrowUpDown size={12} />
          Recently updated
        </span>
      </div>
      <IntegrationTargetNotice repository={repository} targets={targets} context="inventory" />
      <div className="inventory-table">
        <div
          className="inventory-scroll"
          ref={scrollRef}
          role="listbox"
          aria-label="Branch inventory"
          aria-describedby={navigation.helpId}
          aria-activedescendant={
            navigation.active ? navigation.rowId(navigation.activeIndex) : undefined
          }
          tabIndex={0}
          onFocus={(event) => {
            navigation.onFocus();
            onFocus?.(event.currentTarget);
          }}
          onKeyDown={navigation.onKeyDown}
          onScroll={navigation.recordScroll}
        >
          <div
            className="inventory-sheet"
            style={{ minWidth: filtered.length ? minWidth : undefined }}
          >
            {filtered.length > 0 && (
              <div
                className="inventory-header"
                aria-hidden="true"
                style={{ gridTemplateColumns: columns, height: HEADER_HEIGHT }}
              >
                <span>Task / branch</span>
                <span>Location</span>
                {targets.map((target) => (
                  <span
                    key={target.name}
                    className={
                      ['main', 'master'].includes(target.name) ? 'amber-text' : 'blue-text'
                    }
                  >
                    <GitBranch size={13} />
                    {target.name}
                    {target.role === 'default' && <em>default</em>}
                  </span>
                ))}
                <span>Updated</span>
              </div>
            )}
            {!filtered.length ? (
              <EmptyState
                icon={Search}
                title="No matching branches"
                description="Try a different search or broaden the filters."
              />
            ) : (
              <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
                {navigation.indices.map((index) => {
                  const branch = filtered[index];
                  const rowId = navigation.rowId(index);
                  return (
                    <div
                      key={branch.id}
                      id={rowId}
                      className={`inventory-row ${branch.id === selectedId ? 'selected' : ''} ${branch.id === navigation.active?.id ? 'cursor' : ''}`}
                      role="option"
                      aria-selected={branch.id === selectedId}
                      aria-posinset={index + 1}
                      aria-setsize={filtered.length}
                      aria-labelledby={`${rowId}-title`}
                      aria-describedby={`${rowId}-details`}
                      style={{
                        gridTemplateColumns: columns,
                        position: 'absolute',
                        top: index * ROW_HEIGHT,
                        height: ROW_HEIGHT,
                      }}
                      onClick={() => navigation.select(index)}
                    >
                      <span className="table-title">
                        <i className={`branch-dot ${lifecycleOf(branch)}`} />
                        <span>
                          <strong id={`${rowId}-title`}>{branch.title}</strong>
                          <span className="branch-ref-line">
                            <code>{branch.name}</code>
                            <AgentBadges branch={branch} compact />
                          </span>
                        </span>
                      </span>
                      <span>
                        <Locations branch={branch} repository={repository} compact />
                      </span>
                      {targets.map((target) => (
                        <span key={target.name}>
                          <IntegrationBadge state={branch.integration[target.name]} />
                        </span>
                      ))}
                      <span className="table-time">{relativeTime(branch.updatedAt)}</span>
                      <span id={`${rowId}-details`} className="sr-only">
                        {branch.name}. {locationOf(branch, repository)}.
                        {targets.length
                          ? ` ${targets
                              .map(
                                (target) =>
                                  `${target.name}: ${integrationLabel(branch.integration[target.name])}`,
                              )
                              .join('. ')}.`
                          : ' Integration target unavailable.'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="inventory-footer">
        <span role="status">
          {filtered.length} {filtered.length === 1 ? 'branch' : 'branches'}{' '}
          {query || lifecycle !== 'all' || location !== 'all'
            ? `matching · ${branches.length} in this project`
            : 'in this project'}
        </span>
        <span id={navigation.helpId}>↑ ↓ to browse · Enter to inspect</span>
      </div>
    </div>
  );
}
