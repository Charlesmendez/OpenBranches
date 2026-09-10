import { Cable, FolderGit2, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

export type SettingsSection = 'projects' | 'connections' | 'team' | 'privacy';

const sections: {
  id: SettingsSection;
  label: string;
  description: string;
  icon: LucideIcon;
  liveOnly?: boolean;
}[] = [
  {
    id: 'projects',
    label: 'Projects',
    description: 'What appears here',
    icon: FolderGit2,
  },
  {
    id: 'connections',
    label: 'Connections',
    description: 'GitHub and coding tools',
    icon: Cable,
  },
  {
    id: 'team',
    label: 'Team sharing',
    description: 'Opt-in company view',
    icon: Users,
    liveOnly: true,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Local and read-only',
    icon: ShieldCheck,
  },
];

export function SettingsNavigation({
  selected,
  projectCount,
  demo,
  onSelect,
}: {
  selected: SettingsSection;
  projectCount: number;
  demo: boolean;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <nav className="settings-index" aria-label="Settings sections">
      <div className="settings-index-heading">
        <span>SETTINGS</span>
        <strong>Choose what OpenBranches can see.</strong>
      </div>
      <div className="settings-index-options">
        {sections
          .filter((section) => !section.liveOnly || !demo)
          .map((section) => {
            const Icon = section.icon;
            const description =
              section.id === 'projects'
                ? `${projectCount} ${projectCount === 1 ? 'project' : 'projects'} monitored`
                : section.description;
            return (
              <button
                key={section.id}
                className={selected === section.id ? 'selected' : ''}
                aria-current={selected === section.id ? 'page' : undefined}
                onClick={() => onSelect(section.id)}
              >
                <Icon size={17} />
                <span>
                  <strong>{section.label}</strong>
                  <small>{description}</small>
                </span>
              </button>
            );
          })}
      </div>
      <p>
        <ShieldCheck size={14} />
        Git inspection stays read-only.
      </p>
    </nav>
  );
}
