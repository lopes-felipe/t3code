# Activity-Based Chat Ordering Within Projects

## Summary

Implement canonical "last interaction" ordering for threads and projects, driven by a new server-maintained `lastInteractionAt` timestamp on each thread.

Behavior:

- Threads within a project sort by `lastInteractionAt DESC`, then `createdAt DESC`, then `threadId DESC`.
- Projects sort by the hottest non-deleted child thread's `lastInteractionAt DESC`; projects with no threads fall back to `project.createdAt DESC`, then `projectId DESC`.
- The sidebar thread timestamp switches from `createdAt` to `lastInteractionAt`.
- Metadata-only changes such as rename, branch updates, runtime-mode changes, interaction-mode changes, and lifecycle-only session status changes do not affect ordering.

## Public API / Type Changes

- Add `lastInteractionAt: IsoDateTime` to `packages/contracts/src/orchestration.ts` `OrchestrationThread`.
- Add matching `lastInteractionAt` to:
  - `apps/server/src/persistence/Services/ProjectionThreads.ts` `ProjectionThread`
  - `apps/web/src/types.ts` `Thread`
- Add `createdAt` to `apps/web/src/types.ts` `Project` so the client can deterministically sort empty projects without depending on incoming array order.

## Server Changes

- Add `last_interaction_at TEXT NOT NULL` to `projection_threads`.
- Create migration `014_ProjectionThreadsLastInteractionAt.ts` and register it in `apps/server/src/persistence/Migrations.ts`.
- Update `apps/server/src/persistence/Migrations/005_Projections.ts` so fresh databases create `projection_threads.last_interaction_at` from the start.
- In migration `014`, backfill `last_interaction_at = updated_at` for existing rows and add an index on `(project_id, last_interaction_at)`.

Update projection write paths:

- In `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`, set `lastInteractionAt` on:
  - `thread.created` -> `payload.createdAt`
  - `thread.message-sent` -> `event.occurredAt`
  - `thread.proposed-plan-upserted` -> `event.occurredAt`
  - `thread.activity-appended` -> `event.occurredAt`
  - `thread.turn-diff-completed` -> `event.occurredAt`
  - `thread.reverted` -> `event.occurredAt`
- Leave `lastInteractionAt` unchanged for:
  - `thread.meta-updated`
  - `thread.runtime-mode-set`
  - `thread.interaction-mode-set`
  - `thread.session-set`
  - `thread.deleted`

Update snapshot read paths:

- In `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`, select `last_interaction_at AS "lastInteractionAt"` for threads.
- Sort thread rows in snapshot SQL by `last_interaction_at DESC, created_at DESC, thread_id DESC`.
- Sort project rows in snapshot SQL by derived hottest non-deleted child thread activity, with fallback to `projection_projects.created_at`.
- Exclude deleted threads from the project-activity aggregate.

Update in-memory read model parity:

- In `apps/server/src/orchestration/projector.ts`, add `lastInteractionAt` to projected threads and update it on the same interaction events as the DB projector.
- Keep metadata-only events from touching `lastInteractionAt`.
- Seed `thread.created` with `createdAt` so empty/new threads are still sortable.

## Web Changes

- In `apps/web/src/store.ts`, map `thread.lastInteractionAt` from the read model and include `project.createdAt`.
- Change initial unread seeding in `apps/web/src/store.ts` from `existing?.lastVisitedAt ?? thread.updatedAt` to `existing?.lastVisitedAt ?? thread.lastInteractionAt` so first-load unread state matches the new canonical activity signal.
- Extract shared ordering helpers into a small utility module, for example `apps/web/src/lib/threadOrdering.ts`, to avoid duplicated sort logic.
- Use the shared helpers in `apps/web/src/components/Sidebar.tsx` for:
  - Project list rendering
  - Per-project thread list rendering
  - `focusMostRecentThreadForProject`
  - Any fallback that currently uses `projects[0]`
  - Active-thread deletion fallback navigation, which currently uses raw `threads.find(...)`
- Change the sidebar relative-time label from `thread.createdAt` to `thread.lastInteractionAt`.
- Keep preview slicing (`THREAD_PREVIEW_LIMIT`) after sorting so "Show more" always reveals older threads.

## Sorting Rules

- Thread comparator:
  - `lastInteractionAt DESC`
  - `createdAt DESC`
  - `threadId DESC`
- Project comparator:
  - `max(nonDeletedChild.lastInteractionAt) DESC`
  - `project.createdAt DESC`
  - `projectId DESC`

## Test Cases and Scenarios

- Server projector test: rename a thread after a message; `updatedAt` changes but `lastInteractionAt` does not.
- Server projector test: `thread.session-set` with lifecycle-only statuses like `ready`, `stopped`, and `error` does not change `lastInteractionAt`.
- Server projector test: each interaction event listed above bumps `lastInteractionAt`.
- Migration test: existing rows get `last_interaction_at` backfilled from `updated_at`.
- Snapshot query test: threads return with `lastInteractionAt` and are ordered by it, not by creation time.
- Snapshot query test: projects reorder by hottest child thread; empty projects fall back to project creation time.
- Web helper test: tie-breaking is deterministic for equal timestamps.
- Sidebar test: displayed relative time uses `lastInteractionAt`.
- Sidebar behavior test: adding an already-known project navigates to the most recently interacted thread, not the newest-created thread.
- Sidebar behavior test: deleting the active thread navigates to the canonical most-recent remaining thread, not the first raw array entry.
- Store test: initial `lastVisitedAt` seeding for a newly hydrated client uses `lastInteractionAt`, not `updatedAt`.
- Reconnect scenario: after a domain event and full snapshot resync, ordering stays identical.
- Deleted-thread scenario: deleting the hottest thread recomputes project order from remaining non-deleted threads.

## Validation / Acceptance

- Run targeted Vitest suites with `bun run test ...`.
- Run `bun lint`.
- Run `bun typecheck`.

## Assumptions and Defaults

- "Last interaction" means conversation/runtime activity only, not metadata edits.
- Lifecycle-only session transitions such as `ready`, `stopped`, and `error` do not bubble a thread.
- Assistant-side activity during a turn counts, so active chats can bubble while work is in progress.
- Historical data cannot be perfectly reconstructed, so migration backfill uses existing `updated_at`.
- No separate project `lastInteractionAt` contract field is added; project ordering is derived from threads.
- Empty newly created threads are considered active at creation time until their first real interaction.
