import { ThreadId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  resolveShortcutBinding,
  type ShortcutEventLike,
} from "../keybindings";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isArchivedThread } from "../lib/threadOrdering";
import { useStore } from "../store";
import {
  advanceCycle,
  beginCycle,
  EMPTY_THREAD_RECENCY_STATE,
  endCycle,
  pruneRecentThreads,
  recordThreadVisit,
  type ThreadRecencyHeldModifiers,
  type ThreadRecencyState,
} from "../threadRecency";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

type PendingCycleNavigationCounts = Map<ThreadId, number>;

function areRequiredHeldModifiersPressed(
  heldModifiers: ThreadRecencyHeldModifiers,
  event: Pick<ShortcutEventLike, "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  return (
    (!heldModifiers.ctrlKey || event.ctrlKey) &&
    (!heldModifiers.metaKey || event.metaKey) &&
    (!heldModifiers.altKey || event.altKey) &&
    (!heldModifiers.shiftKey || event.shiftKey)
  );
}

function currentTerminalOpen(threadId: ThreadId | null): boolean {
  if (!threadId) return false;
  return selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, threadId)
    .terminalOpen;
}

function clearPendingCycleNavigations(
  pendingCycleNavigationCounts: PendingCycleNavigationCounts,
): void {
  pendingCycleNavigationCounts.clear();
}

function prunePendingCycleNavigations(
  pendingCycleNavigationCounts: PendingCycleNavigationCounts,
  eligibleThreadIdSet: ReadonlySet<ThreadId>,
): void {
  for (const threadId of pendingCycleNavigationCounts.keys()) {
    if (!eligibleThreadIdSet.has(threadId)) {
      pendingCycleNavigationCounts.delete(threadId);
    }
  }
}

function enqueuePendingCycleNavigation(
  pendingCycleNavigationCounts: PendingCycleNavigationCounts,
  threadId: ThreadId,
): void {
  pendingCycleNavigationCounts.set(threadId, (pendingCycleNavigationCounts.get(threadId) ?? 0) + 1);
}

function consumePendingCycleNavigation(
  pendingCycleNavigationCounts: PendingCycleNavigationCounts,
  threadId: ThreadId,
): boolean {
  const count = pendingCycleNavigationCounts.get(threadId);
  if (!count) return false;
  if (count === 1) {
    pendingCycleNavigationCounts.delete(threadId);
  } else {
    pendingCycleNavigationCounts.set(threadId, count - 1);
  }
  return true;
}

export default function ThreadRecencyController() {
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const threads = useStore((store) => store.threads);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const [recencyState, setRecencyState] = useState<ThreadRecencyState>(EMPTY_THREAD_RECENCY_STATE);

  const eligibleThreadIds = useMemo(() => {
    const threadIds = threads
      .filter((thread) => !isArchivedThread(thread))
      .map((thread) => thread.id);
    const draftThreadIds = Object.keys(draftThreadsByThreadId).map((threadId) =>
      ThreadId.makeUnsafe(threadId),
    );
    return [...threadIds, ...draftThreadIds];
  }, [draftThreadsByThreadId, threads]);

  const eligibleThreadIdSet = useMemo(() => new Set(eligibleThreadIds), [eligibleThreadIds]);
  const recencyStateRef = useRef(recencyState);
  const keybindingsRef = useRef(keybindings);
  const eligibleThreadIdsRef = useRef(eligibleThreadIds);
  const eligibleThreadIdSetRef = useRef(eligibleThreadIdSet);
  const routeThreadIdRef = useRef(routeThreadId);
  const previousRouteThreadIdRef = useRef<ThreadId | null>(null);
  const pendingCycleNavigationCountsRef = useRef<PendingCycleNavigationCounts>(new Map());

  useEffect(() => {
    recencyStateRef.current = recencyState;
  }, [recencyState]);

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  useEffect(() => {
    eligibleThreadIdsRef.current = eligibleThreadIds;
    eligibleThreadIdSetRef.current = eligibleThreadIdSet;
    setRecencyState((current) => {
      const next = pruneRecentThreads(current, eligibleThreadIds, routeThreadIdRef.current);
      if (!next.activeCycle) {
        clearPendingCycleNavigations(pendingCycleNavigationCountsRef.current);
      } else {
        prunePendingCycleNavigations(pendingCycleNavigationCountsRef.current, eligibleThreadIdSet);
      }
      return next;
    });
  }, [eligibleThreadIds, eligibleThreadIdSet]);

  useEffect(() => {
    routeThreadIdRef.current = routeThreadId;
    const previousRouteThreadId = previousRouteThreadIdRef.current;
    const activeCycle = recencyStateRef.current.activeCycle;

    if (activeCycle) {
      if (
        routeThreadId &&
        consumePendingCycleNavigation(pendingCycleNavigationCountsRef.current, routeThreadId)
      ) {
        previousRouteThreadIdRef.current = routeThreadId;
        return;
      }

      const finalThreadId = routeThreadId ?? previousRouteThreadId;
      setRecencyState((current) => endCycle(current, finalThreadId).state);
      clearPendingCycleNavigations(pendingCycleNavigationCountsRef.current);
    }

    if (routeThreadId && eligibleThreadIdSetRef.current.has(routeThreadId)) {
      setRecencyState((current) => recordThreadVisit(current, routeThreadId));
    }

    previousRouteThreadIdRef.current = routeThreadId;
  }, [routeThreadId]);

  useEffect(() => {
    const finishCycle = (finalThreadId: ThreadId | null) => {
      setRecencyState((current) => endCycle(current, finalThreadId).state);
      clearPendingCycleNavigations(pendingCycleNavigationCountsRef.current);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const binding = resolveShortcutBinding(event, keybindingsRef.current, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: currentTerminalOpen(routeThreadIdRef.current),
        },
      });
      if (!binding) return;

      const direction =
        binding.command === "thread.switchRecentNext"
          ? "next"
          : binding.command === "thread.switchRecentPrevious"
            ? "previous"
            : null;
      if (!direction) return;

      const prunedState = pruneRecentThreads(
        recencyStateRef.current,
        eligibleThreadIdsRef.current,
        routeThreadIdRef.current,
      );
      if (prunedState !== recencyStateRef.current) {
        recencyStateRef.current = prunedState;
        setRecencyState(prunedState);
      }

      const activeCycle = recencyStateRef.current.activeCycle;
      const transition =
        activeCycle &&
        areRequiredHeldModifiersPressed(activeCycle.heldModifiers, event)
          ? advanceCycle(recencyStateRef.current, direction)
          : beginCycle(recencyStateRef.current, {
              direction,
              activeThreadId: routeThreadIdRef.current,
              eligibleThreadIds: eligibleThreadIdsRef.current,
              shortcut: binding.shortcut,
            });

      if (!transition.targetThreadId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      recencyStateRef.current = transition.state;
      setRecencyState(transition.state);
      if (transition.state.activeCycle) {
        enqueuePendingCycleNavigation(
          pendingCycleNavigationCountsRef.current,
          transition.targetThreadId,
        );
      } else {
        clearPendingCycleNavigations(pendingCycleNavigationCountsRef.current);
      }
      void navigate({
        to: "/$threadId",
        params: { threadId: transition.targetThreadId },
      });
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const activeCycle = recencyStateRef.current.activeCycle;
      if (!activeCycle) return;
      if (areRequiredHeldModifiersPressed(activeCycle.heldModifiers, event)) return;
      finishCycle(routeThreadIdRef.current ?? previousRouteThreadIdRef.current);
    };

    const onBlur = () => {
      if (!recencyStateRef.current.activeCycle) return;
      finishCycle(routeThreadIdRef.current ?? previousRouteThreadIdRef.current);
    };

    const onVisibilityChange = () => {
      if (!recencyStateRef.current.activeCycle) return;
      if (!document.hidden) return;
      finishCycle(routeThreadIdRef.current ?? previousRouteThreadIdRef.current);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [navigate]);

  return null;
}
