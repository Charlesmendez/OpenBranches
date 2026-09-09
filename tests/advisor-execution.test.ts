import { describe, expect, it } from 'vitest';
import {
  attemptToolLocation,
  auditAttemptOutputs,
  createToolAttempt,
} from '../scripts/advisor/probeExecution.mjs';

const fixture = {
  marker: 'public-execution-marker',
  readCanary: 'private-fixture-content',
  readPath: "/tmp/owned folder/it's a read fixture.txt",
  writePath: "/tmp/owned folder/it's a write fixture.txt",
};
const output = (value: unknown, call = 'call_openbranches_probe') => ({
  type: 'custom_tool_call_output',
  call_id: call,
  output: value,
});

describe('advisor execution probe evidence', () => {
  it('does not confuse echoed call arguments, input, or another tool with execution', () => {
    const request = {
      input: [
        { type: 'message', role: 'user', content: fixture.marker + fixture.readCanary },
        createToolAttempt('exec-marker', fixture),
        output(fixture.marker + fixture.readCanary, 'another-call'),
      ],
    };
    expect(auditAttemptOutputs(request, fixture)).toMatchObject({
      toolOutputCount: 0,
      markerReturned: false,
      readCanaryReturned: false,
      errorHints: [],
    });
    request.input.push(output(fixture.marker));
    expect(auditAttemptOutputs(request, fixture)).toMatchObject({
      toolOutputCount: 1,
      markerReturned: true,
      readCanaryReturned: false,
    });
  });
  it('reports observed output without disclosing contents, errors, paths, or marker values', () => {
    const request = {
      input: [
        output([
          {
            type: 'output_text',
            text: `Error: operation not permitted at ${fixture.writePath}; ${fixture.readCanary}`,
          },
          { type: 'image', text: fixture.marker },
        ]),
      ],
    };
    const report = auditAttemptOutputs(request, fixture);
    expect(report).toMatchObject({
      markerReturned: false,
      readCanaryReturned: true,
      errorHints: ['permission-denied', 'tool-error'],
    });
    const serialized = JSON.stringify(report);
    for (const text of Object.values(fixture)) expect(serialized).not.toContain(text);
  });
  it('treats absent or malformed output as inconclusive rather than proven denial', () => {
    for (const value of [null, {}, { input: {} }, { input: [output({ text: fixture.marker })] }])
      expect(auditAttemptOutputs(value, fixture)).toMatchObject({
        markerReturned: false,
        readCanaryReturned: false,
        errorHints: [],
      });
  });
  it('uses the observed public namespace and identifies an unadvertised attempt', () => {
    const exec = { type: 'custom', name: 'exec' };
    const request = (tools: unknown[]) => ({ input: [{ type: 'additional_tools', tools }] });
    expect(attemptToolLocation(request([exec]), 'exec-marker')).toEqual({
      advertised: true,
      namespace: undefined,
    });
    expect(
      attemptToolLocation(
        request([{ type: 'namespace', name: 'functions', tools: [exec] }]),
        'exec-read',
      ),
    ).toEqual({ advertised: true, namespace: 'functions' });
    expect(
      attemptToolLocation(
        request([{ type: 'namespace', name: 'private-connector', tools: [exec] }]),
        'exec-read',
      ),
    ).toEqual({ advertised: false, namespace: undefined });
    expect(attemptToolLocation(request([exec]), 'shell-marker').advertised).toBe(false);
  });
  it('keeps the read canary out of tool arguments and quotes owned paths as shell arguments', () => {
    const read = createToolAttempt('exec-read', fixture);
    const write = createToolAttempt('exec-write', fixture, 'functions');
    const computation = createToolAttempt('exec-marker', fixture);
    expect(JSON.stringify(computation)).not.toContain(fixture.marker);
    expect(JSON.stringify(createToolAttempt('shell-marker', fixture))).not.toContain(
      fixture.marker,
    );
    expect(
      auditAttemptOutputs({ input: [output(JSON.stringify(computation))] }, fixture).markerReturned,
    ).toBe(false);
    expect(JSON.stringify(read)).not.toContain(fixture.readCanary);
    expect(read).toMatchObject({
      input: expect.stringContaining(
        JSON.stringify("cat '/tmp/owned folder/it'\\''s a read fixture.txt'"),
      ),
    });
    expect(write).toMatchObject({
      input: expect.stringContaining(
        JSON.stringify(
          "printf '%s' 'public-execution-marker' > '/tmp/owned folder/it'\\''s a write fixture.txt'",
        ),
      ),
    });
    expect(read).not.toHaveProperty('namespace');
    expect(write.namespace).toBe('functions');
  });
});
