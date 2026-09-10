import { describe, expect, it } from 'vitest';
import { auditModelRequest } from '../electron/advisor/requestAudit.mjs';

const expected = {
  base: 'Read-only advisor.',
  developer: 'Use the supplied evidence.',
  input: '{"fixture":true}',
};
const message = (role: string, text: string) => ({
  type: 'message',
  role,
  content: [{ type: 'input_text', text }],
});
const request = () => ({
  instructions: expected.base,
  tools: [] as unknown[],
  input: [message('developer', expected.developer), message('user', expected.input)] as unknown[],
});

describe('advisor request diagnostics', () => {
  it('accepts only the expected text-only request shape without claiming runtime safety', () => {
    expect(auditModelRequest(request(), expected)).toMatchObject({
      ordinaryTools: 0,
      injectedTools: 0,
      extraContext: false,
      readyForModelExecution: true,
    });
    const withIds = request();
    withIds.input = withIds.input.map((item, index) => ({
      ...(item as object),
      id: `msg_fixture_${index}`,
    }));
    expect(auditModelRequest(withIds, expected).readyForModelExecution).toBe(true);
  });
  it('detects both ordinary tools and nested additional tool namespaces', () => {
    const payload = request();
    payload.tools = [{ type: 'web_search' }];
    payload.input.push({
      type: 'additional_tools',
      role: 'developer',
      tools: [
        {
          type: 'namespace',
          name: 'functions',
          tools: [
            { type: 'custom', name: 'apply_patch' },
            { type: 'function', name: 'request_user_input' },
          ],
        },
      ],
    });
    expect(auditModelRequest(payload, expected)).toMatchObject({
      ordinaryTools: 1,
      injectedTools: 1,
      toolLabels: ['web_search', 'functions.apply_patch', 'functions.request_user_input'],
      readyForModelExecution: false,
    });
  });
  it('allows one exact empty protocol tool envelope and rejects lookalikes or duplicates', () => {
    const emptyEnvelope = {
      type: 'additional_tools',
      id: 'tools_fixture',
      role: 'developer',
      tools: [],
    };
    const payload = request();
    payload.input.push(emptyEnvelope);
    expect(auditModelRequest(payload, expected)).toMatchObject({
      emptyToolEnvelopes: 1,
      injectedTools: 0,
      extraContext: false,
      readyForModelExecution: true,
    });
    payload.input.push({ ...emptyEnvelope, id: 'tools_fixture_2' });
    expect(auditModelRequest(payload, expected).readyForModelExecution).toBe(false);
    const withHiddenField = request();
    withHiddenField.input.push({ ...emptyEnvelope, metadata: 'hidden' });
    expect(auditModelRequest(withHiddenField, expected).readyForModelExecution).toBe(false);
    const withWrongRole = request();
    withWrongRole.input.push({ ...emptyEnvelope, role: 'user' });
    expect(auditModelRequest(withWrongRole, expected).readyForModelExecution).toBe(false);
  });
  it('does not leak extra instructions, descriptions, credentials or source paths in its report', () => {
    const payload = request();
    payload.input.push(
      message('developer', 'Private policy at /Users/fixture/private; token=private-token-fixture'),
    );
    payload.tools = [
      {
        type: 'function',
        name: 'read_data',
        description: 'Secret instructions',
        parameters: { apiKey: 'another-private-fixture' },
      },
    ];
    const report = auditModelRequest(payload, expected);
    expect(report.readyForModelExecution).toBe(false);
    const output = JSON.stringify(report);
    for (const privateText of [
      'Private policy',
      '/Users/fixture',
      'private-token-fixture',
      'Secret instructions',
      'another-private-fixture',
    ])
      expect(output).not.toContain(privateText);
    expect(report.extraItems).toEqual([
      { type: 'message', role: 'developer', textLength: 69, fields: ['type', 'role', 'content'] },
    ]);
    expect(output).not.toContain('read_data');
  });
  it('rejects hidden non-text content and fields even when the visible text matches', () => {
    const payload = request();
    payload.input[1] = {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: expected.input, image_url: 'https://example.invalid/private' },
      ],
    };
    expect(auditModelRequest(payload, expected).readyForModelExecution).toBe(false);
    payload.input[1] = { ...message('user', expected.input), attachment: 'hidden file' };
    expect(auditModelRequest(payload, expected).readyForModelExecution).toBe(false);
    payload.input[1] = {
      ...message('user', expected.input),
      id: { content: 'hidden instructions' },
    };
    expect(auditModelRequest(payload, expected).readyForModelExecution).toBe(false);
  });
  it('rejects role substitutions and repeated input that could change instruction priority or size', () => {
    expect(
      auditModelRequest({ ...request(), instructions: expected.input }, expected)
        .readyForModelExecution,
    ).toBe(false);
    const payload = request();
    payload.input.unshift(message('system', expected.input));
    expect(auditModelRequest(payload, expected).readyForModelExecution).toBe(false);
    const duplicate = request();
    duplicate.input.push(message('user', expected.input));
    expect(auditModelRequest(duplicate, expected).readyForModelExecution).toBe(false);
  });
  it('rejects malformed requests and tool declarations rather than interpreting them as absent', () => {
    for (const payload of [
      null,
      {},
      { ...request(), tools: {} },
      { ...request(), input: {} },
      { ...request(), input: [{ type: 'additional_tools', tools: null }] },
    ])
      expect(auditModelRequest(payload, expected).readyForModelExecution).toBe(false);
  });
});
