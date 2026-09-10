import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import type { LiveAgentTool, ModelIdentity } from '../../src/domain/types';

export interface LiveHookEvent {
  id: string;
  tool: LiveAgentTool;
  cwd: string;
  state: 'active' | 'idle' | 'waiting';
  model?: ModelIdentity;
}

const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('\0'));
const path = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => isAbsolute(value) && !value.includes('\0'));
const model = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);

const claudeSchema = z.object({
  session_id: identifier,
  cwd: path,
  hook_event_name: z.enum([
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'PostToolUseFailure',
    'PostToolBatch',
    'Notification',
    'SubagentStart',
    'SubagentStop',
    'TaskCreated',
    'TaskCompleted',
    'Stop',
    'StopFailure',
    'TeammateIdle',
    'CwdChanged',
    'DirectoryAdded',
    'PreCompact',
    'PostCompact',
    'PreModelSwitch',
    'PostModelSwitch',
    'Elicitation',
    'ElicitationResult',
    'SessionEnd',
  ]),
  notification_type: z.string().max(100).optional(),
  to_model: model.optional(),
});

const cursorSchema = z.object({
  conversation_id: identifier,
  hook_event_name: z.enum([
    'sessionStart',
    'sessionEnd',
    'preToolUse',
    'postToolUse',
    'postToolUseFailure',
    'subagentStart',
    'subagentStop',
    'beforeShellExecution',
    'afterShellExecution',
    'beforeMCPExecution',
    'afterMCPExecution',
    'beforeReadFile',
    'afterFileEdit',
    'beforeSubmitPrompt',
    'preCompact',
    'stop',
    'afterAgentResponse',
    'afterAgentThought',
  ]),
  workspace_roots: z.array(path).min(1).max(32),
  cwd: path.optional(),
  model: model.optional(),
  model_id: model.optional(),
});

const codexSchema = z.object({
  session_id: identifier,
  cwd: path,
  hook_event_name: z.enum([
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'PreCompact',
    'PostCompact',
    'SubagentStart',
    'SubagentStop',
    'Stop',
    'Interrupt',
    'SessionEnd',
  ]),
  model: model.optional(),
});

const claudeWaitingNotifications = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]);
const claudeIdle = new Set([
  'SessionStart',
  'Notification',
  'Stop',
  'StopFailure',
  'TeammateIdle',
  'SessionEnd',
]);
const cursorIdle = new Set(['sessionStart', 'sessionEnd', 'stop', 'afterAgentResponse']);
const codexIdle = new Set(['SessionStart', 'Stop', 'Interrupt', 'SessionEnd']);

export function parseLiveHookEvent(tool: LiveAgentTool, input: unknown): LiveHookEvent {
  if (tool === 'codex') {
    const value = codexSchema.parse(input);
    return {
      id: value.session_id,
      tool,
      cwd: resolve(value.cwd),
      state:
        value.hook_event_name === 'PermissionRequest'
          ? 'waiting'
          : codexIdle.has(value.hook_event_name)
            ? 'idle'
            : 'active',
      ...(value.model ? { model: { id: value.model, provider: 'openai' as const } } : {}),
    };
  }
  if (tool === 'claude-code') {
    const value = claudeSchema.parse(input);
    const waiting =
      value.hook_event_name === 'PermissionRequest' ||
      value.hook_event_name === 'Elicitation' ||
      (value.hook_event_name === 'Notification' &&
        claudeWaitingNotifications.has(value.notification_type ?? ''));
    return {
      id: value.session_id,
      tool,
      cwd: resolve(value.cwd),
      state: waiting ? 'waiting' : claudeIdle.has(value.hook_event_name) ? 'idle' : 'active',
      ...(value.to_model ? { model: { id: value.to_model, provider: 'anthropic' as const } } : {}),
    };
  }
  const value = cursorSchema.parse(input);
  const cwd = value.cwd ? resolve(value.cwd) : uniqueRoot(value.workspace_roots);
  const modelId = value.model_id ?? value.model;
  return {
    id: value.conversation_id,
    tool,
    cwd,
    state: cursorIdle.has(value.hook_event_name) ? 'idle' : 'active',
    ...(modelId ? { model: { id: modelId, provider: modelProvider(modelId) } } : {}),
  };
}

function uniqueRoot(roots: string[]) {
  const unique = [...new Set(roots.map((root) => resolve(root)))];
  if (unique.length !== 1)
    throw new Error('A multi-root Cursor event does not identify one active checkout.');
  return unique[0];
}

function modelProvider(id: string): ModelIdentity['provider'] {
  const normalized = id.toLowerCase();
  if (normalized.includes('grok')) return 'xai';
  if (normalized.includes('claude')) return 'anthropic';
  if (/^(?:gpt|o[134]|codex)[-/:]/.test(normalized)) return 'openai';
  return 'other';
}
