import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildRenderedProjectThreadIds,
  getVisibleSidebarThreadIds,
  shouldClearThreadSelectionOnMouseDown,
  threadBucketExpansionKey,
} from "./Sidebar.logic";

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("sidebar thread bucket helpers", () => {
  it("builds stable expansion keys per project bucket", () => {
    expect(threadBucketExpansionKey(ProjectId.makeUnsafe("project-1"), "active")).toBe(
      "project-1:active",
    );
    expect(threadBucketExpansionKey(ProjectId.makeUnsafe("project-1"), "archived")).toBe(
      "project-1:archived",
    );
  });

  it("applies the preview limit independently per bucket", () => {
    const activeThreadIds = [
      ThreadId.makeUnsafe("thread-a"),
      ThreadId.makeUnsafe("thread-b"),
      ThreadId.makeUnsafe("thread-c"),
    ] as const;
    const archivedThreadIds = [
      ThreadId.makeUnsafe("thread-d"),
      ThreadId.makeUnsafe("thread-e"),
      ThreadId.makeUnsafe("thread-f"),
    ] as const;

    expect(
      getVisibleSidebarThreadIds(activeThreadIds, false, 2).map((threadId) => threadId),
    ).toEqual([ThreadId.makeUnsafe("thread-a"), ThreadId.makeUnsafe("thread-b")]);

    expect(
      buildRenderedProjectThreadIds({
        activeThreadIds,
        archivedThreadIds,
        activeExpanded: false,
        archivedExpanded: true,
        previewLimit: 2,
      }),
    ).toEqual([
      ThreadId.makeUnsafe("thread-a"),
      ThreadId.makeUnsafe("thread-b"),
      ThreadId.makeUnsafe("thread-d"),
      ThreadId.makeUnsafe("thread-e"),
      ThreadId.makeUnsafe("thread-f"),
    ]);
  });
});
