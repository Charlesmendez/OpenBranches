# Keeping your place

OpenBranches restores the last workspace mode, project, and view after a restart. Each project's selected branch, lifecycle group, expanded map group, map page, viewport, inventory search, filters, cursor, and scroll position are saved locally. The workspace Activity timeline also restores its search, project, event-type filter, and current page. Demo and real projects have independent histories, including when they share a project identifier. Persisted review decisions remain separate.

Startup waits for an authoritative snapshot before restoring branch context or pruning removed projects. A failed load preserves saved positions and offers a retry. A newer snapshot event supersedes an older in-flight read, so a delayed empty response cannot erase the current workspace. Removed projects are discarded after the renderer receives the updated project list. Callbacks captured before a mode or project-membership change cannot reintroduce an old position, including after removal and re-addition.

Switching from the inventory to the map reveals the selected working branch in its current lifecycle group and six-branch page. An unchanged page retains its viewport. Explicit map group/page navigation clears the inspector selection, so an unrelated branch does not stay highlighted elsewhere. Incoming snapshot changes clear selections that no longer exist.

The project toolbar keeps current activity reachable across both primary views. The map uses one bounded current-work rail above the canvas. Each card has an explicit **Live now**, **Waiting**, **Changes here**, **Recent**, or **Checked out** evidence label, the coding-tool icon when known, the branch, compact local integration status, and a **Show on map** action. The rail stays two cards tall and pages through every additional signal in place, so a busy project remains complete without pushing down the map.

Choosing a project from the sidebar opens the lifecycle, map group, and six-branch page containing its strongest running, waiting, or dirty-worktree signal. It leaves the details drawer closed so the map retains its full width. A live branch has a pulsing blue halo and emphasized verified ancestry or PR lines; a waiting branch uses violet; an uncommitted working copy has a steady amber halo because file changes alone do not prove that a person or agent is currently present. The same labels remain on the branch node after navigation. The inventory adds a compact live/waiting control that focuses the highest-priority current branch on the map. A quiet project shows the connected live sources, while an unconfigured project links directly to live activity settings. If Codex task history is connected but runtime hooks are not, the setup control says that live branch glow still needs to be enabled instead of implying that saved task linking provides live presence.

The all-projects overview begins with a bounded **Live across projects** rail whenever verified agent runtime evidence exists. It includes only running or waiting sessions, identifies the repository and coding tool, shows compact integration status, and opens the exact branch on its map. The first three branches stay visible; browsing uses six-branch pages so even hundreds of active sessions remain reachable without rendering another wall of work.

The sidebar workspace control opens Personal plus every connected team. Personal remains in the Mac app; a team destination opens its authenticated browser dashboard. Pending and unavailable connections stay visible with their actual state and lead to the appropriate team page. Arrow keys, Home, and End move through destinations, while Escape closes the menu and returns focus to its trigger.

Settings uses a task-based local index for Projects, Connections, Team sharing, and Privacy. The selected panel replaces the previous panel instead of adding another section to a long page. Source-health, missing-Git, People & PRs, and review-queue setup links open Connections directly; the live-work callout opens the live branch signals group. Opening Settings from the sidebar starts with Projects. The index stays visible while a long panel scrolls and becomes a compact horizontal strip at narrower widths.

Review and Activity queues use the same bounded page controller as active-work rails. A changed filter or evidence ordering starts at the first page immediately, while opening an item and returning keeps the current page. Previous and Next retain keyboard focus when they reach a boundary.

Project cards use the broader activity ranking from the map: verified running or waiting work appears before dirty work, recent activity, and the current checkout. The corresponding tool icon and evidence tone remain visible on each project card. Compact project summaries prefer one development target and one stable target so `develop` and `main` remain visible when alias targets also exist. They say **Compared with** and do not draw a relationship line; verified ancestry and PR lines remain exclusive to the evidence map.

Map and inventory location marks include a small count when a branch has more than one local worktree. The inspector lists each exact checkout separately, puts the checkout with verified live work first, and distinguishes clean, dirty, unchecked, locked, prunable, and missing copies. Four rows stay visible initially; larger sets expand in place. Reveal actions select one available path that was present in the latest trusted Git scan. A renderer-supplied path that is missing, unavailable, belongs to another branch, or was never scanned is rejected.

The inventory has one scrolling surface for its sticky header and rows. All discovered integration targets have a column, including projects with develop, dev, main, and master together. A verified nonstandard remote default gets a labeled column and a short explanation above the table. If Git exposes no target, the inventory says why instead of silently removing the comparison columns. Horizontal scrolling moves headers and values together. Refreshes anchor the viewport to its visible branch when earlier rows are inserted or reordered. Closing and reopening the inventory preserves filters, horizontal position, and the visible row offset. Global search places fresh verified runtime work first, labels its coding tool and target-history state, and opens the exact branch on its map.

## Keyboard behavior

The inventory is a single-select listbox with one tab stop. Its options are whole branches; target values are static descriptions, not separate controls.

- Up/Down moves the cursor; Enter or Space opens branch details. Cursor movement does not open every intermediate branch.
- Home/End reaches the first/last result, including virtualized rows. Page Up/Down moves by the visible row count. Left/Right scrolls the wide inventory.
- Typing a branch name or title prefix moves the cursor; repeated initial letters cycle through matches. The search field provides substring and task-title search across all branches.
- Down from the search field enters the result list. Clear search returns focus to the search field. Closing branch details returns focus to the originating list or map control when it remains mounted.
- Escape closes the search dialog without dismissing the underlying inspector. Search closing restores its origin unless navigation already focused the selected result.

Option positions and total counts describe the complete filtered result set. The active option stays mounted when pointer scrolling moves it outside the visible window, adding at most one extra option. Result counts are announced when filtering changes them. No-results content fits the viewport without requiring horizontal scrolling.

Global search renders at most fifty matching branches initially. **Show next** reveals another bounded batch, and pressing Down on the last visible result continues directly into that batch. The result total always describes the complete match set. Listbox options use arrow-key focus while Tab stays within the dialog controls; closing restores the search trigger, while choosing a branch transfers focus to its exact map card.

The fictional demo refreshes only its verified runtime timestamps while it remains open, so live-agent examples do not disappear after the production 90-second expiry. Commit dates, task update times, branch facts, and review revisions stay fixed across that refresh. Real workspace activity is never extended this way.

## Implementation and checks

`src/ui/navigation.ts` owns shared position types, map grouping/page selection, scroll anchoring, and keyboard index calculations. `navigationMemory.ts` owns versioned preference decoding, bounded storage, recency, and failure recovery. `useProjectMemory` binds that memory to the authoritative project list and flushes on page exit or hiding; `useInventoryNavigation` coordinates filtering, virtualization, cursor, scroll, and focus. Presentational components use those shared behaviors.

View preferences use the renderer's local storage under the app's origin, not repository files or cloud storage. The document contains identifiers, search text, view choices, and coordinates. At most 100 recently used project positions are retained per workspace mode, and the serialized document is bounded to 2,097,152 characters. Values are decoded through explicit field allowlists and finite-number limits. Search text is limited to 2,048 characters; branch searches disable spellchecking and autocorrection for identifiers.

Writes are coalesced for 250 milliseconds and flushed synchronously on page exit, hiding, or unmount. A forced process kill may lose the most recent unsaved change. Invalid or unavailable storage does not prevent browsing: the app keeps session state, explains the problem, and offers to save the current view again. Optional view preferences do not provide recovery for Git or provider data.

`tests/navigation.test.ts` covers full-set keyboard bounds, insertion/removal anchoring, selected-branch group/page restoration, retained/reset viewports, and type-ahead wrapping. The development-only `/tests/ui/navigation.html` fixture contains 1,000 fictional branches and four target columns. Browser verification reached option 1,000 while only nine options were rendered, matched every header/value horizontal coordinate, preserved a visible branch's screen position after inserting newer work, and restored both axes after unmount/remount.

The full demo was checked for cross-project map page/zoom restoration, inventory filter persistence, search navigation, Escape behavior, and inspector focus return. Reopening a fresh browser tab restored the selected Invoice polish 61 branch, the `invoice` query and local-location filter, and the exact 3,222-pixel vertical position. Another reopen retained the Integrated group, page 49–54, selected branch, and the exact map transform after two zoom-out steps.

`tests/navigation-memory.test.ts` covers new-instance restoration, mode separation, pruning, coalescing/final flush, failed storage and retry, corrupt/oversized preferences, malformed fields, and bounded recency. The development-only `/tests/ui/persistence.html` fixture verifies failed initial loading, restoration while loading, a newer snapshot superseding an older empty response, and rejection of a callback captured before project removal/re-addition. It uses fictional snapshots and separately prefixed storage only.

The native development app was quit and relaunched as a new process using the built renderer. It restored the real OpenBranches project, branch inventory, `openbranches` query, selected feature branch, and inspector. A native round trip through the demo's studio project restored the real workspace independently. These checks do not establish VoiceOver behavior, Intel behavior, or a signed packaged release; those remain release checks.

The development entry unmounts its React root when Vite disposes the module. After controlled hot updates, the preview retained one app root, the selected branch, and the same map transform with no new warning/error logs.

Reference: [WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).

The map keeps React Flow's default attribution. Its maintainers explain their request in the [attribution documentation](https://reactflow.dev/remove-attribution); hiding it is not part of OpenBranches' default configuration.
