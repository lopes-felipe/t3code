import { describe, expect, it } from "vitest";

import {
  hasUnseenCompletion,
  resolveThreadStatus,
  resolveThreadStatusPill,
  type ThreadStatusInput,
} from "./threadStatus";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): ThreadStatusInput["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("resolveThreadStatus", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  } satisfies ThreadStatusInput;

  it("keeps pending approval above every other status", () => {
    expect(
      resolveThreadStatus({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toBe("pending-approval");
  });

  it("keeps awaiting input above running and connecting", () => {
    expect(
      resolveThreadStatus({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toBe("awaiting-input");
  });

  it("maps running sessions to working", () => {
    expect(
      resolveThreadStatus({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toBe("working");
  });

  it("maps connecting sessions to connecting", () => {
    expect(
      resolveThreadStatus({
        thread: {
          ...baseThread,
          session: {
            ...baseThread.session,
            status: "connecting",
            orchestrationStatus: "starting",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toBe("connecting");
  });

  it("requires a settled plan turn and proposed plan for plan-ready", () => {
    expect(
      resolveThreadStatus({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toBe("plan-ready");
  });

  it("resolves unseen completions to completed when no higher status is active", () => {
    expect(
      resolveThreadStatus({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toBe("completed");
  });

  it("returns none after a completion has already been visited", () => {
    expect(
      resolveThreadStatus({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:05:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toBe("none");
  });
});

describe("resolveThreadStatusPill", () => {
  it("maps canonical statuses back to the sidebar presentation", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          interactionMode: "default",
          latestTurn: null,
          lastVisitedAt: undefined,
          proposedPlans: [],
          session: {
            provider: "codex",
            status: "running",
            createdAt: "2026-03-09T10:00:00.000Z",
            updatedAt: "2026-03-09T10:00:00.000Z",
            orchestrationStatus: "running",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });
});
