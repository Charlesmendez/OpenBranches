type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const publicLabels = new Set([
  'functions',
  'collaboration',
  'exec',
  'wait',
  'request_user_input',
  'apply_patch',
  'view_image',
  'web_search',
  'web_search_preview',
  'shell',
  'shell_command',
  'exec_command',
  'write_stdin',
  'update_plan',
  'spawn_agent',
  'send_message',
  'wait_agent',
  'followup_task',
  'interrupt_agent',
  'list_agents',
  'create_goal',
  'get_goal',
  'update_goal',
  'clock',
  'sleep',
  'function',
  'custom',
  'namespace',
  'additional_tools',
  'message',
  'user',
  'developer',
  'system',
  'assistant',
  'tool',
]);
const label = (value: unknown) =>
  typeof value === 'string' && publicLabels.has(value) ? value : 'unrecognized';
const validId = (value: unknown) =>
  value === undefined || (typeof value === 'string' && /^[a-z0-9_-]{1,200}$/i.test(value));
const emptyToolEnvelope = (item: unknown): item is RecordValue =>
  record(item) &&
  item.type === 'additional_tools' &&
  item.role === 'developer' &&
  validId(item.id) &&
  Array.isArray(item.tools) &&
  item.tools.length === 0 &&
  Object.keys(item).every((key) => ['type', 'id', 'role', 'tools'].includes(key));
const textOf = (item: RecordValue): string | undefined => {
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return;
  if (
    !item.content.every(
      (part) =>
        record(part) &&
        typeof part.text === 'string' &&
        ['text', 'input_text'].includes(String(part.type)) &&
        Object.keys(part).every((key) => key === 'type' || key === 'text'),
    )
  )
    return;
  return item.content.map((part) => part.text).join('');
};
function toolLabels(value: unknown, prefix = '', depth = 0): string[] {
  if (!Array.isArray(value) || depth > 2) return [];
  return value
    .slice(0, 30)
    .flatMap((tool) => {
      if (!record(tool)) return ['unrecognized'];
      const name =
        prefix + label(tool.name ?? (record(tool.function) ? tool.function.name : tool.type));
      return Array.isArray(tool.tools) ? toolLabels(tool.tools, `${name}.`, depth + 1) : [name];
    })
    .slice(0, 30);
}
/** Diagnostic output excludes message text, tool descriptions, schemas and IDs.
 * A passing result establishes only the supplied request's context/tool shape. */
export function auditModelRequest(
  value: unknown,
  expected: { base: string; developer: string; input: string },
) {
  const payload = record(value) ? value : {};
  const items = Array.isArray(payload.input) ? payload.input : [];
  const additions = items.filter((item) => record(item) && item.type === 'additional_tools');
  const emptyToolEnvelopes = additions.filter(emptyToolEnvelope).length;
  const ordinaryTools = Array.isArray(payload.tools) ? payload.tools.length : 0;
  const injectedTools = additions.reduce(
    (sum, item) => sum + (Array.isArray(item.tools) ? item.tools.length : 0),
    0,
  );
  const seen = new Set<string>();
  const extraItems = items.filter((item) => {
    if (emptyToolEnvelope(item)) return false;
    if (
      !record(item) ||
      item.type !== 'message' ||
      !Object.keys(item).every((key) => ['type', 'role', 'content', 'id'].includes(key)) ||
      !validId(item.id)
    )
      return true;
    const text = textOf(item);
    const expectedRole =
      (item.role === 'user' && text === expected.input) ||
      (item.role === 'system' && text === expected.base) ||
      (item.role === 'developer' && (text === expected.base || text === expected.developer));
    if (!expectedRole || text === undefined) return true;
    const key = `${item.role}:${text}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  const extraContext =
    extraItems.length > 0 ||
    emptyToolEnvelopes > 1 ||
    (payload.instructions != null && payload.instructions !== expected.base);
  const hasInput = items.some(
    (item) => record(item) && item.role === 'user' && textOf(item) === expected.input,
  );
  const malformedTools =
    (payload.tools != null && !Array.isArray(payload.tools)) ||
    additions.some((item) => !Array.isArray(item.tools));
  return {
    ordinaryTools,
    injectedTools,
    emptyToolEnvelopes,
    toolLabels: [
      ...toolLabels(payload.tools),
      ...additions.flatMap((item) => toolLabels(item.tools)),
    ].slice(0, 30),
    extraContext,
    extraItems: extraItems.slice(0, 30).map((item) => ({
      type: record(item) ? label(item.type) : 'unrecognized',
      role: record(item) ? label(item.role) : 'unrecognized',
      textLength: record(item) ? (textOf(item)?.length ?? 0) : 0,
      fields: record(item)
        ? Object.keys(item)
            .slice(0, 20)
            .map((key) =>
              ['id', 'type', 'role', 'content', 'tools', 'phase', 'status', 'recipient'].includes(
                key,
              )
                ? key
                : 'unrecognized',
            )
        : [],
    })),
    readyForModelExecution:
      hasInput && !ordinaryTools && !injectedTools && !extraContext && !malformedTools,
  };
}
