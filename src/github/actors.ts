import { z } from 'zod';

export const sourceActorSchema = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().min(1).max(200),
  type: z.string().max(100).optional(),
});
export const actorSchema = z.object({
  id: z.string().min(1).max(100),
  login: z.string().min(1).max(200),
  kind: z.enum(['user', 'bot', 'organization', 'unknown']),
});
export const parseActor = (
  value: z.infer<typeof sourceActorSchema>,
): z.infer<typeof actorSchema> => ({
  id: String(value.id),
  login: value.login,
  kind:
    value.type === 'User'
      ? 'user'
      : value.type === 'Bot'
        ? 'bot'
        : value.type === 'Organization'
          ? 'organization'
          : 'unknown',
});
