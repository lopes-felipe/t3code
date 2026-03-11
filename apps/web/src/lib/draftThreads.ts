import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_NEW_THREAD_TITLE,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

import type { DraftThreadState } from "../composerDraftStore";
import type { Thread } from "../types";

type ProjectDraftThread = DraftThreadState & {
  threadId: ThreadId;
};

export function buildLocalDraftThread(input: {
  readonly threadId: ThreadId;
  readonly draftThread: DraftThreadState;
  readonly projectModel?: string | null;
  readonly error?: string | null;
}): Thread {
  const fallbackModel = input.projectModel ?? DEFAULT_MODEL_BY_PROVIDER.codex;
  return {
    id: input.threadId,
    codexThreadId: null,
    projectId: input.draftThread.projectId,
    title: DEFAULT_NEW_THREAD_TITLE,
    model: fallbackModel,
    runtimeMode: input.draftThread.runtimeMode,
    interactionMode: input.draftThread.interactionMode,
    session: null,
    messages: [],
    error: input.error ?? null,
    createdAt: input.draftThread.createdAt,
    archivedAt: null,
    lastInteractionAt: input.draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: input.draftThread.createdAt,
    branch: input.draftThread.branch,
    worktreePath: input.draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function getProjectThreadsWithDraft(input: {
  readonly projectId: ProjectId;
  readonly projectThreads: readonly Thread[];
  readonly draftThread?: ProjectDraftThread | null;
  readonly projectModel?: string | null;
}): Thread[] {
  const filteredThreads = input.projectThreads.filter(
    (thread) => thread.projectId === input.projectId,
  );
  const { draftThread } = input;
  if (!draftThread || draftThread.projectId !== input.projectId) {
    return [...filteredThreads];
  }
  if (filteredThreads.some((thread) => thread.id === draftThread.threadId)) {
    return [...filteredThreads];
  }
  return [
    ...filteredThreads,
    buildLocalDraftThread({
      threadId: draftThread.threadId,
      draftThread,
      ...(input.projectModel !== undefined ? { projectModel: input.projectModel } : {}),
    }),
  ];
}

export function getVisibleThreadsWithPinnedDraft(input: {
  readonly threads: readonly Thread[];
  readonly expanded: boolean;
  readonly previewLimit: number;
  readonly draftThreadId?: ThreadId | null;
}): Thread[] {
  const { threads, expanded, previewLimit, draftThreadId } = input;
  if (expanded || threads.length <= previewLimit) {
    return [...threads];
  }
  const visibleThreads = threads.slice(0, previewLimit);
  if (!draftThreadId || visibleThreads.some((thread) => thread.id === draftThreadId)) {
    return visibleThreads;
  }
  const draftThread = threads.find((thread) => thread.id === draftThreadId);
  if (!draftThread) {
    if (import.meta.env.DEV) {
      console.warn("Pinned draft thread was not found in the visible project thread list.", {
        draftThreadId,
      });
    }
    return visibleThreads;
  }
  return [...visibleThreads.slice(0, Math.max(0, previewLimit - 1)), draftThread];
}

export function isDraftThreadId(
  threadId: ThreadId,
  draftThreadsByThreadId: Readonly<Record<ThreadId, DraftThreadState>>,
  persistedThreadIds?: ReadonlySet<ThreadId>,
): boolean {
  return draftThreadsByThreadId[threadId] !== undefined && !persistedThreadIds?.has(threadId);
}
