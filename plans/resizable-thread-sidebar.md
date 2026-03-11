# Resizable Thread Sidebar

## Summary

Implement desktop-only resizing for the left thread sidebar in the shared chat layout so the width updates immediately everywhere that layout is used: the empty threads screen and the active chat screen. Use the existing generic sidebar resize primitive rather than adding a second layout system. Also stop hard-truncating newly generated thread titles at creation time so wider sidebars can actually reveal more text.

Key files:

- `apps/web/src/routes/_chat.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/truncateTitle.ts`

## Public API / Type Changes

- No contract, server, WebSocket, or shared package schema changes.
- No changes to the generic `Sidebar` public API are required; implement the thread-sidebar persistence and guard behavior in `apps/web/src/routes/_chat.tsx` on top of the existing `resizable` interface.
- Internal behavior change only: newly auto-generated thread titles in the web app will no longer be permanently shortened to 50 characters before persistence.

## Web Changes

Enable resizing on the existing left `Sidebar` in `apps/web/src/routes/_chat.tsx`.

- Add route-local constants:
  - `THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width"`
  - `THREAD_SIDEBAR_MIN_WIDTH_PX = 12 * 16`
  - `THREAD_SIDEBAR_MAX_WIDTH_PX = 32 * 16`
  - `THREAD_MAIN_PANEL_MIN_WIDTH_PX = 32 * 16`
- Pass `storageKey`, `minWidth`, `maxWidth`, and a `shouldAcceptWidth` guard to the left sidebar `resizable` config.
- Render `<SidebarRail />` for the thread sidebar so the existing pointer-resize behavior becomes available on desktop.

Keep the width source of truth as the shared `SidebarProvider` wrapper CSS variable, `--sidebar-width`.

- Do not add Zustand state for sidebar width.
- Reuse the current `Sidebar` and `SidebarRail` behavior in `apps/web/src/components/ui/sidebar.tsx`, which already writes live width updates directly to the shared wrapper and persists resize updates to `localStorage`.
- Because `_chat/` and `_chat/$threadId` both render inside the same `SidebarProvider` layout in `apps/web/src/routes/_chat.tsx`, width changes should immediately affect both the threads empty state and the active chat view without any extra synchronization layer.
- Add a pre-paint initial-width path in `apps/web/src/routes/_chat.tsx` so the persisted desktop width is applied on the first client render instead of snapping from `16rem` after mount.
- Read `localStorage[THREAD_SIDEBAR_WIDTH_STORAGE_KEY]` synchronously during layout initialization, clamp it to `[THREAD_SIDEBAR_MIN_WIDTH_PX, THREAD_SIDEBAR_MAX_WIDTH_PX]`, and pass the result through the existing `SidebarProvider` `style` prop as `--sidebar-width`.
- Keep the existing `SidebarRail` storage restore path as a safety net for later interactions, but the route-level initialization becomes the authoritative first-render hydration path.
- If a stored width is missing, invalid, or outside the new bounds, fall back to the current `16rem` default after clamping.

Add a left-pane resize guard in `apps/web/src/routes/_chat.tsx`.

- Implement `shouldAcceptWidth` so the sidebar cannot be resized wide enough to starve the main content area.
- Do not approximate the remaining width as `wrapper width - sidebar width`; that is incorrect when the inline diff sidebar is open.
- Use the existing diff-sidebar guard pattern: temporarily apply the proposed `--sidebar-width` to the shared wrapper, measure the real main pane, then restore the previous width before returning.
- In `shouldAcceptWidth`, use the callback `wrapper` from the existing resize context and query the actual left content pane from the DOM, targeting the shared `main[data-slot='sidebar-inset']` rendered by the chat layout.
- Reject widths that would leave that measured main pane under `THREAD_MAIN_PANEL_MIN_WIDTH_PX`.
- Keep mobile behavior unchanged; `Sidebar` already disables `resizable` on mobile and uses the existing off-canvas sheet path.

Keep the threads panel display responsive to width by relying on existing row layout behavior in `apps/web/src/components/Sidebar.tsx`.

- The thread rows already use `min-w-0 flex-1 truncate`, so as the sidebar width changes, the visible text budget changes immediately.
- Do not add manual character-count logic or JS text measurement for sidebar rows unless existing CSS behavior proves insufficient.

Remove the 50-character creation-time cap for future auto-generated thread titles in `apps/web/src/components/ChatView.tsx`.

- Replace `truncateTitle(titleSeed)` with trimmed full text when creating a new thread title.
- Replace `truncateTitle(buildPlanImplementationThreadTitle(planMarkdown))` with the trimmed full generated title.
- Keep manual rename behavior unchanged; renamed titles are already stored in full.
- Delete `apps/web/src/truncateTitle.ts` and `apps/web/src/truncateTitle.test.ts` once the two `ChatView` call sites are removed.

## Behavioral Rules

- Sidebar resizing is desktop-only.
- The chosen sidebar width persists in `localStorage`.
- The current width must survive route changes between `_chat/` and `_chat/$threadId`.
- Reloading the app should restore the last chosen width on the first client render, without an intermediate snap from the default width.
- Existing historical titles that were already stored in truncated form remain unchanged; there is no backfill or migration.
- Wider sidebars should reveal more of the stored thread title automatically, while narrower sidebars should reveal less.
- Keyboard-based width resizing is out of scope for this change; the rail remains pointer-drag resize only.

## Test Cases and Scenarios

- Add a browser or integration test for desktop resize on an active thread route:
  - Mount a thread with a long title.
  - Drag the left sidebar rail wider.
  - Assert the sidebar width increases immediately.
  - Assert the main chat pane width decreases immediately.
- Add a browser or integration test for shared-layout persistence across routes:
  - Resize on `/$threadId`.
  - Navigate to `/`.
  - Assert the sidebar width is preserved on the empty threads screen.
- Add a persistence test:
  - Seed `localStorage["chat_thread_sidebar_width"]`.
  - Mount the chat layout.
  - Assert the stored width is applied on first render, without waiting for a post-mount resize effect.
- Add a clamp test for persisted width:
  - Seed `localStorage["chat_thread_sidebar_width"]` with a value below the new minimum and another above the new maximum.
  - Mount the chat layout.
  - Assert the applied width is clamped into `[THREAD_SIDEBAR_MIN_WIDTH_PX, THREAD_SIDEBAR_MAX_WIDTH_PX]`.
- Add a guard-rejection test:
  - Attempt to resize the left sidebar wider than would leave `main[data-slot='sidebar-inset']` under `THREAD_MAIN_PANEL_MIN_WIDTH_PX`.
  - Assert the resize is rejected.
- Add a guard-rejection test with inline diff open:
  - Mount `/_chat/$threadId?diff=1` on desktop.
  - Attempt the same oversize left-sidebar resize.
  - Assert the measured chat pane guard still rejects the resize even with the diff sidebar present.
- Add or update title-generation tests:
  - New thread title creation preserves the full trimmed seed text.
  - "Implement plan in new thread" preserves the full trimmed generated title.
- Delete the old `truncateTitle` tests with the helper.

## Validation / Acceptance

- Desktop users can drag the left thread sidebar narrower and wider.
- The resize is visible immediately on both `_chat/` and `_chat/$threadId`.
- Route changes within the chat layout do not reset the chosen width.
- Reloading restores the previous width from `localStorage` on first client render.
- Long thread titles are no longer hard-capped at 50 characters for new auto-generated titles, so a wider sidebar can reveal more of the same stored title.
- Mobile behavior is unchanged.

## Assumptions and Defaults

- Persist sidebar width in `localStorage`.
- Remove the 50-character cap for future auto-generated thread titles.
- Keep the current default sidebar width of `16rem`; only resize bounds and persistence are added.
