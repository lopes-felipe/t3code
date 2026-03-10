import type { Thread } from "./types";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  isLatestTurnSettled,
} from "./session-logic";

export type ThreadStatus =
  | "pending-approval"
  | "awaiting-input"
  | "working"
  | "connecting"
  | "plan-ready"
  | "completed"
  | "none";

export interface ThreadStatusPill {
  label: Exclude<ThreadStatusLabel, null>;
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

type ThreadStatusLabel =
  | "Working"
  | "Connecting"
  | "Completed"
  | "Pending Approval"
  | "Awaiting Input"
  | "Plan Ready"
  | null;

export type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export interface ResolveThreadStatusInput {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}

const THREAD_STATUS_PILL_BY_STATUS: Record<Exclude<ThreadStatus, "none">, ThreadStatusPill> = {
  "pending-approval": {
    label: "Pending Approval",
    colorClass: "text-amber-600 dark:text-amber-300/90",
    dotClass: "bg-amber-500 dark:bg-amber-300/90",
    pulse: false,
  },
  "awaiting-input": {
    label: "Awaiting Input",
    colorClass: "text-indigo-600 dark:text-indigo-300/90",
    dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
    pulse: false,
  },
  working: {
    label: "Working",
    colorClass: "text-sky-600 dark:text-sky-300/80",
    dotClass: "bg-sky-500 dark:bg-sky-300/80",
    pulse: true,
  },
  connecting: {
    label: "Connecting",
    colorClass: "text-sky-600 dark:text-sky-300/80",
    dotClass: "bg-sky-500 dark:bg-sky-300/80",
    pulse: true,
  },
  "plan-ready": {
    label: "Plan Ready",
    colorClass: "text-violet-600 dark:text-violet-300/90",
    dotClass: "bg-violet-500 dark:bg-violet-300/90",
    pulse: false,
  },
  completed: {
    label: "Completed",
    colorClass: "text-emerald-600 dark:text-emerald-300/90",
    dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
    pulse: false,
  },
};

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function resolveThreadStatus(input: ResolveThreadStatusInput): ThreadStatus {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return "pending-approval";
  }

  if (hasPendingUserInput) {
    return "awaiting-input";
  }

  if (thread.session?.status === "running") {
    return "working";
  }

  if (thread.session?.status === "connecting") {
    return "connecting";
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return "plan-ready";
  }

  if (hasUnseenCompletion(thread)) {
    return "completed";
  }

  return "none";
}

export function resolveThreadStatusForThread(thread: Thread): ThreadStatus {
  return resolveThreadStatus({
    thread,
    hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
    hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
  });
}

export function isVisibleThreadStatus(
  status: ThreadStatus,
): status is Exclude<ThreadStatus, "none"> {
  return status !== "none";
}

export function threadStatusLabel(status: ThreadStatus): ThreadStatusLabel {
  return status === "none" ? null : THREAD_STATUS_PILL_BY_STATUS[status].label;
}

export function resolveThreadStatusPill(input: ResolveThreadStatusInput): ThreadStatusPill | null {
  const status = resolveThreadStatus(input);
  return status === "none" ? null : THREAD_STATUS_PILL_BY_STATUS[status];
}
