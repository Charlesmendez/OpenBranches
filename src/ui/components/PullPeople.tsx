import './pullPeople.css';
import type { GitHubActor, GitHubPullRequest } from '../../domain/types';
import { Bot, Users } from 'lucide-react';

export function PersonAvatar({ actor }: { actor?: GitHubActor }) {
  const tone = actor ? [...actor.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5 : 0;
  return (
    <span className={'person-avatar person-tone-' + tone} aria-hidden="true">
      {actor?.kind === 'bot' ? (
        <Bot size={19} />
      ) : actor ? (
        actor.login.slice(0, 2).toUpperCase()
      ) : (
        <Users size={19} />
      )}
    </span>
  );
}
export function PullPeople({
  pull,
}: {
  pull: Pick<GitHubPullRequest, 'author' | 'requestedReviewers' | 'requestedTeams'>;
}) {
  const reviewers = pull.requestedReviewers?.map((actor) => '@' + actor.login) ?? [];
  const teams = pull.requestedTeams?.map((team) => team.name + ' (team)') ?? [];
  return (
    <div className="pull-people">
      <span>
        Author · {pull.author ? '@' + pull.author.login : 'Unavailable'}
        {pull.author?.kind === 'bot' ? ' · Bot' : ''}
      </span>
      {reviewers.length + teams.length > 0 && (
        <span>Review requested · {[...reviewers, ...teams].join(', ')}</span>
      )}
    </div>
  );
}
