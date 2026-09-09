# Keeping your place

OpenBranches keeps each project's selected branch, lifecycle group, expanded map group, map page, viewport, inventory search, filters, cursor, and scroll position while the app remains open. Switching to another project or view restores that position. Demo and real projects use separate memory. Removed projects are discarded, and late callbacks cannot recreate their view memory. This UI memory is not yet saved across app restarts; persisted review decisions remain independent.

Switching from the inventory to the map reveals the selected working branch in its current lifecycle group and six-branch page. An unchanged page retains its viewport. Explicit map group/page navigation clears the inspector selection, so an unrelated branch does not stay highlighted elsewhere. Incoming snapshot changes clear selections that no longer exist.

The inventory has one scrolling surface for its sticky header and rows. All discovered integration targets have a column, including projects with develop, dev, main, and master together. Horizontal scrolling moves headers and values together. Refreshes anchor the viewport to its visible branch when earlier rows are inserted or reordered. Closing and reopening the inventory preserves filters, horizontal position, and the visible row offset. A global search result clears conflicting inventory filters and focuses the selected result.

## Keyboard behavior

The inventory is a single-select listbox with one tab stop. Its options are whole branches; target values are static descriptions, not separate controls.

- Up/Down moves the cursor; Enter or Space opens branch details. Cursor movement does not open every intermediate branch.
- Home/End reaches the first/last result, including virtualized rows. Page Up/Down moves by the visible row count. Left/Right scrolls the wide inventory.
- Typing a branch name or title prefix moves the cursor; repeated initial letters cycle through matches. The search field provides substring and task-title search across all branches.
- Down from the search field enters the result list. Clear search returns focus to the search field. Closing branch details returns focus to the originating list or map control when it remains mounted.
- Escape closes the search dialog without dismissing the underlying inspector. Search closing restores its origin unless navigation already focused the selected result.

Option positions and total counts describe the complete filtered result set. The active option stays mounted when pointer scrolling moves it outside the visible window, adding at most one extra option. Result counts are announced when filtering changes them. No-results content fits the viewport without requiring horizontal scrolling.

## Implementation and checks

`src/ui/navigation.ts` owns shared position types, map grouping/page selection, scroll anchoring, and keyboard index calculations. `useProjectMemory` scopes session state; `useInventoryNavigation` coordinates filtering, virtualization, cursor, scroll, and focus. Presentational components use those shared behaviors.

`tests/navigation.test.ts` covers full-set keyboard bounds, insertion/removal anchoring, selected-branch group/page restoration, retained/reset viewports, and type-ahead wrapping. The development-only `/tests/ui/navigation.html` fixture contains 1,000 fictional branches and four target columns. Browser verification reached option 1,000 while only nine options were rendered, matched every header/value horizontal coordinate, preserved a visible branch's screen position after inserting newer work, and restored both axes after unmount/remount.

The full demo was checked for cross-project map page/zoom restoration, inventory filter persistence, search navigation, Escape behavior, and inspector focus return. The final viewport remained identical after switching projects. These browser checks do not establish VoiceOver behavior or combined packaged-app verification; those remain release checks, together with durable view positions across restarts.

Reference: [WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).
