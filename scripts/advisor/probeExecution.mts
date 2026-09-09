// Developer-only fixtures. Never accepts source text or commands from a model.
export const executionScenarios = [
  'exec-marker',
  'exec-read',
  'exec-write',
  'shell-marker',
  'question',
] as const;
export type ExecutionScenario = (typeof executionScenarios)[number];
type Fixture = { marker: string; readPath: string; writePath: string; readCanary: string };
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function createToolAttempt(
  scenario: ExecutionScenario,
  fixture: Fixture,
  namespace?: 'functions',
) {
  const common = {
    id: 'tool_openbranches_probe',
    call_id: 'call_openbranches_probe',
    ...(namespace ? { namespace } : {}),
  };
  if (scenario === 'question')
    return {
      ...common,
      type: 'function_call',
      name: 'request_user_input',
      arguments: JSON.stringify({
        questions: [
          {
            id: 'fixture',
            header: 'Fixture',
            question: 'Fictional probe question?',
            options: [
              { label: 'First', description: 'First fictional choice.' },
              { label: 'Second', description: 'Second fictional choice.' },
            ],
          },
        ],
      }),
    };
  const command =
    scenario === 'exec-read'
      ? `cat ${shellQuote(fixture.readPath)}`
      : scenario === 'exec-write'
        ? `printf '%s' ${shellQuote(fixture.marker)} > ${shellQuote(fixture.writePath)}`
        : `printf '%s%s' ${shellQuote(fixture.marker.slice(0, 12))} ${shellQuote(fixture.marker.slice(12))}`;
  const args = { cmd: command, yield_time_ms: 1000, max_output_tokens: 1000 };
  if (scenario === 'shell-marker')
    return {
      ...common,
      type: 'function_call',
      name: 'exec_command',
      arguments: JSON.stringify(args),
    };
  return {
    ...common,
    type: 'custom_tool_call',
    name: 'exec',
    input:
      scenario === 'exec-marker'
        ? // The expected result does not occur in the arguments. An error that
          // echoes the submitted source therefore cannot imitate execution.
          `text(${JSON.stringify([...fixture.marker].reverse().join(''))}.split('').reverse().join(''));`
        : `text(await tools.exec_command(${JSON.stringify(args)}));`,
  };
}

/** A finite Responses event stream with no live inference or tool implementation. */
export function responseStream(item: Record<string, unknown>, sequence: number) {
  const id = `resp_openbranches_probe_${sequence}`;
  const response = { id, object: 'response', status: 'in_progress', output: [] as unknown[] };
  const completedItem = { ...item, status: 'completed' };
  const events = [
    { type: 'response.created', response },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress' },
    },
    { type: 'response.output_item.done', output_index: 0, item: completedItem },
    {
      type: 'response.completed',
      response: {
        ...response,
        status: 'completed',
        output: [completedItem],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ];
  return events
    .map(
      (event, sequence_number) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
    )
    .join('');
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Match only the fixture's fixed public capability. Never dispatch arbitrary
 * names or take a description/schema from the inspected request as code. */
export function attemptToolLocation(value: unknown, scenario: ExecutionScenario) {
  const name =
    scenario === 'question'
      ? 'request_user_input'
      : scenario === 'shell-marker'
        ? 'exec_command'
        : 'exec';
  const payload = record(value) ? value : {};
  const additions = Array.isArray(payload.input)
    ? payload.input.filter((item) => record(item) && item.type === 'additional_tools')
    : [];
  const groups: unknown[] = [payload.tools, ...additions.map((item) => item.tools)];
  let namespaceExists = false;
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const tool of group) {
      if (!record(tool)) continue;
      if (tool.name === name && ['custom', 'function'].includes(String(tool.type)))
        return { advertised: true, namespace: undefined };
      if (tool.type === 'namespace' && tool.name === 'functions') {
        namespaceExists = true;
        if (
          Array.isArray(tool.tools) &&
          tool.tools.some(
            (entry) =>
              record(entry) &&
              entry.name === name &&
              ['custom', 'function'].includes(String(entry.type)),
          )
        )
          return { advertised: true, namespace: 'functions' as const };
      }
    }
  }
  return { advertised: false, namespace: namespaceExists ? ('functions' as const) : undefined };
}

/** Inspect only the matching tool's output. Echoes in instructions/arguments are
 * never evidence of execution. No output text or caller-provided labels escape. */
export function auditAttemptOutputs(
  value: unknown,
  fixture: Pick<Fixture, 'marker' | 'readCanary'>,
) {
  const items = record(value) && Array.isArray(value.input) ? value.input : [];
  const outputs = items.filter(
    (item) =>
      record(item) &&
      ['function_call_output', 'custom_tool_call_output'].includes(String(item.type)) &&
      item.call_id === 'call_openbranches_probe',
  );
  const texts = outputs.map((item) => {
    if (typeof item.output === 'string') return item.output;
    if (!Array.isArray(item.output)) return '';
    return item.output
      .filter(
        (part: unknown) =>
          record(part) &&
          ['text', 'output_text', 'input_text'].includes(String(part.type)) &&
          typeof part.text === 'string',
      )
      .map((part: { text: string }) => part.text)
      .join('\n');
  });
  const combined = texts.join('\n');
  return {
    toolOutputCount: outputs.length,
    toolOutputCharacters: combined.length,
    markerReturned: combined.includes(fixture.marker),
    readCanaryReturned: combined.includes(fixture.readCanary),
    // Hints help diagnose a negative result; they do not prove enforcement.
    errorHints: [
      [/unsupported|not supported|unknown|unrecognized/i, 'unsupported-tool'],
      [/not found|not a function|not defined/i, 'missing-tool'],
      [/permission denied|operation not permitted|read-only file system/i, 'permission-denied'],
      [/not available|unavailable|disabled|only.*plan mode/i, 'unavailable'],
      [/invalid|failed|error/i, 'tool-error'],
    ].flatMap(([pattern, label]) =>
      pattern instanceof RegExp && pattern.test(combined) ? [String(label)] : [],
    ),
  };
}
