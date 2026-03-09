import type { KeybindingShortcut, ThreadId } from "@t3tools/contracts";
import { isMacPlatform } from "./lib/utils";

export interface ThreadRecencyHeldModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ThreadRecencyCycle {
  order: ThreadId[];
  index: number;
  heldModifiers: ThreadRecencyHeldModifiers;
}

export interface ThreadRecencyState {
  recentThreadIds: ThreadId[];
  activeCycle: ThreadRecencyCycle | null;
}

export interface ThreadRecencyTransition {
  state: ThreadRecencyState;
  targetThreadId: ThreadId | null;
  commitThreadId: ThreadId | null;
}

interface BeginCycleOptions {
  direction: "next" | "previous";
  activeThreadId: ThreadId | null;
  eligibleThreadIds: ReadonlyArray<ThreadId>;
  shortcut: KeybindingShortcut;
  platform?: string;
}

export const EMPTY_THREAD_RECENCY_STATE: ThreadRecencyState = Object.freeze({
  recentThreadIds: [],
  activeCycle: null,
});

function orderedUniqueThreadIds(threadIds: ReadonlyArray<ThreadId>): ThreadId[] {
  const seen = new Set<ThreadId>();
  const ordered: ThreadId[] = [];

  for (const threadId of threadIds) {
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    ordered.push(threadId);
  }

  return ordered;
}

function hasHeldModifiers(heldModifiers: ThreadRecencyHeldModifiers): boolean {
  return (
    heldModifiers.ctrlKey ||
    heldModifiers.metaKey ||
    heldModifiers.altKey ||
    heldModifiers.shiftKey
  );
}

function sameHeldModifiers(
  left: ThreadRecencyHeldModifiers,
  right: ThreadRecencyHeldModifiers,
): boolean {
  return (
    left.ctrlKey === right.ctrlKey &&
    left.metaKey === right.metaKey &&
    left.altKey === right.altKey &&
    left.shiftKey === right.shiftKey
  );
}

function sameThreadIds(left: ReadonlyArray<ThreadId>, right: ReadonlyArray<ThreadId>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameActiveCycle(left: ThreadRecencyCycle | null, right: ThreadRecencyCycle | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.index === right.index &&
    sameThreadIds(left.order, right.order) &&
    sameHeldModifiers(left.heldModifiers, right.heldModifiers)
  );
}

function cycleIndexForDirection(
  direction: "next" | "previous",
  currentIndex: number,
  length: number,
): number {
  if (length === 0) return -1;
  return direction === "next"
    ? (currentIndex + 1) % length
    : (currentIndex - 1 + length) % length;
}

function requiredHeldModifiers(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): ThreadRecencyHeldModifiers {
  const useMetaForMod = isMacPlatform(platform);
  return {
    ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod),
    metaKey: shortcut.metaKey || (shortcut.modKey && useMetaForMod),
    altKey: shortcut.altKey,
    shiftKey: shortcut.shiftKey,
  };
}

function buildCycleOrder(
  recentThreadIds: ReadonlyArray<ThreadId>,
  eligibleThreadIds: ReadonlyArray<ThreadId>,
  activeThreadId: ThreadId | null,
): ThreadId[] {
  const eligibleThreadIdSet = new Set(eligibleThreadIds);
  const orderedEligible = orderedUniqueThreadIds(
    recentThreadIds.filter((threadId) => eligibleThreadIdSet.has(threadId)),
  );

  if (activeThreadId && eligibleThreadIdSet.has(activeThreadId)) {
    return [activeThreadId, ...orderedEligible.filter((threadId) => threadId !== activeThreadId)];
  }

  return orderedEligible;
}

export function recordThreadVisit(
  state: ThreadRecencyState,
  threadId: ThreadId,
): ThreadRecencyState {
  const recentThreadIds = [threadId, ...state.recentThreadIds.filter((entry) => entry !== threadId)];
  return sameThreadIds(recentThreadIds, state.recentThreadIds)
    ? state
    : { ...state, recentThreadIds };
}

export function pruneRecentThreads(
  state: ThreadRecencyState,
  eligibleThreadIds: ReadonlyArray<ThreadId>,
  activeThreadId: ThreadId | null,
): ThreadRecencyState {
  const eligibleThreadIdSet = new Set(eligibleThreadIds);
  const recentThreadIds = orderedUniqueThreadIds(
    state.recentThreadIds.filter((threadId) => eligibleThreadIdSet.has(threadId)),
  );

  let activeCycle = state.activeCycle;
  if (activeCycle) {
    const order = activeCycle.order.filter((threadId) => eligibleThreadIdSet.has(threadId));
    const minimumCycleLength = activeThreadId ? 2 : 1;
    if (order.length < minimumCycleLength) {
      activeCycle = null;
    } else if (activeThreadId) {
      const index = order.indexOf(activeThreadId);
      activeCycle =
        index === -1
          ? null
          : {
              order,
              index,
              heldModifiers: activeCycle.heldModifiers,
            };
    } else {
      const index = Math.min(activeCycle.index, order.length - 1);
      activeCycle = {
        order,
        index,
        heldModifiers: activeCycle.heldModifiers,
      };
    }
  }

  if (sameThreadIds(recentThreadIds, state.recentThreadIds) && sameActiveCycle(activeCycle, state.activeCycle)) {
    return state;
  }

  return { recentThreadIds, activeCycle };
}

export function beginCycle(
  state: ThreadRecencyState,
  options: BeginCycleOptions,
): ThreadRecencyTransition {
  const order = buildCycleOrder(state.recentThreadIds, options.eligibleThreadIds, options.activeThreadId);
  const heldModifiers = requiredHeldModifiers(options.shortcut, options.platform);

  if (options.activeThreadId) {
    if (order.length < 2) {
      return { state, targetThreadId: null, commitThreadId: null };
    }
    const activeIndex = order.indexOf(options.activeThreadId);
    const baseIndex = activeIndex === -1 ? 0 : activeIndex;
    const index = cycleIndexForDirection(options.direction, baseIndex, order.length);
    const targetThreadId = order[index] ?? null;
    if (!targetThreadId) {
      return { state, targetThreadId: null, commitThreadId: null };
    }
    if (!hasHeldModifiers(heldModifiers)) {
      const nextState = recordThreadVisit({ ...state, activeCycle: null }, targetThreadId);
      return { state: nextState, targetThreadId, commitThreadId: targetThreadId };
    }
    return {
      state: {
        ...state,
        activeCycle: {
          order,
          index,
          heldModifiers,
        },
      },
      targetThreadId,
      commitThreadId: null,
    };
  }

  const targetThreadId = order[0] ?? null;
  if (!targetThreadId) {
    return { state, targetThreadId: null, commitThreadId: null };
  }
  if (!hasHeldModifiers(heldModifiers)) {
    const nextState = recordThreadVisit({ ...state, activeCycle: null }, targetThreadId);
    return { state: nextState, targetThreadId, commitThreadId: targetThreadId };
  }
  return {
    state: {
      ...state,
      activeCycle: {
        order,
        index: 0,
        heldModifiers,
      },
    },
    targetThreadId,
    commitThreadId: null,
  };
}

export function advanceCycle(
  state: ThreadRecencyState,
  direction: "next" | "previous",
): ThreadRecencyTransition {
  const activeCycle = state.activeCycle;
  if (!activeCycle || activeCycle.order.length === 0) {
    return { state, targetThreadId: null, commitThreadId: null };
  }

  const index = cycleIndexForDirection(direction, activeCycle.index, activeCycle.order.length);
  const targetThreadId = activeCycle.order[index] ?? null;
  if (!targetThreadId) {
    return { state, targetThreadId: null, commitThreadId: null };
  }

  return {
    state: {
      ...state,
      activeCycle: {
        ...activeCycle,
        index,
      },
    },
    targetThreadId,
    commitThreadId: null,
  };
}

export function endCycle(
  state: ThreadRecencyState,
  finalThreadId: ThreadId | null,
): ThreadRecencyTransition {
  if (!state.activeCycle) {
    return { state, targetThreadId: null, commitThreadId: null };
  }

  const clearedState = { ...state, activeCycle: null };
  if (!finalThreadId) {
    return { state: clearedState, targetThreadId: null, commitThreadId: null };
  }

  return {
    state: recordThreadVisit(clearedState, finalThreadId),
    targetThreadId: null,
    commitThreadId: finalThreadId,
  };
}
