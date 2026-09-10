import { TeamDatabase } from './db';
import { TeamIdentities } from './identities';
import { TeamMembers } from './members';
import { TeamPairings } from './pairings';
import { TeamSharing } from './sharing';
import { TeamViews } from './view';
import { TeamGitHubView } from './github/view';

export class TeamStore {
  readonly identities: TeamIdentities;
  readonly members: TeamMembers;
  readonly pairings: TeamPairings;
  readonly sharing: TeamSharing;
  readonly views: TeamViews;
  readonly githubWork: TeamGitHubView;
  constructor(
    readonly db: TeamDatabase,
    ownerGitHubId: string,
  ) {
    this.identities = new TeamIdentities(db, ownerGitHubId);
    this.members = new TeamMembers(db);
    this.pairings = new TeamPairings(db);
    this.sharing = new TeamSharing(db);
    this.views = new TeamViews(db);
    this.githubWork = new TeamGitHubView(db);
  }
}
