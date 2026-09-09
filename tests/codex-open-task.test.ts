import { describe, expect, it, vi } from 'vitest';
import { openCodexTask } from '../electron/codex/openTask';

const command = {
  repositoryId: 'atlas',
  branchId: 'search',
  taskId: '01987aa9-b425-7300-a111-abcdef123456',
};
function destination() {
  return {
    isLinked: vi.fn().mockReturnValue(true),
    applicationFor: vi.fn().mockResolvedValue({ name: 'Codex' }),
    open: vi.fn().mockResolvedValue(undefined),
  };
}

describe('opening an existing Codex task', () => {
  it('hands only the fixed existing-task URL to the operating system', async () => {
    const target = destination();
    expect(await openCodexTask(command, target)).toBe('sent');
    expect(target.applicationFor).toHaveBeenCalledWith(`codex://threads/${command.taskId}`);
    expect(target.open).toHaveBeenCalledExactlyOnceWith(`codex://threads/${command.taskId}`);
    expect(target.isLinked).toHaveBeenCalledTimes(2);
    expect(target.isLinked).toHaveBeenLastCalledWith(command);
  });

  it('rejects creation routes, URL injection, and malformed renderer payloads before lookup', async () => {
    const target = destination();
    for (const taskId of [
      'new',
      'NEW',
      'New',
      '',
      '../new',
      'a/new',
      'a?prompt=run',
      'a#new',
      '%6eew',
      'codex://new',
      ' a',
      'a\\new',
      'x'.repeat(201),
    ]) {
      expect(await openCodexTask({ ...command, taskId }, target)).toBe('invalid-link');
    }
    for (const input of [
      null,
      [],
      'codex://threads/new',
      { ...command, url: 'https://example.com' },
      { ...command, branchId: '' },
      { ...command, repositoryId: 4 },
    ]) {
      expect(await openCodexTask(input, target)).toBe('invalid-link');
    }
    expect(target.isLinked).not.toHaveBeenCalled();
    expect(target.applicationFor).not.toHaveBeenCalled();
    expect(target.open).not.toHaveBeenCalled();
  });

  it('refuses a stale or disconnected association before looking up an application', async () => {
    const target = destination();
    target.isLinked.mockReturnValue(false);
    expect(await openCodexTask(command, target)).toBe('not-linked');
    expect(target.applicationFor).not.toHaveBeenCalled();
    expect(target.open).not.toHaveBeenCalled();
  });

  it('does not launch if the association disappears during the system lookup', async () => {
    const target = destination();
    let finish!: () => void;
    target.applicationFor.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const opening = openCodexTask(command, target);
    expect(target.applicationFor).toHaveBeenCalledOnce();
    target.isLinked.mockReturnValue(false);
    finish();
    expect(await opening).toBe('not-linked');
    expect(target.open).not.toHaveBeenCalled();
  });

  it('distinguishes a missing desktop handler from a failed launch without exposing system errors', async () => {
    const missing = destination();
    missing.applicationFor.mockRejectedValue(new Error('/private/app-path'));
    expect(await openCodexTask(command, missing)).toBe('unavailable');
    expect(missing.open).not.toHaveBeenCalled();
    const failed = destination();
    failed.open.mockRejectedValue(new Error('/private/task-path'));
    expect(await openCodexTask(command, failed)).toBe('failed');
  });
});
