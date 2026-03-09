# Plan: Add a Setting to Disable Automatic Git Sync/Polling

## Summary

Add a new app-level boolean setting, `enableGitStatusAutoRefresh`, defaulting to `true`, to disable background git status refreshes without removing initial status loading or post-action refreshes.

This plan is intentionally scoped to web-side automatic refresh behavior only:

- When the setting is `true`, current behavior stays unchanged.
- When the setting is `false`, git status still loads when a view opens and still refreshes after explicit git actions, but it no longer refetches on an interval, on window focus, or on reconnect.
- No server or contract changes are required for this version.

## Important Changes / Interfaces

- Extend the app settings schema in `apps/web/src/appSettings.ts` with:
  - `enableGitStatusAutoRefresh: boolean`
  - default: `true`
- Keep the same local-storage key (`t3code:app-settings:v1`).
  - Reason: the settings schema already applies constructor defaults, so adding this field is backward-compatible for existing persisted settings.
- Refactor the internal query helper in `apps/web/src/lib/gitReactQuery.ts`:
  - Change `gitStatusQueryOptions(cwd)` to accept a small config object.
  - Final shape:
    - `gitStatusQueryOptions({ cwd, autoRefresh = true, staleTimeMs, refetchIntervalMs })`
  - Behavior:
    - `autoRefresh: true`:
      - preserve current defaults unless overrides are provided
      - `refetchOnWindowFocus: "always"`
      - `refetchOnReconnect: "always"`
      - `refetchInterval: default or override`
    - `autoRefresh: false`:
      - `refetchOnWindowFocus: false`
      - `refetchOnReconnect: false`
      - `refetchInterval: false`
      - initial fetch remains enabled when `cwd !== null`
- No changes to websocket contracts in `packages/contracts`.
- No changes to server-side `git.status` API shape.

## Implementation

1. Update `apps/web/src/appSettings.ts`.
   - Add `enableGitStatusAutoRefresh` to `AppSettingsSchema`.
   - Default it to `true`.
   - Include it in the `AppSettings` type automatically through schema inference.
   - Do not bump the storage version.

2. Add a new Git section to `apps/web/src/routes/_chat.settings.tsx`.
   - Section title: `Git`
   - Toggle label: `Auto-refresh git status`
   - Description copy:
     - enabled: keeps git status and PR state refreshed automatically
     - disabled: stops background refreshes, but git status still loads when opened and after explicit git actions
   - Add the same restore-default affordance used by the existing boolean settings sections.

3. Refactor `apps/web/src/lib/gitReactQuery.ts`.
   - Centralize the refresh gating inside `gitStatusQueryOptions(...)` so callsites do not duplicate refetch logic.
   - Preserve current constants for default stale/interval timings.
   - Support sidebar-specific timing overrides through the new config object.
   - Keep mutation invalidation behavior unchanged.

4. Update `apps/web/src/components/GitActionsControl.tsx`.
   - Subscribe to `useAppSettings()`.
   - Pass `settings.enableGitStatusAutoRefresh` into `gitStatusQueryOptions`.
   - Keep all explicit invalidations after mutations unchanged.
   - Keep the out-of-sync invalidation path unchanged.

5. Update `apps/web/src/components/Sidebar.tsx`.
   - Reuse the existing `useAppSettings()` subscription already present there.
   - Pass `appSettings.enableGitStatusAutoRefresh` into each `gitStatusQueryOptions(...)` call while preserving the sidebar's custom `staleTime` and `refetchInterval` values for the enabled case.
   - Result: PR badges stop background polling when the setting is off.

6. Leave `apps/web/src/components/BranchToolbarBranchSelector.tsx` unchanged.
   - Its direct `api.git.status({ cwd })` call happens after an explicit user branch action, so it should still run even when background auto-refresh is disabled.

## Behavior Details

- With the setting enabled:
  - thread git actions panel behaves exactly as today
  - sidebar PR badges continue background refresh
- With the setting disabled:
  - opening a thread with git controls still performs an initial `git.status`
  - opening the sidebar still performs initial status fetches for visible tracked repos
  - background interval polling stops
  - refetch on window focus stops
  - refetch on reconnect stops
  - mutation-triggered invalidations still refresh active git queries
  - explicit git actions that call `api.git.status` directly still work

## Test Cases and Scenarios

- In `apps/web/src/appSettings.test.ts`:
  - verify the new setting defaults to `true`
  - verify older persisted settings payloads without the new field still decode successfully with `true`
- In `apps/web/src/lib/gitReactQuery.test.ts`:
  - verify `gitStatusQueryOptions({ cwd, autoRefresh: true })` keeps the current refetch behavior
  - verify `gitStatusQueryOptions({ cwd, autoRefresh: false })` sets `refetchInterval` to `false`
  - verify `gitStatusQueryOptions({ cwd, autoRefresh: false })` disables `refetchOnWindowFocus`
  - verify `gitStatusQueryOptions({ cwd, autoRefresh: false })` disables `refetchOnReconnect`
  - verify sidebar-style overrides still apply when `autoRefresh: true`
- Manual verification after implementation:
  - enable setting, confirm periodic git status updates still happen
  - disable setting, confirm status loads once on open but does not refresh again on idle
  - disable setting, switch away and back to the window, confirm no focus refetch occurs
  - disable setting, reconnect network, confirm no reconnect refetch occurs
  - disable setting, run a git mutation, confirm the UI still refreshes afterward
  - disable setting, confirm sidebar PR badges stop background refreshing but still populate on first load
- Required repo checks before considering the task complete:
  - `bun lint`
  - `bun typecheck`

## Assumptions and Defaults

- Chosen behavior: `Background off only`.
  - This was selected over "manual only" and over "disable all remote sync."
- This is an app-level local setting, not a per-project or per-thread setting.
- No server-side change is included in this plan.
  - Important nuance: each `git.status` call currently triggers upstream refresh logic in `apps/server/src/git/Layers/GitCore.ts`, so disabling background refresh reduces automatic remote sync frequency but does not eliminate remote fetches on initial load or explicit refresh paths.
- No new manual "Refresh git status" button is required for this scope because initial load and explicit git actions still refresh status.
