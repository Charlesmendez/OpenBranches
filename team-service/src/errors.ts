export class TeamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const denied = () =>
  new TeamError(403, 'access_denied', 'This workspace or project is unavailable to your account.');
export const unauthorized = () =>
  new TeamError(401, 'unauthorized', 'Sign in or pair this device again.');
export const conflict = () =>
  new TeamError(409, 'sharing_changed', 'Sharing changed. Refresh its state before trying again.');
