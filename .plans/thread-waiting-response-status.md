# Add `Waiting Response` Thread Status Pill

## Summary

Add a new sidebar thread status pill, `Waiting Response`, for threads with unresolved `user-input.requested` activity.

Implement it as a web-side derived status from existing thread activities, not as a new server/contracts field, because the current read model already carries the needed data and the server session `waiting` state is too coarse to distinguish approvals from user-input prompts.

The derivation must also handle stale-request cleanup for user inputs, matching the existing approval behavior. A pending `user-input.requested` must clear not only on `user-input.resolved`, but also when the server records `provider.user-input.respond.failed` for an unknown/stale request.

Scope for this plan:

- Trigger on any unresolved `user-input.requested`, not only explicit plan-mode threads.
- Show the new state in the sidebar thread list only.
- Keep a single status pill per thread.

## Important Changes / Interfaces

No contract, WebSocket, persistence, or server API changes.

Local web-only changes:

- Add a shared thread-status helper module, for example `apps/web/src/threadStatus.ts`.
- Extend the sidebar pill label union to include `Waiting Response`.
- Add one shared activity-derived pending-request selector in `apps/web/src/session-logic.ts` and reuse it from both the sidebar and chat view.

## Implementation

1. Extract sidebar thread-status derivation into a shared helper.
   - Create `apps/web/src/threadStatus.ts`.
   - Move the current status decision logic out of `apps/web/src/components/Sidebar.tsx`.
   - Keep `hasUnseenCompletion(...)` in the helper so the sidebar component stops owning business logic.

2. Define a local derived thread-status shape in the new helper.
   - Use a local status discriminant like:
     - `pendingApproval`
     - `waitingResponse`
     - `working`
     - `connecting`
     - `completed`
   - Return `null` when no pill should render.

3. Define the helper input shape around data the sidebar already has.
   - Accept:
     - `thread: Thread`
     - `hasPendingApprovals: boolean`
     - `hasPendingUserInputs: boolean`
   - Keep this helper web-local; do not add it to contracts.

4. Encode pill precedence in one place.
   - Priority order:
     - `Pending Approval`
     - `Waiting Response`
     - `Working`
     - `Connecting`
     - `Completed`
     - no pill
   - Result:
     - unresolved approvals always win over user-input prompts
     - unresolved user-input prompts suppress working/completed pills

5. Introduce one shared pending-request derivation in `apps/web/src/session-logic.ts`.
   - Add a new selector, for example `derivePendingThreadRequests(...)`, that:
     - sorts activities once
     - derives both pending approvals and pending user inputs in the same pass
     - returns a shape like:
       - `approvals: PendingApproval[]`
       - `userInputs: PendingUserInput[]`
   - Update `derivePendingApprovals(...)` and `derivePendingUserInputs(...)` to delegate to the shared selector, or replace call sites directly with the shared selector where that is clearer.
   - Do not add any second independent activity scan in the sidebar.

6. Handle stale-request cleanup for user inputs.
   - In the shared pending-request derivation, clear a pending user input when either of these appears for the same `requestId`:
     - `user-input.resolved`
     - `provider.user-input.respond.failed` whose `detail` indicates an unknown pending user input request
   - Mirror the existing approval stale-request rule:
     - approvals clear on `provider.approval.respond.failed` with unknown pending permission request
   - Do not clear pending user inputs on arbitrary response failures; only clear the explicit unknown/stale-request case.

7. Update `apps/web/src/components/Sidebar.tsx`.
   - Replace the current `pendingApprovalByThreadId` map with one memoized per-thread pending-request map derived from the shared selector.
   - For each thread, derive both booleans from one selector call and store:
     - `hasPendingApprovals`
     - `hasPendingUserInputs`
   - Replace the current inline `threadStatusPill(...)` decision path with the shared helper.
   - Extend `ThreadStatusPill["label"]` to include `Waiting Response`.
   - Map the new state to:
     - label: `Waiting Response`
     - pulse: `false`

8. Update `apps/web/src/components/ChatView.tsx` to use the same shared pending-request derivation.
   - Replace the separate `derivePendingApprovals(...)` and `derivePendingUserInputs(...)` calls with one memoized shared selector call.
   - Read `pendingApprovals` and `pendingUserInputs` from that shared result.
   - This ensures the stale-request fix applies to the active-thread UX too, not only the sidebar.

9. Add visual treatment for the new pill.
   - Use an orange/amber waiting color distinct from:
     - `Pending Approval` amber
     - `Working` sky
     - `Completed` emerald
   - Recommended styling:
     - text: orange
     - dot: orange
     - no pulse
   - Final class names should be chosen to stay legible in both light and dark themes.

10. Leave chat-thread input UX unchanged beyond the shared derivation swap.
   - Keep the existing pending user-input UI in `apps/web/src/components/ChatView.tsx`.
   - Do not change composer disabling, question rendering, or submission flow for this task.

## Behavior Details

- A thread with unresolved `user-input.requested` activity shows `Waiting Response`.
- If the same thread also has an unseen completed turn, `Waiting Response` still wins.
- If the same thread also has `session.status === "running"`, `Waiting Response` still wins.
- If the thread has both a pending approval and pending user input, `Pending Approval` wins.
- Once the matching `user-input.resolved` activity is present, the `Waiting Response` pill disappears and normal status derivation resumes.
- If a response attempt fails because the request is unknown/stale, the pending user-input state also clears and `Waiting Response` disappears.

## Test Cases and Scenarios

Add focused unit coverage in `apps/web/src/threadStatus.test.ts`:

- returns `waitingResponse` when a thread has unresolved pending user input
- returns `waitingResponse` when the session is `running`
- returns `waitingResponse` instead of `completed` when both conditions are true
- returns `pendingApproval` instead of `waitingResponse` when both are present
- returns `completed` when there is no pending approval/input and the latest turn completed after `lastVisitedAt`
- returns `null` when none of the status conditions apply

Keep or extend the existing `apps/web/src/session-logic.test.ts` coverage for pending user-input derivation:

- unresolved `user-input.requested` yields an open pending input entry
- matching `user-input.resolved` clears it
- matching `provider.user-input.respond.failed` with unknown/stale request detail clears it
- non-stale `provider.user-input.respond.failed` does not clear it
- shared pending-request derivation returns approvals and user inputs correctly from one ordered pass
- malformed payloads are ignored

Add or extend component-level tests where worthwhile:

- sidebar status derivation uses one shared per-thread pending-request result instead of separate approval and user-input scans
- active chat view still renders the pending user-input UI after the shared selector refactor

## Validation / Acceptance

- Run targeted Vitest coverage for the affected web logic with `bun run test ...`
- Run `bun lint`
- Run `bun typecheck`

Do not use `bun test`.

## Assumptions and Defaults

- `Waiting Response` is the final copy.
- The trigger is any unresolved `user-input.requested`, not just plan-mode prompts.
- The change is intentionally sidebar-only for now.
- The stale-request cleanup applies in both sidebar and active-thread pending user-input derivation, because both consume the same shared selector.
- No server-side thread status field is introduced.
- No migration or persistence changes are needed.
