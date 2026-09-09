# Opening saved Codex tasks

Each task in the branch inspector has an **Open in Codex** action. Its saved association, archive state, update time, and evidence remain visible. Larger task histories expand on request. Task names and supporting text use wrapping layouts; the action has a 32-pixel minimum height, a task-specific accessible name, a disabled busy state, and inline status feedback.

## Boundary

The renderer sends only repository, branch, and task IDs through `codex:open-task`. The main process validates a strict payload and permits only a single existing-task identifier, excluding the reserved `new` route. It rechecks the association against the current selected repository, current branch, and enabled Codex index. Renderer-provided task objects and URLs cannot establish an association.

The only constructed destination is `codex://threads/<task-id>`, documented in the [official desktop deep-link reference](https://learn.chatgpt.com/docs/reference/commands#deep-links). There are no prompt, path, host, or query parameters. No app-server thread/resume, turn/start, or archive mutation is issued. The generic external-link bridge remains restricted to GitHub HTTPS links.

Electron checks the registered protocol handler before dispatching the link. It rechecks the saved association after this asynchronous lookup so a disconnect, removed project, or changed index can invalidate the action before dispatch. Operating-system errors become fixed user-facing messages rather than exposing private paths. Possible associations can be opened but remain labeled as possible.

## Feedback

| Situation                                         | Behavior                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| macOS accepts the request                         | “Sent to Codex”; this does not prove the destination task loaded      |
| Association no longer exists or connection is off | Ask the user to refresh and check the connection                      |
| Saved ID is unsupported                           | Suggest finding the task in Codex by title                            |
| No desktop protocol handler                       | Explain that the desktop app is needed; the CLI alone is insufficient |
| System launch fails                               | Suggest opening the desktop app and retrying                          |
| Fictional demo task                               | Explain the demo without invoking the desktop bridge                  |
| Browser preview without a desktop bridge          | Explain that task links open from the desktop app                     |

## Verification and remaining limits

- `tests/codex-open-task.test.ts` checks the exact fixed destination, reserved routes, injection and malformed payloads, stale/disconnected associations, changes during protocol lookup, and missing/failed handler outcomes.
- `tests/codex.test.ts` checks current repository/branch/task evidence, possible and archived associations, removed projects, and disconnection.
- `tests/ui/tasks.html` is a development-only fictional fixture with controlled deferred desktop responses. Browser checks covered pending/disabled state, submitted IDs, keyboard activation, every inline result message, expanded history, wrapped titles, and demo/preview actions that do not dispatch requests. Browser diagnostics reported no warnings or errors. The rebuilt native app showed the actions and fictional-task explanation in its real inspector; scrolling kept the task history and controls readable and reachable.
- A separate temporary Electron window used the same `getApplicationInfoForProtocol` and `shell.openExternal` calls for this existing planning task. macOS identified its registered handler as ChatGPT and accepted the request. The official documentation describes retention of the Codex scheme. No new task or model turn was requested.
- Destination-screen verification remains pending: Computer Use does not permit inspecting the Codex app in this environment. The real OpenBranches desktop connection found no saved task associations for the currently selected projects, so that check does not prove the entire inspector-to-existing-task flow. Real archived-task destination behavior and wider desktop versions also remain unverified. Do not describe the launch as fully verified until those checks have direct evidence.

Task metadata can become stale between index refreshes. Opening a link does not establish current task activity, reclassify a possible association as verified, or verify that archived or missing tasks remain accessible in the destination app.
