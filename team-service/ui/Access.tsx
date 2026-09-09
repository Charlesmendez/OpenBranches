import { useEffect, useState } from 'react';
import { Plus, Search, ShieldCheck, Users, Layers } from 'lucide-react';
import type { TeamClient } from '../../src/team/client';
import type { ProjectAccess, TeamPage, TeamProject } from '../../src/team/responses';
import { Avatar, Empty, Modal, Notice } from './primitives';
import { useAction } from './hooks';
export function Access({
  client,
  workspace,
  data,
  owner,
  onChange,
}: {
  client: TeamClient;
  workspace: string;
  data: TeamPage;
  owner: boolean;
  onChange: () => void;
}) {
  const [peopleQuery, setPeopleQuery] = useState(''),
    [projectQuery, setProjectQuery] = useState(''),
    [peopleLimit, setPeopleLimit] = useState(12),
    [projectLimit, setProjectLimit] = useState(12),
    [add, setAdd] = useState<'person' | 'project'>(),
    [text, setText] = useState(''),
    [access, setAccess] = useState<TeamProject>(),
    [remove, setRemove] = useState<{ type: 'person' | 'project'; id: string; name: string }>(),
    action = useAction();
  const people = data.people.filter((person) =>
    person.login.toLowerCase().includes(peopleQuery.toLowerCase()),
  );
  const projects = data.projects.filter((project) =>
    project.name.toLowerCase().includes(projectQuery.toLowerCase()),
  );
  const start = (kind: 'person' | 'project') => {
    action.clear();
    setText('');
    setAdd(kind);
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>People & project access</h2>
          <p>
            {owner
              ? 'Give each person access to the projects they work on.'
              : 'Your team and the projects available to your account.'}
          </p>
        </div>
        <span className="scope-label">
          <ShieldCheck size={16} />
          {owner ? 'Workspace owner' : 'Member view'}
        </span>
      </div>
      {(!data.coverage.people || !data.coverage.projects) && (
        <Notice>Some people or projects are outside this page. The list is incomplete.</Notice>
      )}
      <div className="access-columns">
        <section className="access-list">
          <header>
            <h3>
              <Users size={17} />
              People <span>{data.people.length}</span>
            </h3>
            {owner && (
              <button className="secondary" onClick={() => start('person')}>
                <Plus size={14} />
                Add person
              </button>
            )}
          </header>
          <label className="list-search">
            <Search size={15} />
            <input
              aria-label="Search team members"
              placeholder="Find a person…"
              value={peopleQuery}
              onChange={(event) => {
                setPeopleQuery(event.target.value);
                setPeopleLimit(12);
              }}
            />
          </label>
          {people.slice(0, peopleLimit).map((person) => (
            <div className="access-person" key={person.id}>
              <Avatar name={person.login} />
              <span>
                <strong>@{person.login}</strong>
                <small>{person.role === 'owner' ? 'Owner' : 'Team member'}</small>
              </span>
              {owner && person.role !== 'owner' && (
                <button
                  className="text-button"
                  onClick={() => {
                    action.clear();
                    setRemove({ type: 'person', id: person.id, name: '@' + person.login });
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {!people.length && <Empty title="No matching people">Try another GitHub username.</Empty>}
          {people.length > peopleLimit && (
            <button className="more-branches" onClick={() => setPeopleLimit((value) => value + 24)}>
              Show more people
            </button>
          )}
        </section>
        <section className="access-list">
          <header>
            <h3>
              <Layers size={17} />
              Projects <span>{data.projects.length}</span>
            </h3>
            {owner && (
              <button className="secondary" onClick={() => start('project')}>
                <Plus size={14} />
                Add project
              </button>
            )}
          </header>
          <label className="list-search">
            <Search size={15} />
            <input
              aria-label="Search team projects"
              placeholder="Find a project…"
              value={projectQuery}
              onChange={(event) => {
                setProjectQuery(event.target.value);
                setProjectLimit(12);
              }}
            />
          </label>
          {projects.slice(0, projectLimit).map((project) => (
            <div className="access-project" key={project.id}>
              <span className="project-symbol">
                <Layers size={18} />
              </span>
              <span>
                <strong>{project.name}</strong>
                <small>
                  {project.githubSlug ?? 'Team project'} ·{' '}
                  {project.canShare ? 'Sharing allowed' : 'Read access'}
                </small>
              </span>
              {owner && (
                <>
                  <button className="secondary" onClick={() => setAccess(project)}>
                    Access
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      action.clear();
                      setRemove({ type: 'project', id: project.id, name: project.name });
                    }}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          ))}
          {!projects.length && (
            <Empty
              title={data.projects.length ? 'No matching projects' : 'No projects available yet'}
            >
              {owner
                ? 'Add a team project, then choose who can access it.'
                : 'A workspace owner can give you project access.'}
            </Empty>
          )}
          {projects.length > projectLimit && (
            <button
              className="more-branches"
              onClick={() => setProjectLimit((value) => value + 24)}
            >
              Show more projects
            </button>
          )}
        </section>
      </div>
      {add && (
        <Modal
          title={add === 'person' ? 'Add a team member' : 'Add a team project'}
          onClose={() => {
            if (!action.busy) setAdd(undefined);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                if (add === 'person')
                  await client.addMember(workspace, text.trim().replace(/^@/, ''));
                else await client.createProject(workspace, text.trim());
                setAdd(undefined);
                onChange();
              });
            }}
          >
            <p>
              {add === 'person'
                ? 'The person will sign in with this GitHub account. Choose their project permissions after adding them.'
                : 'Create a shared destination for this project. Members will explicitly connect their local folder to it in the Mac app.'}
            </p>
            <label className="field">
              {add === 'person' ? 'GitHub username' : 'Project name'}
              <input
                autoFocus
                required
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={add === 'person' ? 40 : 120}
                autoComplete="off"
              />
            </label>
            {action.error && <Notice error>{action.error}</Notice>}
            <button className="primary wide" disabled={action.busy || !text.trim()}>
              {action.busy ? 'Adding…' : add === 'person' ? 'Add member' : 'Add project'}
            </button>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal
          title={'Remove ' + remove.name + '?'}
          onClose={() => {
            if (!action.busy) setRemove(undefined);
          }}
        >
          <p>
            {remove.type === 'person'
              ? 'This member will lose workspace access. Their devices will be revoked and their shared local reports withdrawn.'
              : 'This project will be removed from the team workspace, along with its currently shared local reports.'}
          </p>
          <Notice>Local files, branches, and GitHub repositories remain untouched.</Notice>
          {action.error && <Notice error>{action.error}</Notice>}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => setRemove(undefined)}
            >
              Cancel
            </button>
            <button
              className="danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  if (remove.type === 'person') await client.removeMember(workspace, remove.id);
                  else await client.removeProject(workspace, remove.id);
                  setRemove(undefined);
                  onChange();
                })
              }
            >
              {action.busy
                ? 'Removing…'
                : 'Remove ' + (remove.type === 'person' ? 'member' : 'project')}
            </button>
          </div>
        </Modal>
      )}
      {access && (
        <ProjectPermissions
          key={access.id}
          client={client}
          workspace={workspace}
          project={access}
          people={data.people}
          onClose={() => setAccess(undefined)}
          onChange={onChange}
        />
      )}
    </>
  );
}
function ProjectPermissions({
  client,
  workspace,
  project,
  people,
  onClose,
  onChange,
}: {
  client: TeamClient;
  workspace: string;
  project: TeamProject;
  people: TeamPage['people'];
  onClose: () => void;
  onChange: () => void;
}) {
  const [data, setData] = useState<ProjectAccess>(),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [reload, setReload] = useState(0),
    action = useAction();
  useEffect(() => {
    const abort = new AbortController();
    void client
      .access(workspace, project.id, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setData(value);
          setError('');
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, [client, workspace, project.id, reload]);
  const rows =
    data?.members.filter((member) =>
      (people.find((person) => person.id === member.memberId)?.login ?? '')
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Modal
      title={'Access to ' + project.name}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <p>Owners have full access. Members can view reports, or view and share local work.</p>
      <label className="list-search">
        <Search size={15} />
        <input
          autoFocus
          aria-label="Search project members"
          placeholder="Find a member…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && <Notice error>{error}</Notice>}
      {action.error && <Notice error>{action.error}</Notice>}
      {!data && !error && <Notice>Loading project permissions…</Notice>}
      {data && !data.complete && <Notice>More members exist than can be shown here.</Notice>}
      <div className="permission-list">
        {rows.map((member) => (
          <label className="permission-row" key={member.memberId}>
            <span>
              @
              {people.find((person) => person.id === member.memberId)?.login ??
                'Member outside this page'}
            </span>
            <select
              aria-label={
                'Access for ' +
                (people.find((person) => person.id === member.memberId)?.login ?? member.memberId)
              }
              value={!member.enabled ? 'none' : member.canShare ? 'share' : 'read'}
              disabled={action.busy}
              onChange={(event) => {
                const value = event.target.value;
                void action.run(async () => {
                  await client.grant(
                    workspace,
                    project.id,
                    member.memberId,
                    value !== 'none',
                    value === 'share',
                  );
                  setReload((current) => current + 1);
                  onChange();
                });
              }}
            >
              <option value="none">No access</option>
              <option value="read">Can view</option>
              <option value="share">Can view & share</option>
            </select>
          </label>
        ))}
      </div>
      {data && !rows.length && <p className="muted">No matching members.</p>}
      <Notice>
        Changes take effect immediately. Removing sharing access withdraws this member's local
        reports for this project.
      </Notice>
      <button className="primary wide" disabled={action.busy} onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}
