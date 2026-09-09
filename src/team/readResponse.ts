import { z } from 'zod';
import { readJson } from '../shared/readJson';
export class TeamApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function readTeamResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  maxBytes = 8_000_000,
): Promise<T> {
  const value = await readJson(response, maxBytes, {
    empty: 'The team service sent an empty response.',
    large: 'This response is too large. Narrow the project or person filter.',
    unreadable: 'The team service sent an unreadable response.',
  });
  if (!response.ok) {
    const error = z
      .object({ error: z.string().max(100), message: z.string().max(500) })
      .safeParse(value);
    throw new TeamApiError(
      response.status,
      error.success ? error.data.error : 'request_failed',
      error.success ? error.data.message : 'The request could not complete. Try again.',
    );
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      'The team service returned an unsupported response. Refresh or check the server version.',
    );
  return result.data;
}
