import { z } from 'zod';
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
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The team service sent an empty response.');
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes)
        throw new Error('This response is too large. Narrow the project or person filter.');
      parts.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new Error('The team service sent an unreadable response.');
  }
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
