import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Clock,
  GitBranch,
  Layers,
  Laptop,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { TeamApiError, TeamClient } from '../../src/team/client';
import type { TeamSession } from '../../src/team/responses';
import { Brand } from '../../src/ui/components/Primitives';
import { useAction, useTeamData } from './hooks';
import { Avatar, Empty, Modal, Notice, dateLabel } from './primitives';
import { SharedBoard } from './SharedBoard';
import { PairDevice } from './PairDevice';
import { Access } from './Access';
import { Devices } from './Devices';
export function TeamApp() {
  const [session, setSession] = useState<TeamSession | null>(),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [reload, setReload] = useState(0),
    [create, setCreate] = useState(false),
    [name, setName] = useState(''),
    action = useAction();
  const client = useMemo(
    () =>
      new TeamClient(fetch, (path) => {
        if (path === '/api/session') setSession(null);
        else {
          setSession(undefined);
          setReload((value) => value + 1);
        }
      }),
    [],
  );
  useEffect(() => {
    const abort = new AbortController();
    void client
      .session(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setSession(value);
          setError('');
        }
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        if (error instanceof TeamApiError && error.status === 401) setSession(null);
        else setError(error.message);
      });
    return () => abort.abort();
  }, [client, reload]);
  const workspace =
    session?.workspaces.find((workspace) => workspace.id === selected) ?? session?.workspaces[0];
  if (!session)
    return (
      <>
        <FictionalBanner />
        <div className="team-welcome">
          <header>
            <Brand />
            <span className="preview-tag">Team preview</span>
          </header>
          <div className="welcome-copy">
            <span className="eyebrow">A SHARED VIEW OF THE WORK</span>
            <h1>
              Every branch.
              <br />
              <em>A clearer picture.</em>
            </h1>
            <p>
              Bring your team's projects, people, and shared local work into one place. Each
              teammate stays in control of what leaves their Mac.
            </p>
            {error ? (
              <>
                <Notice error>{error}</Notice>
                <button className="secondary" onClick={() => setReload((value) => value + 1)}>
                  Try again
                </button>
              </>
            ) : session === undefined ? (
              <Notice>Connecting to your team service…</Notice>
            ) : (
              <a className="primary" href="/auth/github">
                Continue with GitHub <ArrowRight size={17} />
              </a>
            )}
            <small>Sign-in identifies your account. It does not share local projects.</small>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="art-trunk" />
            {['Your people', 'Their projects', 'The work ahead'].map((label, index) => (
              <div className={'art-lane lane-' + index} key={label}>
                <span />
                <div>
                  {index === 0 ? (
                    <Users size={22} />
                  ) : index === 1 ? (
                    <Layers size={22} />
                  ) : (
                    <GitBranch size={22} />
                  )}
                  <strong>{label}</strong>
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  return (
    <>
      <FictionalBanner />
      <div className="team-root">
        <aside className="team-sidebar">
          <Brand />
          <div className="workspace-picker">
            <label htmlFor="workspace">TEAM WORKSPACE</label>
            <select
              id="workspace"
              value={workspace?.id ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!session.workspaces.length && <option value="">No workspace yet</option>}
              {session.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          {!session.complete && <Notice>Your workspace list is incomplete.</Notice>}
          {session.canCreateWorkspace && (
            <button
              className="new-workspace"
              onClick={() => {
                action.clear();
                setName('');
                setCreate(true);
              }}
            >
              <Plus size={15} />
              New workspace
            </button>
          )}
          <div className="sidebar-explainer">
            <ShieldCheck size={20} />
            <strong>Shared by choice</strong>
            <p>Personal projects stay on each person's Mac until they choose to share.</p>
          </div>
          <div className="sidebar-account">
            <Avatar name={session.user.login} />
            <span>
              <strong>@{session.user.login}</strong>
              <small>GitHub account</small>
            </span>
            <button
              className="icon"
              aria-label="Sign out"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await client.signOut();
                  setSession(null);
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
          {action.error && !create && <Notice error>{action.error}</Notice>}
        </aside>
        {workspace ? (
          <Workspace
            key={workspace.id}
            client={client}
            workspace={workspace}
            login={session.user.login}
          />
        ) : (
          <main className="team-main">
            <div className="team-heading">
              <span className="eyebrow">WELCOME TO OPENBRANCHES</span>
              <h1>A place for your team's work.</h1>
            </div>
            <Empty
              title={
                session.canCreateWorkspace ? 'Create your first workspace' : 'Your account is ready'
              }
            >
              {session.canCreateWorkspace
                ? 'Create a workspace, add people and projects, then connect the Macs that will report selected local work.'
                : 'Ask a workspace owner to add your GitHub account. Your personal repositories are not discovered or shared by this service.'}
            </Empty>
            {session.canCreateWorkspace && (
              <button className="primary" onClick={() => setCreate(true)}>
                Create workspace <ArrowRight size={16} />
              </button>
            )}
          </main>
        )}
        {create && (
          <Modal
            title="Create a workspace"
            onClose={() => {
              if (!action.busy) setCreate(false);
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action.run(async () => {
                  const workspace = await client.createWorkspace(name.trim());
                  setSelected(workspace.id);
                  setCreate(false);
                  setReload((value) => value + 1);
                });
              }}
            >
              <p>A workspace brings your team's shared project reports together.</p>
              <label className="field">
                Workspace name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your team or company"
                />
              </label>
              {action.error && <Notice error>{action.error}</Notice>}
              <button className="primary wide" disabled={action.busy || !name.trim()}>
                {action.busy ? 'Creating…' : 'Create workspace'}
              </button>
            </form>
          </Modal>
        )}
      </div>
    </>
  );
}
function Workspace({
  client,
  workspace,
  login,
}: {
  client: TeamClient;
  workspace: TeamSession['workspaces'][number];
  login: string;
}) {
  const [tab, setTab] = useState<'work' | 'access' | 'devices'>('work'),
    [person, setPerson] = useState(''),
    [project, setProject] = useState(''),
    [query, setQuery] = useState(''),
    [group, setGroup] = useState<'person' | 'project'>('person'),
    [pair, setPair] = useState(false),
    [now, setNow] = useState(Date.now());
  const state = useTeamData(
      client,
      workspace.id,
      tab === 'work' ? { person: person || undefined, project: project || undefined, query } : {},
    ),
    data = state.data;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const tabs = [
    { id: 'work' as const, label: 'Shared work', icon: Activity },
    { id: 'access' as const, label: 'People & access', icon: Users },
    { id: 'devices' as const, label: 'Devices', icon: Laptop },
  ];
  return (
    <main className="team-main">
      <header className="team-topbar">
        <span>
          {workspace.name}
          <span className="preview-tag">Team preview</span>
        </span>
        <div>
          <span className={'connection ' + state.connection}>
            <i />
            {state.connection === 'connected'
              ? 'Connected'
              : state.connection === 'offline'
                ? 'Reconnecting'
                : 'Connecting'}
          </span>
          <button
            className="icon"
            aria-label="Refresh workspace"
            disabled={state.busy}
            onClick={state.refresh}
          >
            <RefreshCw size={17} className={state.busy ? 'spin' : ''} />
          </button>
        </div>
      </header>
      <div className="team-content">
        <div className="team-heading">
          <div>
            <span className="eyebrow">
              {tab === 'work' ? 'YOUR TEAM, IN VIEW' : workspace.name.toUpperCase()}
            </span>
            <h1>
              {tab === 'work'
                ? 'See where the work stands.'
                : tab === 'access'
                  ? 'The right people. The right access.'
                  : 'A view from every connected Mac.'}
            </h1>
            <p>
              {tab === 'work'
                ? 'Shared local branches, the people reporting them, and their place in project history.'
                : 'Manage this workspace with clear, project-level choices.'}
            </p>
          </div>
          {tab !== 'devices' && (
            <button className="secondary" onClick={() => setPair(true)}>
              <Plus size={16} />
              Connect a Mac
            </button>
          )}
        </div>
        <nav className="team-tabs" aria-label="Team views">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        {state.error && (
          <Notice error>
            {state.error}
            <button className="text-button" onClick={state.refresh}>
              Try again
            </button>
          </Notice>
        )}
        {state.connection === 'offline' && data && (
          <Notice>
            Connection interrupted. Displayed reports may have changed. Last loaded{' '}
            {dateLabel(data.checkedAt)}.
          </Notice>
        )}
        {!data && !state.error && (
          <div className="team-loading" role="status">
            <span className="loading-line" />
            <span className="loading-line" />
            <p>Loading shared work…</p>
          </div>
        )}
        {data && tab === 'work' && (
          <>
            <div className="team-metrics">
              {[
                {
                  label: 'Branch reports',
                  value: data.totals.reports,
                  icon: GitBranch,
                  hint: 'In the selected scope',
                },
                {
                  label: 'People reporting',
                  value: data.totals.people,
                  icon: Users,
                  hint: 'From opted-in devices',
                },
                {
                  label: 'Shared projects',
                  value: data.totals.projects,
                  icon: Layers,
                  hint: 'Visible to your account',
                },
                {
                  label: 'Outdated snapshots',
                  value: data.totals.stale,
                  icon: Clock,
                  hint: 'Refresh from the reporting Mac',
                },
              ].map(({ label, value, icon: Icon, hint }) => (
                <div className="team-metric" key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={17} />
                  </div>
                  <strong>{value.toLocaleString()}</strong>
                  <small>{hint}</small>
                </div>
              ))}
            </div>
            <div className="team-filters">
              <label className="team-search">
                <Search size={17} />
                <input
                  aria-label="Search shared team work"
                  placeholder="Search branches, people, projects, tools…"
                  value={query}
                  maxLength={160}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    className="icon"
                    aria-label="Clear team search"
                    onClick={() => setQuery('')}
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
              <select
                aria-label="Filter team work by person"
                value={person}
                onChange={(event) => setPerson(event.target.value)}
              >
                <option value="">All people</option>
                {person && !data.people.some((value) => value.id === person) && (
                  <option value={person}>Person no longer available</option>
                )}
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    @{person.login}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter team work by project"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                <option value="">All projects</option>
                {project && !data.projects.some((value) => value.id === project) && (
                  <option value={project}>Project access changed</option>
                )}
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="board-caption">
              <span>
                {state.busy
                  ? 'Updating reports…'
                  : data.work.length + ' of ' + data.totals.snapshots + ' snapshots loaded'}
                <small> · The same branch can be reported by more than one device.</small>
              </span>
              <div className="group-toggle" aria-label="Group shared work">
                <button aria-pressed={group === 'person'} onClick={() => setGroup('person')}>
                  <Users size={14} />
                  By person
                </button>
                <button aria-pressed={group === 'project'} onClick={() => setGroup('project')}>
                  <Layers size={14} />
                  By project
                </button>
              </div>
            </div>
            {(!data.coverage.people || !data.coverage.projects || data.totals.omitted > 0) && (
              <Notice>
                Coverage is incomplete.
                {data.totals.omitted > 0
                  ? ' Devices omitted ' + data.totals.omitted + ' additional branches.'
                  : ''}{' '}
                Search and totals describe the reported metadata available here.
              </Notice>
            )}
            <SharedBoard
              data={data}
              group={group}
              now={now}
              focused={!!(query || person || project)}
            />
            {data.nextCursor && (
              <div className="load-reports">
                {state.atLimit ? (
                  <Notice>Narrow the person or project to see more reports.</Notice>
                ) : (
                  <button className="secondary" disabled={state.busy} onClick={state.loadMore}>
                    Load more shared reports <ArrowRight size={15} />
                  </button>
                )}
              </div>
            )}
            <div className="team-scope-note">
              <ShieldCheck size={17} />
              <span>
                Only selected local metadata appears here. GitHub organization and PR ingestion is
                still being connected.
              </span>
              <ArrowUpRight size={16} />
            </div>
          </>
        )}
        {data && tab === 'access' && (
          <Access
            client={client}
            workspace={workspace.id}
            data={data}
            owner={workspace.role === 'owner'}
            onChange={state.refresh}
          />
        )}
        {data && tab === 'devices' && (
          <Devices
            client={client}
            workspace={workspace.id}
            people={data.people}
            onPair={() => setPair(true)}
            version={data.workspace.revision}
          />
        )}
        {pair && (
          <PairDevice
            client={client}
            workspace={workspace.id}
            team={workspace.name}
            login={login}
            onClose={() => setPair(false)}
            onDone={state.refresh}
          />
        )}
      </div>
    </main>
  );
}

function FictionalBanner() {
  return document.querySelector('meta[name="openbranches-fictional-preview"]') ? (
    <div className="fictional-banner">
      Fictional team preview · No real projects or accounts{' '}
      <span>
        <a href="/__preview/owner">Owner view</a>
        <a href="/__preview/member">Member view</a>
      </span>
    </div>
  ) : null;
}
