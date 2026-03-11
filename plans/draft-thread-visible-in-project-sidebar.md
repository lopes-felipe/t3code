# Draft Thread Visibility In Project Sidebar

## Summary

When a user opens a new thread from the sidebar project action or via the new-thread keyboard shortcuts, the app should immediately surface that draft thread inside the correct project section in the left sidebar.

Today, opening a new thread creates or reuses a project-scoped draft thread in `useComposerDraftStore`, but the sidebar only renders server-backed `threads`. The implementation should make draft threads first-class in the sidebar projection layer so the active draft is visible, selected, and grouped under its owning project before the first message is sent.

Key files:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/composerDraftStore.ts`
- `apps/web/src/lib/threadOrdering.ts`
- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/ThreadSidebar.browser.tsx`

## Public API / Type Changes

- No contract, server, WebSocket, or shared package schema changes.
- No orchestration command or event changes.
- Add a new internal web helper module for projecting local draft threads into the existing `Thread` UI shape so `ChatView` and `Sidebar` share the same logic.
- Add a second internal helper in that same module for composing a project’s persisted threads plus its optional local draft thread before sidebar rendering.
- Reuse the existing `Thread` type in `apps/web/src/types.ts`; do not introduce a separate sidebar-only thread model unless a tiny internal alias is needed during refactoring.

## Product Rules

- Keep the current one-draft-per-project behavior.
- If a project already has an unsent draft thread, opening a new thread for that project reuses and focuses that draft instead of creating a second draft.
- If the target project is collapsed, auto-expand it so the draft row is visible immediately.
- Draft threads appear in the active thread list for their project, never in archived threads.
- Draft rows use the existing `"New thread"` title and should be highlighted as the active row when their route is open.
- A project draft row must remain visible in that project even when the active-thread bucket is collapsed and the draft would otherwise fall below the preview cutoff.
- Draft rows are single-select only for this feature. They do not participate in multi-select or bulk actions.

## Web Changes

Extract local draft-thread projection from `apps/web/src/components/ChatView.tsx` into a shared helper module under `apps/web/src/lib/`.

- Move the current `buildLocalDraftThread(...)` logic out of `ChatView.tsx`.
- Give the helper an explicit caller contract so both `ChatView` and `Sidebar` resolve models the same way:
  - input: `threadId`, `draftThread`, `projectModel`, and optional `error`
  - fallback chain inside the helper: `projectModel ?? DEFAULT_MODEL_BY_PROVIDER.codex`
- Keep the projected draft thread shape identical to current `ChatView` behavior:
  - `title: "New thread"`
  - `session: null`
  - empty `messages`, `activities`, `proposedPlans`, and `turnDiffSummaries`
  - `archivedAt: null`
  - `createdAt` and `lastInteractionAt` derived from the draft
  - `projectId`, `branch`, `worktreePath`, `runtimeMode`, and `interactionMode` copied from the draft

Add a small composition helper in the same module, for example `getProjectThreadsWithDraft(...)`, so sidebar-specific draft injection is not inlined into the render loop.

- Inputs should include:
  - `projectId`
  - persisted project threads already filtered to that project
  - mapped draft thread for that project, if present
  - project model
- The helper should:
  - inject the draft into the per-project filtered thread list before `partitionThreadsByArchive(...)`
  - skip injection if a persisted thread with the same id already exists
  - return a single project-visible thread list ready for partition/sort logic
  - be unit-testable independently from the sidebar component

Update `apps/web/src/components/Sidebar.tsx` so the sidebar renders a project-visible thread list instead of only server-backed threads.

- For each project, compute:
  - all persisted server threads for that project
  - the mapped draft thread from `getDraftThreadByProjectId(project.id)`, if present
- Use the new composition helper to inject the draft into the per-project filtered thread list before `partitionThreadsByArchive(...)`.
- Do not duplicate rows if the server snapshot already contains the same thread id after promotion.
- Continue using the existing `partitionThreadsByArchive(...)` and `sortThreadsByActivity(...)` flow after the draft has been injected.
- Let the projected draft participate in normal active-thread sorting by `lastInteractionAt` / `createdAt`.
- When the active bucket is collapsed, adjust `visibleActiveThreads` so the project draft row is always included if it exists:
  - if the draft is already in the preview slice, keep the normal slice
  - if the draft would be truncated, replace the last preview slot with the draft row instead of hiding it
  - keep the bucket visually collapsed; do not force-open the active-thread preview bucket just to reveal the draft
- This visibility rule applies whether the draft is currently focused or not, so navigating away from the draft or reloading with a persisted draft does not hide the row behind the preview limit.

Update the new-thread flow in `apps/web/src/components/Sidebar.tsx` so opening a draft always expands the target project.

- Pull `setProjectExpanded` from the store and use `setProjectExpanded(projectId, true)`, not `toggleProject(...)`.
- Apply it in all `handleNewThread(...)` branches:
  - when reusing an already mapped draft
  - when reusing the current route draft for the same project
  - when creating a brand-new draft thread id
- Keep the existing route navigation and draft-context behavior unchanged.

Reuse the existing sidebar row rendering for draft threads with minimal special casing.

- Draft rows should navigate exactly like server-thread rows via `/$threadId`.
- Active row highlighting should continue to key off `routeThreadId === thread.id`.
- Existing status-pill logic should treat draft rows as idle rows with no session/activity.
- Add a small helper such as `isDraftThreadId(threadId)` based on `draftThreadsByThreadId` so row-level guards stay explicit and cheap.
- Draft rows should not open the persisted-thread context menu in this feature.
- Draft rows should not support persisted-thread secondary actions such as rename, archive, mark unread, delete, or copy thread id.
- Exclude draft ids from multi-select and range-select:
  - mod-click or shift-click on a draft row should behave like a plain activate/focus click
  - `orderedProjectThreadIds` used for range selection should contain persisted thread ids only
  - bulk actions should continue to operate only on persisted threads
- A draft-specific secondary action such as “Discard draft” is intentionally out of scope for this change.

Keep promotion behavior stable when a draft becomes a real server thread.

- Once first send succeeds, `thread.create` persists the same thread id on the server.
- Snapshot sync adds the server thread to `store.threads`.
- `clearDraftThread(threadId)` removes the local draft.
- Sidebar rendering should naturally show a single row for that id because draft injection is skipped when the server thread already exists.
- Route selection must remain on the same thread id throughout the transition.
- Treat the snapshot-sync-plus-draft-clear window as a race to cover in tests: deduplication by thread id must prevent a temporary double row even if both sources are visible during one render pass.

## Behavioral Rules

- Clicking the per-project “New thread” button should make a draft row appear in that same project immediately.
- Pressing the new-thread keyboard shortcut should use the current thread or current draft thread’s project, falling back to the most recent project exactly as the current sidebar shortcut logic already does.
- Opening a new thread for a project that already has a draft should focus the existing draft row instead of creating another.
- The draft row must be visible immediately, before any message is sent.
- The project containing the draft must be expanded automatically.
- The draft row must remain visible while the draft exists, even if it is older than the preview cutoff and even after the user navigates to another thread.
- The active-thread preview bucket should keep its normal collapsed/expanded affordance; draft visibility is handled by pinning the draft into the visible slice, not by force-expanding the bucket.
- For this plan, “opening a new thread” is limited to the sidebar button and sidebar keyboard shortcut entrypoints. `ChatView` flows that create or reuse project drafts for PR/worktree setup are out of scope.
- Draft rows should disappear only when the draft is cleared and no persisted server thread with the same id exists.

## Test Cases and Scenarios

- Add a browser/integration test for clicking a project’s “New thread” button:
  - route changes to a draft thread id
  - the project auto-expands if collapsed
  - a `New thread` row appears under that project
  - that row is active/selected
- Add a browser/integration test for `chat.new` from an existing server thread:
  - the new or reused draft appears under the active thread’s project
  - branch/worktree context remains unchanged from the current behavior
- Add a browser/integration test for `chat.newLocal`:
  - the draft appears under the same project
  - only one draft row exists for that project
- Add a browser/integration test for draft reuse:
  - trigger new-thread twice for the same project
  - assert there is still only one visible `New thread` row
  - assert navigation focuses the existing draft
- Add a browser/integration test for preview-limit visibility:
  - seed a project with more than `THREAD_PREVIEW_LIMIT` active threads
  - seed or reuse a draft whose timestamps would normally sort it below the visible cutoff
  - assert the draft row is still visible in the collapsed active bucket
- Add a browser/integration test for navigating away from a draft:
  - create or reuse a visible draft row
  - navigate to a different persisted thread in the same project
  - assert the draft row remains visible in the sidebar until it is cleared
- Add a browser/integration test for browser refresh with a persisted draft:
  - seed `useComposerDraftStore` persistence with a draft mapped to a project
  - mount or reload the app
  - assert the sidebar shows the draft row after hydration
- Extend the existing draft-promotion test path:
  - start from a visible draft row in the sidebar
  - simulate snapshot sync that adds the server thread with the same id
  - clear the draft
  - assert the route remains on that thread and only one row is shown
- Add coverage for draft-row selection behavior:
  - mod-click or shift-click on a draft row does not add it to the bulk selection set
  - persisted-thread bulk actions remain available for persisted selections only
- Add unit coverage for the extracted draft-thread projection helper:
  - maps draft state into a `Thread` correctly
  - falls back to project/default model correctly
- Add unit tests for the sidebar composition helper:
  - injecting one draft row into the correct project
  - not injecting when no draft exists
  - not duplicating when the server thread already exists
  - leaving archived-thread handling unchanged
  - forcing the project draft row into the visible collapsed preview slice when it would otherwise be truncated

## Validation / Acceptance

- Opening a new thread from the sidebar button or sidebar keyboard shortcut makes a visible `New thread` row appear under the correct project.
- The row is visible before the first message is sent.
- The correct project expands automatically when needed.
- The row stays visible while the draft exists, even if the project has more active threads than the preview limit.
- Only one unsent draft row exists per project.
- Draft rows do not participate in bulk selection or persisted-thread bulk actions.
- Draft promotion to a server thread does not create duplicate sidebar rows or break route selection.
- Existing model/runtime/worktree context behavior for new-thread actions remains unchanged.

## Assumptions and Defaults

- “New thread window” refers to the routed local draft thread view opened by the sidebar button or new-thread shortcuts.
- This change is web-sidebar-only and does not require server work.
- The existing one-draft-per-project behavior remains the intended product rule.
- Draft rows belong in the active thread bucket and follow normal thread ordering.
- Draft-specific actions such as “Discard draft” are intentionally not designed in this plan.
