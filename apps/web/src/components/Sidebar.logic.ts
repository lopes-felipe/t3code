import type { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  type ThreadStatusPill,
  hasUnseenCompletion,
  resolveThreadStatusPill,
} from "../threadStatus";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarThreadBucket = "active" | "archived";

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function threadBucketExpansionKey(
  projectId: ProjectId,
  bucket: SidebarThreadBucket,
): string {
  return `${projectId}:${bucket}`;
}

export function getVisibleSidebarThreadIds(
  threadIds: readonly ThreadId[],
  expanded: boolean,
  previewLimit: number,
): readonly ThreadId[] {
  if (expanded || threadIds.length <= previewLimit) {
    return threadIds;
  }
  return threadIds.slice(0, previewLimit);
}

export function buildRenderedProjectThreadIds(input: {
  readonly activeThreadIds: readonly ThreadId[];
  readonly archivedThreadIds: readonly ThreadId[];
  readonly activeExpanded: boolean;
  readonly archivedExpanded: boolean;
  readonly previewLimit: number;
}): readonly ThreadId[] {
  return [
    ...getVisibleSidebarThreadIds(input.activeThreadIds, input.activeExpanded, input.previewLimit),
    ...getVisibleSidebarThreadIds(
      input.archivedThreadIds,
      input.archivedExpanded,
      input.previewLimit,
    ),
  ];
}

export { hasUnseenCompletion, resolveThreadStatusPill, type ThreadStatusPill };
