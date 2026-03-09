# MRU Thread Switching With `Ctrl+Tab`

## Summary
Add recent-thread switching to the web client using the existing keybindings system, with desktop-first defaults:

- `thread.switchRecentNext` mapped to `ctrl+tab`
- `thread.switchRecentPrevious` mapped to `ctrl+shift+tab`

The feature will track a per-window MRU list of visited thread routes, including valid draft-only thread routes. Repeated `Ctrl+Tab` presses while the shortcut’s held modifiers remain pressed will cycle through a frozen snapshot of the MRU order instead of bouncing between only the last two threads. The MRU list is in-memory only and resets on reload/restart.

## Scope
- In scope:
  - Desktop/Electron-first behavior for `ctrl+tab` and `ctrl+shift+tab`
  - Browser support for the new commands and custom fallback bindings through `keybindings.json`
  - Server-backed keybinding command support and defaults
  - Web-client MRU tracking and cycling logic
  - Inclusion of draft-only threads in the MRU list
  - Pruning deleted/invalid threads from MRU state and any active cycle state
- Out of scope:
  - A visible switcher overlay/palette
  - Persistence of recent-thread history across reloads
  - Cross-window MRU sharing
  - Any server/orchestration state for thread recency

## Public API / Interface Changes
Update the keybinding command schema in [packages/contracts/src/keybindings.ts](/Users/felipelopes/dev/wolt/t3code-fork/packages/contracts/src/keybindings.ts):

- Add `thread.switchRecentNext`
- Add `thread.switchRecentPrevious`

Update default server keybindings in [apps/server/src/keybindings.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/server/src/keybindings.ts):

- Add `{ key: "ctrl+tab", command: "thread.switchRecentNext" }`
- Add `{ key: "ctrl+shift+tab", command: "thread.switchRecentPrevious" }`

No new WebSocket methods are needed. Existing `server.getConfig` and `server.upsertKeybinding` flows already carry resolved keybindings.

## Behavioral Spec
Use these exact rules in the implementation:

1. Eligible thread IDs
- Include all server-backed threads from the main app store.
- Include only draft-only thread IDs present in `draftThreadsByThreadId` from the composer draft store.
- Do not treat `draftsByThreadId` as a source of routable thread IDs.
- Exclude deleted threads, cleared drafts, and invalid route IDs.
- Treat the active `/$threadId` route as the current thread when present.
- If the user is on a non-thread route such as settings, allow switching into the most recent eligible thread.

2. MRU ordering
- Maintain a per-window list of thread IDs ordered most-recent-first.
- Whenever the active thread route changes through normal navigation, move that thread ID to the front.
- Do not duplicate IDs in the list.
- Prune IDs that are no longer eligible whenever server threads or draft threads change.
- Use the same eligibility source of truth as the route guard: a thread ID is eligible only if it exists in the server thread list or in `draftThreadsByThreadId`.

3. Cycling semantics
- First `thread.switchRecentNext` from active thread `A` with MRU `[A, B, C, D]` navigates to `B`.
- Additional `thread.switchRecentNext` presses while the same matched shortcut’s held modifiers are still pressed navigate to `C`, then `D`, then wrap to `A`.
- `thread.switchRecentPrevious` moves backward through that same frozen cycle list.
- While a cycle session is active, route changes caused by the cycle must not rewrite MRU ordering immediately.
- When the matched shortcut’s held modifiers are released, commit the final active thread to the front of the MRU list and end the cycle session.
- If there is no active thread route, initialize the cycle from the current MRU list and navigate to its first entry.
- If there are fewer than 1 eligible threads from a non-thread route, do nothing.
- If there are fewer than 2 eligible threads from an active thread route, do nothing.
- If the resolved shortcut has no held modifiers, treat it as a single-step command: navigate once, commit immediately, and do not keep an active cycle session alive across keyup events.
- When eligibility changes mid-cycle:
  - prune invalid IDs from `activeCycle.order`
  - if the active route thread is still present in the pruned order, reset the cycle index to that thread’s position
  - if the active route thread is no longer eligible, or the pruned order is too short to continue cycling, terminate the cycle immediately without further navigation

4. Event boundaries
- Start cycling on `keydown` for the resolved command.
- End cycling on:
  - release of any held modifier required by the matched shortcut (`keyup`)
  - window blur
  - document visibility loss
  - any non-cycle navigation initiated outside the cycle flow
- Ignore shortcut handling when `event.defaultPrevented` is already true.

5. Keybinding context
- Default bindings will have no `when` clause, so they work regardless of terminal focus.
- Custom user bindings may still add `when` constraints through `keybindings.json`.
- The controller must resolve commands with explicit shortcut context:
  - `terminalFocus`: reuse the same DOM-based terminal focus check currently used by the chat shortcut handling
  - `terminalOpen`: derive from the active thread’s terminal state when a thread route is active, otherwise `false`
- The controller must derive cycle ownership from the matched shortcut/event shape, not from a hard-coded `"ctrl" | "meta"` assumption.

6. Platform behavior
- Desktop/Electron is the supported default target for `ctrl+tab`.
- Browser builds should still expose the commands through the resolver, but the plan assumes browsers may reserve `Ctrl+Tab`; users can remap to a different binding if needed.
- Do not add browser-only alternate defaults.
- Do not use `mod+tab` as the default because `mod` resolves to `meta` on macOS in this codebase, which would become `Cmd+Tab` and conflict with OS app switching.

## Implementation Plan

### 1. Extend keybinding contracts and defaults
Touch:
- [packages/contracts/src/keybindings.ts](/Users/felipelopes/dev/wolt/t3code-fork/packages/contracts/src/keybindings.ts)
- [packages/contracts/src/keybindings.test.ts](/Users/felipelopes/dev/wolt/t3code-fork/packages/contracts/src/keybindings.test.ts)
- [apps/server/src/keybindings.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/server/src/keybindings.ts)
- [apps/server/src/keybindings.test.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/server/src/keybindings.test.ts)
- [apps/server/src/wsServer.test.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/server/src/wsServer.test.ts)

Changes:
- Extend the static command union.
- Ensure resolved keybinding compilation accepts the new commands.
- Add defaults and verify merge/upsert behavior still works.
- Verify `server.getConfig` includes the new defaults when no user override exists.

### 2. Extend client-side shortcut helpers
Touch:
- [apps/web/src/keybindings.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/web/src/keybindings.ts)
- [apps/web/src/keybindings.test.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/web/src/keybindings.test.ts)

Changes:
- Add helpers:
  - `isThreadSwitchRecentNextShortcut`
  - `isThreadSwitchRecentPreviousShortcut`
- Ensure `shortcutLabelForCommand` supports the new commands automatically through the command union.
- Add resolver tests showing the new commands are selected correctly and respect last-rule-wins behavior.

### 3. Add a dedicated MRU/cycle state module
Create a new web-only module, preferably:
- [apps/web/src/threadRecency.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/web/src/threadRecency.ts)
- [apps/web/src/threadRecency.test.ts](/Users/felipelopes/dev/wolt/t3code-fork/apps/web/src/threadRecency.test.ts)

This module should own pure logic only:
- `recordThreadVisit`
- `pruneRecentThreads`
- `beginCycle`
- `advanceCycle`
- `endCycle`

State shape:
- `recentThreadIds: ThreadId[]`
- `activeCycle: null | { order: ThreadId[]; index: number; heldModifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean } }`

Rules:
- `beginCycle` freezes an `order` snapshot for the session.
- `advanceCycle` walks that frozen order and returns the target thread ID.
- `endCycle` clears cycle state and returns the final thread to commit to MRU.
- `beginCycle` derives `heldModifiers` from the actual matched shortcut event, not from the command name.
- If `heldModifiers` is empty, `beginCycle` must return a single-step session that commits immediately after navigation.
- `pruneRecentThreads` must also be able to prune or terminate `activeCycle` when eligibility changes.
- No persistence layer.

### 4. Add a single controller in the chat shell
Mount a new controller component under the chat layout, not inside `ChatView` or `Sidebar`, so the behavior is centralized and survives thread view remounts.

Best location:
- [apps/web/src/routes/_chat.tsx](/Users/felipelopes/dev/wolt/t3code-fork/apps/web/src/routes/_chat.tsx)

Recommended new file:
- [apps/web/src/components/ThreadRecencyController.tsx](/Users/felipelopes/dev/wolt/t3code-fork/apps/web/src/components/ThreadRecencyController.tsx)

Responsibilities:
- Read resolved keybindings via `serverConfigQueryOptions()`.
- Read server thread IDs from the main store.
- Read draft thread IDs from `draftThreadsByThreadId` in the composer draft store.
- Observe the current route thread ID using router params/matches.
- Record normal thread visits into MRU.
- Prune unavailable IDs from both MRU state and any active cycle when thread datasets change.
- Listen for `keydown`, `keyup`, `blur`, and `visibilitychange`.
- Navigate through `useNavigate()` to `/$threadId`.

Important implementation detail:
- Suppress normal MRU updates for route changes triggered by an active cycle session.
- Commit the final active thread only when the cycle session ends.
- If eligibility changes invalidate the active cycle target set, terminate or shrink the cycle before handling the next shortcut event.

### 5. Keep existing listeners separated
Do not merge this into the existing `ChatView` terminal shortcut listener or the `Sidebar` new-thread shortcut listener. Those listeners are scoped to different concerns and contexts.

The new thread-switch controller should be the only place handling:
- `thread.switchRecentNext`
- `thread.switchRecentPrevious`

### 6. Optional discoverability
No new visible UI is required for v1. The commands become available through `keybindings.json` automatically.

If a small discoverability touch is desired during implementation, keep it minimal:
- only surface shortcut labels where there is already a shortcut label pattern
- do not add a switcher modal or settings form in this iteration

## Test Cases and Scenarios

### Contracts / server
- Command schema accepts both new thread-switch commands.
- Default keybindings compile with `ctrl+tab` and `ctrl+shift+tab`.
- Default sync writes the new commands into missing config files.
- Existing custom bindings with the same shortcuts still win over defaults.
- `server.getConfig` returns resolved defaults including the new commands.

### Client keybinding resolver
- `ctrl+tab` resolves to `thread.switchRecentNext`.
- `ctrl+shift+tab` resolves to `thread.switchRecentPrevious`.
- Last matching binding wins when user config overrides the default.
- `when` clauses still gate the new commands if the user adds them.

### MRU pure logic
- Recording visits produces unique most-recent-first order.
- Pruning removes deleted server thread IDs and only draft IDs that disappear from `draftThreadsByThreadId`.
- First cycle from `[A, B, C]` targets `B`.
- Repeated forward cycle walks `B -> C -> A`.
- Reverse cycle walks backward over the same frozen order.
- Ending a cycle commits the final thread to the front.
- Beginning a cycle from a non-thread route uses the first MRU entry.
- Active cycle order stays frozen across intermediate route changes caused by cycling, but is pruned or terminated when eligibility changes make entries invalid.
- A custom binding with no held modifiers behaves as a single-step MRU switch and does not keep a live cycle session.

### UI/integration
- Clicking thread `B` after viewing `A` makes `Ctrl+Tab` return to `A`.
- Draft thread routes participate in switching the same as saved threads.
- Deleting the active or recent thread prunes it and does not break the next switch.
- Clearing a draft thread prunes it and does not break the next switch.
- Deleting or clearing a draft mid-cycle prunes `activeCycle.order` and either continues safely with remaining eligible IDs or ends the cycle immediately.
- From settings, invoking the shortcut opens the most recent thread if one exists.
- When only one eligible thread exists, the shortcut is a no-op.
- Terminal focus does not block the default thread-switch commands.
- Custom bindings using `when: "terminalFocus"` or `when: "!terminalFocus"` resolve correctly because the controller supplies the same terminal context as the existing shortcut resolver.
- On browser builds, custom non-reserved bindings still work even if `Ctrl+Tab` is intercepted by the browser.

## Verification
Run:
- `bun run test`
- `bun lint`
- `bun typecheck`

## Assumptions and Defaults
- “Last thread windows” means recent thread routes within the current app window, not OS/browser windows.
- Draft-only threads should behave like normal thread targets in MRU switching, but only while their IDs exist in `draftThreadsByThreadId`.
- MRU history is intentionally in-memory only.
- Desktop/Electron is the primary target for the default `Ctrl+Tab` experience.
- Custom bindings with no held modifiers are supported, but they only perform single-step MRU switching rather than sustained multi-step cycling.
- No overlay UI is included in this version.
- No additional server persistence or orchestration events are needed.
