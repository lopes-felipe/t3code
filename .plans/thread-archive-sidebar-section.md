# Per-Project Thread Archive

## Summary

Add a first-class thread archive state to the orchestration model and persistence layer, then render each project as two thread buckets in the sidebar: active threads first, then an `Archived` subsection when that project has archived threads.

Behavior:

- Active thread rows get a hover action labeled `Archive`.
- Archived thread rows get the inverse hover action labeled `Unarchive`.
- Archived threads remain directly viewable and routable, but they are excluded from active flows such as recent-thread switching and project activity ordering.
- Archiving is reversible in v1.

## Public API / Type Changes

- Add `archivedAt: IsoDateTime | null` to `packages/contracts/src/orchestration.ts` `OrchestrationThread`, with a decode default of `null` for backward compatibility.
- Add two client commands to `packages/contracts/src/orchestration.ts`:
  - `thread.archive { commandId, threadId, createdAt }`
  - `thread.unarchive { commandId, threadId, createdAt }`
- Add two domain events and payloads:
  - `thread.archived { threadId, archivedAt }`
  - `thread.unarchived { threadId, unarchivedAt }`
- Add matching `archivedAt` to:
  - `apps/server/src/persistence/Services/ProjectionThreads.ts` `ProjectionThread`
  - `apps/web/src/types.ts` `Thread`
- Export the new event payload schemas through `apps/server/src/orchestration/Schemas.ts` so the server alias surface stays complete for the in-memory projector and other orchestration consumers.

## Server Changes

- Add `archived_at TEXT` to `projection_threads`.
- Create migration `015_ProjectionThreadsArchivedAt.ts` and register it in `apps/server/src/persistence/Migrations.ts`.
- Update `apps/server/src/persistence/Migrations/005_Projections.ts` so fresh databases create `projection_threads.archived_at` from the start.
- In migration `015`, backfill `archived_at = NULL` for existing rows and add an index on `(project_id, archived_at, last_interaction_at)`.

Update orchestration domain handling:

- In `apps/server/src/orchestration/decider.ts`, emit explicit archive and unarchive events instead of overloading `thread.meta.update`.
- Reject `thread.archive` when the thread is already archived.
- Reject `thread.unarchive` when the thread is not archived.
- Use the command `createdAt` as the event occurrence time for both commands.

Update projection write paths:

- In `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`, set `archivedAt` on:
  - `thread.created` -> `null`
  - `thread.archived` -> `payload.archivedAt`
  - `thread.unarchived` -> `null`
- In `apps/server/src/persistence/Layers/ProjectionThreads.ts`, extend the thread row `INSERT`, `ON CONFLICT UPDATE`, and `SELECT` paths so `archived_at` actually round-trips through the SQL projection repository.
- Keep `lastInteractionAt` unchanged when archiving or unarchiving.
- Keep archive state independent from thread deletion, worktree cleanup, and session-stop behavior.

Update snapshot read paths:

- In `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`, select `archived_at AS "archivedAt"` for threads.
- In the project ordering SQL, ignore archived child threads when deriving the hottest child activity for project sorting.
- Leave thread snapshot ordering as the existing activity order; the client will partition active versus archived threads per project.

Update in-memory read model parity:

- In `apps/server/src/orchestration/projector.ts`, add `archivedAt` to projected threads.
- Seed `thread.created` with `archivedAt: null`.
- Apply `thread.archived` and `thread.unarchived` by toggling `archivedAt` and updating `updatedAt`.

## Web Changes

- In `apps/web/src/store.ts`, map `thread.archivedAt` from the read model.
- Extract shared archive-aware helpers into `apps/web/src/lib/threadOrdering.ts` so archive filtering is not duplicated across the sidebar and recency features.
- Add helpers for:
  - `isArchivedThread`
  - `partitionThreadsByArchive`
  - active-only project ordering

Update recency and ordering:

- In `apps/web/src/components/ThreadRecencyController.tsx`, exclude archived persisted threads from `eligibleThreadIds`.
- Update `getMostRecentProject`, `getMostRecentThreadForProject`, and related active-flow helpers so only non-archived child threads influence helper-driven project and thread selection.
- Update `apps/web/src/components/Sidebar.tsx` `focusMostRecentThreadForProject` to use the active-only helper path so re-selecting an already-added project does not navigate into an archived thread.
- If the currently open thread is archived, leave the route untouched; the thread simply stops participating in future recency switching until unarchived.
- Do not add store-layer logic to reshuffle persisted sidebar project order on archive or unarchive. The sidebar should continue honoring the existing persisted/manual project order; archive state only changes active-flow helpers and per-project thread bucketing.

Update the sidebar UX in `apps/web/src/components/Sidebar.tsx`:

- Split each project's threads into `activeThreads` and `archivedThreads`, each independently sorted by the existing activity comparator.
- Keep the current top list for active threads.
- Render an inline `Archived` label only when `archivedThreads.length > 0`.
- Apply the existing preview limit (`THREAD_PREVIEW_LIMIT`) separately to active and archived buckets.
- Track show more/show less state separately for each project bucket.
- Build the per-project selection order from the actual rendered order, not from the pre-partition activity array: `activeThreadIds` first, then `archivedThreadIds`. Pass that combined ordered list into the existing range-selection logic so shift-click behavior matches the visible list.
- Add a trailing hover or focus-visible action button to active rows labeled `Archive`; clicking it dispatches `thread.archive` and does not navigate.
- Add the inverse trailing action to archived rows labeled `Unarchive`; clicking it dispatches `thread.unarchive`.
- Add `Archive` or `Unarchive` to the single-thread context menu so the keyboard and right-click paths match the hover button.
- Leave multi-select context menu behavior unchanged in v1.
- Do not optimistically mutate local archive state; rely on the existing orchestration snapshot and domain-event sync to move rows between sections.
- On dispatch failure, show a toast and leave the row in place.

## Behavioral Rules

- The archived bucket is per project, not global.
- The archived subsection is visible inline by default when present; only long lists collapse behind the existing preview pattern.
- Archived threads do not affect active-flow helpers such as `getMostRecentProject`, `getMostRecentThreadForProject`, or recent-thread cycling.
- Archiving does not by itself reorder the persisted project list shown in the sidebar.
- Archiving does not stop a running session, does not delete worktrees, and does not navigate the user away if the archived thread is currently open.
- This is app-level organization only; do not wire it to Codex provider `thread/archived` runtime events.

## Test Cases and Scenarios

- Contract tests: command and event schema decoding, plus `archivedAt` defaulting to `null`.
- Decider tests: archive emits `thread.archived`, unarchive emits `thread.unarchived`, and duplicate archive or unarchive requests fail with invariant errors.
- In-memory projector tests: archive and unarchive toggle `archivedAt` correctly without mutating unrelated thread fields.
- Projection pipeline tests: `projection_threads.archived_at` is written correctly for create, archive, and unarchive flows.
- Projection thread repository tests: `archived_at` is included in SQL upsert and select paths.
- Snapshot query tests: `archivedAt` hydrates correctly and archived child threads do not drive project sort order.
- Migration test: existing `projection_threads` tables upgrade cleanly and keep rows readable with `archived_at = NULL`.
- Store tests: `syncServerReadModel` maps `archivedAt`.
- Thread-ordering helper tests: active-only project sorting ignores archived threads.
- Thread-ordering helper tests: `getMostRecentThreadForProject` ignores archived threads and returns `null` when a project only has archived threads.
- Recency tests: archived threads are excluded from recent-thread switching eligibility.
- Thread-selection tests: shift-click range selection follows the rendered per-project order across the active and archived buckets.
- Sidebar behavior test: archiving moves a row from the active bucket into `Archived` after the orchestration sync updates state.
- Sidebar behavior test: unarchiving returns the row to the active bucket in normal activity order.
- Sidebar behavior test: focusing an already-added project ignores archived threads and selects the most recent active thread, or does nothing if none exist.
- Manual QA: archive an inactive thread, archive the currently open thread, unarchive from the archived section, and verify the hover buttons remain keyboard accessible through focus.

## Validation / Acceptance

- Run targeted Vitest suites with `bun run test ...`.
- Run `bun lint`.
- Run `bun typecheck`.

## Assumptions and Defaults

- Archive is a reversible organizational state, not deletion.
- Archived threads remain fully readable and directly navigable by URL and sidebar click.
- No bulk archive or unarchive action is included in this scope.
- No provider-level archive synchronization is included in this scope.

